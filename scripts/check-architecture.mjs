import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const workspaceGroups = ["apps", "packages"];

// One table is the single authority for dependency direction. Every workspace
// package must have an entry, and every entry must correspond to a discovered
// package; the gate fails on either kind of drift.
//
// `constrained` packages are libraries or executables that must stay
// statically analyzable in production code: no browser globals, no opaque
// runtime loading, and no process/realm boundary modules outside the reviewed
// exception lists. The web app is framework-driven and is constrained only by
// its dependency edges.
const boundaries = new Map([
  ["@specra/model", { allowed: new Set(), constrained: true }],
  [
    "@specra/openapi",
    { allowed: new Set(["@specra/model"]), constrained: true },
  ],
  ["@specra/config", { allowed: new Set(), constrained: true }],
  ["@specra/cli", { allowed: new Set(["@specra/config"]), constrained: true }],
  [
    "@specra/web",
    {
      allowed: new Set(["@specra/config", "@specra/model"]),
      constrained: false,
    },
  ],
]);
// Reviewed exceptions, keyed by repository-relative path. The trusted-config
// host exists to load the consumer's `specra.config.ts` (ADR-008) and may
// contain exactly the number of opaque loads recorded here; the loader is the
// only production module allowed to cross a process boundary.
const opaqueLoadExceptions = new Map([
  ["packages/cli/src/config-worker.ts", 1],
]);
const processBoundaryExceptions = new Set([
  "packages/cli/src/config-loader.ts",
]);
const processBoundaryModules = new Set(
  ["child_process", "cluster", "vm", "worker_threads"].flatMap((name) => [
    name,
    `node:${name}`,
  ]),
);
const manifestSections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const productionSections = new Set([
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
]);

const violations = [];
const components = await discoverComponents();
for (const [packageName, boundary] of boundaries) {
  if (!components.some((component) => component.name === packageName)) {
    violations.push(
      `Architecture boundary entry ${packageName} matches no workspace package; remove it or restore the package.`,
    );
  }
  void boundary;
}

for (const component of components) {
  const boundary = boundaries.get(component.name);
  if (boundary === undefined) {
    violations.push(
      `${component.directory}/package.json (${component.name}) has no architecture boundary entry; add it to scripts/check-architecture.mjs before it can be built.`,
    );
    continue;
  }
  violations.push(...manifestViolations(component.manifest, component));
  const declared = declaredInternalPackages(component.manifest);

  for (const file of await sourceFiles(path.join(root, component.directory))) {
    const source = await readFile(file, "utf8");
    const analysis = analyzeSource(source, file);
    const production = isProductionSource(file);
    const relativeFile = path.relative(root, file);
    for (const specifier of analysis.specifiers) {
      const dependency = dependencyPackage(file, specifier);
      if (dependency !== undefined && dependency !== component.name) {
        if (!boundary.allowed.has(dependency)) {
          violations.push(
            `${relativeFile} crosses from ${component.name} to forbidden ${dependency} via '${specifier}'.`,
          );
        } else if (!isDeclaredEdge(declared, dependency, production)) {
          violations.push(
            `${relativeFile} imports ${dependency} via '${specifier}' without declaring it in ${component.directory}/package.json ${production ? "runtime dependencies" : "dependencies"}.`,
          );
        }
      }
      if (!isRelativeImportConfined(component, file, specifier)) {
        violations.push(
          `${relativeFile} imports '${specifier}', which leaves the ${component.name} package boundary.`,
        );
      }
      if (
        component.name === "@specra/model" &&
        production &&
        !isModelImportAllowed(file, specifier)
      ) {
        violations.push(
          `${relativeFile} imports '${specifier}', but the canonical model must remain dependency-free.`,
        );
      }
      if (
        boundary.constrained &&
        production &&
        processBoundaryModules.has(specifier) &&
        !isProcessBoundaryAllowed(file)
      ) {
        violations.push(
          `${relativeFile} imports process-boundary module '${specifier}' outside the reviewed loader exception.`,
        );
      }
    }
    if (boundary.constrained && production && analysis.usesBrowserGlobal) {
      violations.push(
        `${relativeFile} uses a browser global inside the ${component.name} package boundary.`,
      );
    }
    if (boundary.constrained && production) {
      const allowedLoads = allowedOpaqueLoads(file);
      if (analysis.opaqueRuntimeLoads !== allowedLoads) {
        violations.push(
          allowedLoads === 0
            ? `${relativeFile} uses opaque runtime loading inside the ${component.name} package boundary.`
            : `${relativeFile} has ${analysis.opaqueRuntimeLoads} opaque runtime loads but the reviewed exception records ${allowedLoads}; update the review and the exception together.`,
        );
      }
    }
  }
}

