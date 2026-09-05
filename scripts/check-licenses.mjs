import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const workspaceRoot = process.cwd();
const queue = [];
const visited = new Set();
const violations = [];

for (const workspaceGroup of ["apps", "packages"]) {
  const groupPath = path.join(workspaceRoot, workspaceGroup);
  for (const entry of await readdir(groupPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspacePath = path.join(groupPath, entry.name);
    const manifest = await readManifest(
      path.join(workspacePath, "package.json"),
    );
    const nodeModulesPath = path.join(workspacePath, "node_modules");
    enqueueDependencies(nodeModulesPath, manifest.dependencies, false);
    enqueueDependencies(nodeModulesPath, manifest.optionalDependencies, true);
  }
}

while (queue.length > 0) {
  const candidate = queue.shift();
  if (candidate === undefined) break;
  let packagePath;
  try {
    packagePath = await realpath(
      path.join(candidate.nodeModulesPath, candidate.name),
    );
  } catch (error) {
    if (candidate.optional) continue;
    throw new Error(
      `Installed manifest for '${candidate.name}' cannot be resolved.`,
      { cause: error },
    );
  }
  if (visited.has(packagePath)) continue;
  visited.add(packagePath);

  const manifest = await readManifest(path.join(packagePath, "package.json"));
  const license = licenseExpression(manifest.license);
  if (license === "UNKNOWN" || isDenied(license))
    violations.push(`${manifest.name}@${manifest.version}: ${license}`);
  const nodeModulesPath = packagePath
    .split(path.sep)
    .slice(0, -candidate.name.split("/").length)
    .join(path.sep);
  enqueueDependencies(nodeModulesPath, manifest.dependencies, false);
  enqueueDependencies(nodeModulesPath, manifest.optionalDependencies, true);
}

if (violations.length > 0) {
  console.error(
    `Denied or unknown production licenses found:\n${violations.sort().join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Production dependency license policy passed (${visited.size} packages inspected).`,
  );
}

function enqueueDependencies(nodeModulesPath, dependencies, optional) {
  if (dependencies === undefined) return;
  for (const name of Object.keys(dependencies))
    queue.push({ name, nodeModulesPath, optional });
}

async function readManifest(manifestPath) {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

function licenseExpression(license) {
  if (typeof license === "string") return license;
  if (
    license !== null &&
    typeof license === "object" &&
    typeof license.type === "string"
  ) {
    return license.type;
  }
  return "UNKNOWN";
}

function isDenied(expression) {
  const denied =
    /(?:^|[^A-Z])A?GPL-(?:1\.0|2\.0|3\.0)(?:-only|-or-later)?(?:$|[^A-Z])/i;
  return expression
    .split(/\s+OR\s+/i)
    .every((alternative) => denied.test(alternative));
}
