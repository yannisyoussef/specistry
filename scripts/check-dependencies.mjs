import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPaths = ["package.json"];

for (const group of ["apps", "packages"]) {
  for (const entry of await readdir(path.join(root, group), {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      manifestPaths.push(path.join(group, entry.name, "package.json"));
    }
  }
}

const violations = [];
for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(
    await readFile(path.join(root, manifestPath), "utf8"),
  );
  if (manifest.private !== true) {
    violations.push(
      `${manifestPath}: workspace packages must remain private before an explicit publication decision`,
    );
  }
  if (typeof manifest.license !== "string" || manifest.license.length === 0) {
    violations.push(`${manifestPath}: license must be explicit`);
  }
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!isAllowedVersion(version)) {
        violations.push(
          `${manifestPath}: ${section}.${name} must use an exact version or workspace:*`,
        );
      }
    }
  }
}

const rootManifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
if (!/^pnpm@\d+\.\d+\.\d+$/.test(rootManifest.packageManager ?? "")) {
  violations.push(
    "package.json: packageManager must pin an exact pnpm version",
  );
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Dependency manifest policy passed (${manifestPaths.length} manifests inspected).`,
  );
}

function isAllowedVersion(version) {
  return (
    version === "workspace:*" ||
    (typeof version === "string" &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  );
}