// Guard the checker itself against the bypasses it is meant to prevent.
const selfTestSource = path.join(root, "apps/web/app/page.tsx");
if (
  dependencyPackage(
    selfTestSource,
    "../../../packages/openapi/src/index.js",
  ) !== "@specra/openapi"
) {
  violations.push(
    "Architecture checker self-test failed to resolve a relative cross-boundary import.",
  );
}
const modelSelfTest = path.join(root, "packages/model/src/index.ts");
if (
  isModelImportAllowed(modelSelfTest, "react") ||
  isModelImportAllowed(modelSelfTest, "node:util") ||
  isModelImportAllowed(
    modelSelfTest,
    "../../../scripts/check-architecture.mjs",
  ) ||
  !isModelImportAllowed(modelSelfTest, "./types.js")
) {
  violations.push(
    "Architecture checker self-test failed for dependency-free model imports.",
  );
}
const astCases = [
  ['const name = "react"; import(name); globalThis["win" + "dow"];', 1, true],
  ['require(process.env.MODULE); import("./static.js");', 1, false],
  [
    'import { createRequire } from "node:module"; const r = createRequire(import.meta.url);',
    1,
    false,
  ],
  ["document.title; window.alert(1);", 0, true],
  ["const { document } = globalThis;", 0, true],
  ["const size = { window };", 0, true],
  [
    "const document = parse(bytes); export const paths = document.paths;",
    0,
    false,
  ],
  ["export function walk(document) { return document.info; }", 0, false],
  ["const { document: doc } = parsed; doc.x;", 0, false],
  ["eval(code); new Function('s', 'return import(s)')('x');", 2, false],
  [
    'process.getBuiltinModule("node:module"); process["getBuiltin" + "Module"]("fs");',
    2,
    false,
  ],
  ['import { window } from "./frame.js"; window.open();', 0, false],
  [
    'interface Source { readonly document: string; } const value = { document: 1 }; class Box { window = 1; } type Kind = "window";',
    0,
    false,
  ],
];
for (const [source, opaqueRuntimeLoads, usesBrowserGlobal] of astCases) {
  const analysis = analyzeSource(source, "self-test.ts");
  if (
    analysis.opaqueRuntimeLoads !== opaqueRuntimeLoads ||
    analysis.usesBrowserGlobal !== usesBrowserGlobal
  ) {
    violations.push(`Architecture checker AST self-test failed for: ${source}`);
  }
}
const cliComponent = components.find(
  (component) => component.name === "@specra/cli",
);
const modelComponent = components.find(
  (component) => component.name === "@specra/model",
);
if (cliComponent !== undefined && modelComponent !== undefined) {
  const manifestSelfTest = [
    ...manifestViolations(
      {
        dependencies: { "@specra/config": "workspace:*" },
        devDependencies: { "@specra/openapi": "workspace:*" },
      },
      cliComponent,
    ),
    ...manifestViolations(
      { peerDependencies: { "@specra/config": "*" } },
      modelComponent,
    ),
    ...manifestViolations(
      { dependencies: { "@specra/cli": "workspace:*" } },
      cliComponent,
    ),
  ];
  if (
    manifestSelfTest.length !== 3 ||
    manifestViolations(
      { dependencies: { "@specra/config": "workspace:*" } },
      cliComponent,
    ).length !== 0
  ) {
    violations.push(
      "Architecture checker self-test failed for internal manifest dependency edges.",
    );
  }
  if (
    isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "../../../scripts/stage-cli-package.mjs",
    ) ||
    isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "../../config/src/index.js",
    ) ||
    !isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "./contracts.js",
    ) ||
    !isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "@specra/config",
    ) ||
    !isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "node:path",
    ) ||
    isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "/absolute/packages/openapi/src/index.js",
    ) ||
    isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "file:///packages/openapi/src/index.js",
    ) ||
    isRelativeImportConfined(
      cliComponent,
      path.join(root, "packages/cli/src/index.ts"),
      "#internal",
    )
  ) {
    violations.push(
      "Architecture checker self-test failed for relative import confinement.",
    );
  }
}
const declaredSelfTest = declaredInternalPackages({
  dependencies: { "@specra/config": "workspace:*" },
  devDependencies: { "@specra/model": "workspace:*" },
});
if (
  !isDeclaredEdge(declaredSelfTest, "@specra/config", true) ||
  isDeclaredEdge(declaredSelfTest, "@specra/model", true) ||
  !isDeclaredEdge(declaredSelfTest, "@specra/model", false) ||
  isDeclaredEdge(declaredSelfTest, "@specra/openapi", false)
) {
  violations.push(
    "Architecture checker self-test failed for undeclared internal imports.",
  );
}
if (
  allowedOpaqueLoads(path.join(root, "packages/cli/src/config-worker.ts")) !==
    1 ||
  allowedOpaqueLoads(path.join(root, "packages/cli/src/orchestrator.ts")) !==
    0 ||
  !isProcessBoundaryAllowed(
    path.join(root, "packages/cli/src/config-loader.ts"),
  ) ||
  isProcessBoundaryAllowed(path.join(root, "packages/config/src/index.ts"))
) {
  violations.push(
    "Architecture checker self-test failed for the reviewed exception lists.",
  );
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Architecture boundaries (${components.length} workspace packages, manifest edges, opaque loads, process boundaries) and checker self-tests passed.`,
  );
}

async function discoverComponents() {
  const discovered = [];
  for (const group of workspaceGroups) {
    for (const entry of await readdir(path.join(root, group), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const directory = `${group}/${entry.name}`;
      const manifestPath = path.join(root, directory, "package.json");
      if (!(await isFile(manifestPath))) continue;
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof manifest.name !== "string" || manifest.name.length === 0) {
        violations.push(`${directory}/package.json must declare a name.`);
        continue;
      }
      discovered.push({ directory, manifest, name: manifest.name });
    }
  }
  return discovered.sort((left, right) =>
    left.directory < right.directory ? -1 : 1,
  );
}

async function isFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function manifestViolations(manifest, component) {
  const found = [];
  const manifestPath = `${component.directory}/package.json`;
  const boundary = boundaries.get(component.name);
  for (const section of manifestSections) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (!boundaries.has(name)) continue;
      if (name === component.name) {
        found.push(`${manifestPath} declares ${section}.${name} on itself.`);
      } else if (!boundary.allowed.has(name)) {
        found.push(
          `${manifestPath} declares ${section}.${name}, crossing from ${component.name} to forbidden ${name}.`,
        );
      }
    }
  }
  if (
    component.name === "@specra/model" &&
    Object.keys(manifest.dependencies ?? {}).length > 0
  ) {
    found.push(
      `${manifestPath} must not declare runtime dependencies in model v1.`,
    );
  }
  return found;
}

function declaredInternalPackages(manifest) {
  const declared = { any: new Set(), production: new Set() };
  for (const section of manifestSections) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      if (!boundaries.has(name)) continue;
      declared.any.add(name);
      if (productionSections.has(section)) declared.production.add(name);
    }
  }
  return declared;
}

function isDeclaredEdge(declared, dependency, production) {
  return production
    ? declared.production.has(dependency)
    : declared.any.has(dependency);
}

function repositoryPath(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function allowedOpaqueLoads(file) {
  return opaqueLoadExceptions.get(repositoryPath(file)) ?? 0;
}

function isProcessBoundaryAllowed(file) {
  return processBoundaryExceptions.has(repositoryPath(file));
}

function isRelativeImportConfined(component, importer, specifier) {
  // Absolute, URL, and subpath-import specifiers cannot be attributed to a
  // package by inspection, so they are treated as leaving the boundary.
  if (
    specifier.startsWith("/") ||
    specifier.startsWith("#") ||
    (/^[a-z][a-z\d+.-]*:/i.test(specifier) && !specifier.startsWith("node:"))
  ) {
    return false;
  }
  if (!specifier.startsWith(".")) return true;
  const target = path.resolve(path.dirname(importer), specifier);
  const componentRoot = `${path.join(root, component.directory)}${path.sep}`;
  return `${target}${path.sep}`.startsWith(componentRoot);
}

function dependencyPackage(importer, specifier) {
  for (const packageName of boundaries.keys()) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`))
      return packageName;
  }
  if (!specifier.startsWith(".")) return undefined;
  return packageForPath(path.resolve(path.dirname(importer), specifier));
}

