import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import ts from "typescript";

const root = process.cwd();
const components = [
  { directory: "packages/model", name: "model" },
  { directory: "packages/openapi", name: "openapi" },
  { directory: "packages/config", name: "config" },
  { directory: "packages/cli", name: "cli" },
  { directory: "apps/web", name: "web" },
];
const allowed = new Map([
  ["model", new Set()],
  ["config", new Set()],
  ["cli", new Set(["config"])],
  ["openapi", new Set(["model"])],
  ["web", new Set(["config", "model"])],
]);
const packageComponents = new Map([
  ["@specra/config", "config"],
  ["@specra/cli", "cli"],
  ["@specra/model", "model"],
  ["@specra/openapi", "openapi"],
]);
const violations = [];
for (const component of components) {
  const directory = path.join(root, component.directory);
  for (const file of await sourceFiles(directory)) {
    const source = await readFile(file, "utf8");
    const analysis = analyzeSource(source, file);
    for (const specifier of analysis.specifiers) {
      const dependency = dependencyComponent(file, specifier);
      if (
        dependency !== undefined &&
        dependency !== component.name &&
        !allowed.get(component.name).has(dependency)
      ) {
        violations.push(
          `${path.relative(root, file)} crosses from ${component.name} to forbidden ${dependency} via '${specifier}'.`,
        );
      }
      if (
        component.name === "model" &&
        isProductionSource(file) &&
        !isModelImportAllowed(file, specifier)
      ) {
        violations.push(
          `${path.relative(root, file)} imports '${specifier}', but the canonical model must remain dependency-free.`,
        );
      }
    }
    if (
      component.name === "model" &&
      isProductionSource(file) &&
      analysis.usesBrowserGlobal
    ) {
      violations.push(
        `${path.relative(root, file)} uses a browser global in the canonical model boundary.`,
      );
    }
    if (
      component.name === "model" &&
      isProductionSource(file) &&
      analysis.hasOpaqueRuntimeLoad
    ) {
      violations.push(
        `${path.relative(root, file)} uses opaque runtime loading in the canonical model boundary.`,
      );
    }
  }
}

const modelPackage = JSON.parse(
  await readFile(path.join(root, "packages/model/package.json"), "utf8"),
);
if (Object.keys(modelPackage.dependencies ?? {}).length > 0) {
  violations.push(
    "packages/model/package.json must not declare runtime dependencies in model v1.",
  );
}

// Guard the checker itself against the relative-import bypass it is meant to prevent.
const selfTestSource = path.join(root, "apps/web/app/page.tsx");
if (
  dependencyComponent(
    selfTestSource,
    "../../../packages/openapi/src/index.js",
  ) !== "openapi"
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
const astSelfTest = analyzeSource(
  'const name = "react"; import(name); globalThis["win" + "dow"];',
  "self-test.ts",
);
if (!astSelfTest.hasOpaqueRuntimeLoad || !astSelfTest.usesBrowserGlobal) {
  violations.push("Architecture checker AST self-test failed.");
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries and checker self-test passed.");
}

function dependencyComponent(importer, specifier) {
  for (const [packageName, component] of packageComponents) {
    if (specifier === packageName || specifier.startsWith(`${packageName}/`))
      return component;
  }
  if (!specifier.startsWith(".")) return undefined;
  return componentForPath(path.resolve(path.dirname(importer), specifier));
}

function componentForPath(file) {
  const normalized = `${path.resolve(file)}${path.sep}`;
  for (const component of components) {
    const componentRoot = `${path.join(root, component.directory)}${path.sep}`;
    if (normalized.startsWith(componentRoot)) return component.name;
  }
  return undefined;
}

function analyzeSource(source, file) {
  const specifiers = [];
  let hasOpaqueRuntimeLoad = false;
  let usesBrowserGlobal = false;
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const browserGlobals = new Set([
    "document",
    "localStorage",
    "navigator",
    "sessionStorage",
    "window",
  ]);
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
        else hasOpaqueRuntimeLoad = true;
      }
    }
    if (
      ts.isIdentifier(node) &&
      browserGlobals.has(node.text) &&
      !isPropertyName(node)
    ) {
      usesBrowserGlobal = true;
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
    if (ts.isIdentifier(node) && node.text === "createRequire")
      hasOpaqueRuntimeLoad = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { hasOpaqueRuntimeLoad, specifiers, usesBrowserGlobal };
}

function isPropertyName(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) &&
      parent.name === node)
  );
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
  return !/\.test\.[cm]?[jt]sx?$/.test(file);
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (new Set([".next", "dist", "node_modules"]).has(entry.name)) continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(resolved)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(resolved);
  }
  return files;
}
