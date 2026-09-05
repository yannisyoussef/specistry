import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const components = [
  { directory: "packages/model", name: "model" },
  { directory: "packages/openapi", name: "openapi" },
  { directory: "packages/config", name: "config" },
  { directory: "apps/web", name: "web" },
];
const allowed = new Map([
  ["model", new Set()],
  ["config", new Set()],
  ["openapi", new Set(["model"])],
  ["web", new Set(["config", "model"])],
]);
const packageComponents = new Map([
  ["@specra/config", "config"],
  ["@specra/model", "model"],
  ["@specra/openapi", "openapi"],
]);
const browserGlobalPattern =
  /\b(?:document|localStorage|navigator|sessionStorage|window)\b/;

const violations = [];
for (const component of components) {
  const directory = path.join(root, component.directory);
  for (const file of await sourceFiles(directory)) {
    const source = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
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
        !isModelImportAllowed(specifier)
      ) {
        violations.push(
          `${path.relative(root, file)} imports '${specifier}', but the canonical model must remain dependency-free.`,
        );
      }
    }
    if (
      component.name === "model" &&
      isProductionSource(file) &&
      browserGlobalPattern.test(stripCommentsAndStrings(source))
    ) {
      violations.push(
        `${path.relative(root, file)} uses a browser global in the canonical model boundary.`,
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
if (isModelImportAllowed("react") || !isModelImportAllowed("node:util")) {
  violations.push(
    "Architecture checker self-test failed for dependency-free model imports.",
  );
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

function importSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function isModelImportAllowed(specifier) {
  return specifier.startsWith(".") || specifier.startsWith("node:");
}

function isProductionSource(file) {
  return !/\.test\.[cm]?[jt]sx?$/.test(file);
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\[\s\S]|[^`])*`/g, "")
    .replace(/"(?:\\.|[^"\\])*"/g, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "");
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