function packageForPath(file) {
  const normalized = `${path.resolve(file)}${path.sep}`;
  for (const component of components) {
    const componentRoot = `${path.join(root, component.directory)}${path.sep}`;
    if (normalized.startsWith(componentRoot)) return component.name;
  }
  return undefined;
}

function analyzeSource(source, file) {
  const specifiers = [];
  let opaqueRuntimeLoads = 0;
  let usesBrowserGlobal = false;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // A single-file program with no library or module resolution: the checker
  // then binds local declarations, parameters, and imports, so an identifier
  // without a symbol is a genuine reference to an ambient global.
  const program = ts.createProgram({
    host: {
      fileExists: (name) => name === file,
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => "",
      getDefaultLibFileName: () => "lib.d.ts",
      getNewLine: () => "\n",
      getSourceFile: (name) => (name === file ? sourceFile : undefined),
      readFile: (name) => (name === file ? source : undefined),
      useCaseSensitiveFileNames: () => true,
      writeFile: () => undefined,
    },
    options: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      noLib: true,
      noResolve: true,
      types: [],
    },
    rootNames: [file],
  });
  const checker = program.getTypeChecker();
  const browserGlobals = new Set([
    "document",
    "localStorage",
    "navigator",
    "sessionStorage",
    "window",
  ]);
  const referencesGlobal = (identifier) => {
    if (!browserGlobals.has(identifier.text) || isPropertyName(identifier))
      return false;
    const parent = identifier.parent;
    const symbol = ts.isShorthandPropertyAssignment(parent)
      ? checker.getShorthandAssignmentValueSymbol(parent)
      : checker.getSymbolAtLocation(identifier);
    return symbol === undefined;
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const runtimeLoad =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require");
      if (runtimeLoad) {
        const argument = node.arguments[0];
        if (argument !== undefined && ts.isStringLiteral(argument))
          specifiers.push(argument.text);
        else opaqueRuntimeLoads += 1;
      }
    }
    if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ((ts.isIdentifier(node.expression) &&
        (node.expression.text === "eval" ||
          node.expression.text === "Function")) ||
        (ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "getBuiltinModule") ||
        (ts.isElementAccessExpression(node.expression) &&
          staticString(node.expression.argumentExpression) ===
            "getBuiltinModule"))
    ) {
      opaqueRuntimeLoads += 1;
    }
    if (ts.isIdentifier(node) && referencesGlobal(node)) {
      usesBrowserGlobal = true;
    }
    if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name;
      const declaration = node.parent.parent;
      if (
        ts.isIdentifier(key) &&
        browserGlobals.has(key.text) &&
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer !== undefined &&
        ts.isIdentifier(declaration.initializer) &&
        declaration.initializer.text === "globalThis"
      ) {
        usesBrowserGlobal = true;
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "globalThis" &&
      browserGlobals.has(node.name.text)
    ) {
      usesBrowserGlobal = true;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "globalThis" &&
      browserGlobals.has(staticString(node.argumentExpression))
    ) {
      usesBrowserGlobal = true;
    }
    if (
      ts.isIdentifier(node) &&
      node.text === "createRequire" &&
      ts.isCallExpression(node.parent) &&
      node.parent.expression === node
    ) {
      opaqueRuntimeLoads += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { opaqueRuntimeLoads, specifiers, usesBrowserGlobal };
}

function isPropertyName(node) {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  if (ts.isShorthandPropertyAssignment(parent)) return false;
  return "name" in parent && parent.name === node;
}

function staticString(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = staticString(node.left);
    const right = staticString(node.right);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

function isModelImportAllowed(importer, specifier) {
  if (!specifier.startsWith(".")) return false;
  const target = path.resolve(path.dirname(importer), specifier);
  const modelSource = `${path.join(root, "packages/model/src")}${path.sep}`;
  return `${target}${path.sep}`.startsWith(modelSource);
}

function isProductionSource(file) {
  return !/\.test(?:-helper)?\.[cm]?[jt]sx?$/.test(file);
}

async function sourceFiles(directory, packageRoot = true) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    // Build output is skipped only at the package root so a nested source
    // directory that happens to be called `dist` is still checked.
    if (entry.name === "node_modules") continue;
    if (packageRoot && (entry.name === ".next" || entry.name === "dist"))
      continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(resolved, false)));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}
