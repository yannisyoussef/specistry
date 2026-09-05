import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const destinationArgument = process.argv[2];
if (destinationArgument === undefined || process.argv.length !== 3) {
  throw new Error("Usage: node scripts/stage-cli-package.mjs <new-directory>");
}

// The destination is canonicalized through its nearest existing ancestor so
// the printed path never traverses a symlink. npm's packer keys the staged
// root by the given path and bundled children by realpath; packing through a
// symlinked path (macOS `/var` -> `/private/var`) silently drops every bundled
// dependency, so callers must pack exactly the path printed by this script.
const destination = await canonicalDestination(
  path.resolve(destinationArgument),
);
const canonicalRepositoryRoot = await realpath(repositoryRoot);
if (
  destination === canonicalRepositoryRoot ||
  destination.startsWith(`${canonicalRepositoryRoot}${path.sep}`)
) {
  throw new Error("CLI package staging must be outside the repository.");
}

const cliDirectory = path.join(repositoryRoot, "packages", "cli");
const cliManifest = JSON.parse(
  await readFile(path.join(cliDirectory, "package.json"), "utf8"),
);
// The staged tree is assembled explicitly rather than by copying whatever
// `node_modules` contains. When the CLI gains a dependency, extend this script
// and the clean-room bundled-dependency assertion together.
const stagedDependencies = [
  "@specra/config",
  "@specra/model",
  "@specra/openapi",
  "yaml",
  "zod",
];
const declaredDependencies = Object.keys(cliManifest.dependencies ?? {}).sort();
if (
  declaredDependencies.length !== stagedDependencies.length ||
  declaredDependencies.some((name, index) => name !== stagedDependencies[index])
) {
  throw new Error(
    `CLI dependencies ${JSON.stringify(declaredDependencies)} differ from the staged set ${JSON.stringify(stagedDependencies)}; update scripts/stage-cli-package.mjs.`,
  );
}
const zodDirectory = await realpath(
  path.join(cliDirectory, "node_modules", "zod"),
);
const yamlDirectory = await realpath(
  path.join(cliDirectory, "node_modules", "yaml"),
);
const workspacePackages = ["config", "model", "openapi"];
const manifests = Object.fromEntries(
  await Promise.all(
    workspacePackages.map(async (name) => [
      name,
      JSON.parse(
        await readFile(
          path.join(repositoryRoot, "packages", name, "package.json"),
          "utf8",
        ),
      ),
    ]),
  ),
);

await mkdir(destination);
await cp(path.join(cliDirectory, "dist"), path.join(destination, "dist"), {
  recursive: true,
});
for (const name of workspacePackages) {
  const target = path.join(destination, "node_modules", "@specra", name);
  await mkdir(target, { recursive: true });
  await cp(
    path.join(repositoryRoot, "packages", name, "dist"),
    path.join(target, "dist"),
    { recursive: true },
  );
}
await cp(zodDirectory, path.join(destination, "node_modules", "zod"), {
  dereference: true,
  recursive: true,
});
await cp(yamlDirectory, path.join(destination, "node_modules", "yaml"), {
  dereference: true,
  recursive: true,
});

const stagedCliManifest = {
  name: cliManifest.name,
  version: cliManifest.version,
  private: cliManifest.private,
  license: cliManifest.license,
  type: cliManifest.type,
  engines: cliManifest.engines,
  bin: cliManifest.bin,
  bundleDependencies: cliManifest.bundleDependencies,
  exports: cliManifest.exports,
  files: cliManifest.files,
  dependencies: {
    "@specra/config": manifests.config.version,
    "@specra/model": manifests.model.version,
    "@specra/openapi": manifests.openapi.version,
    yaml: cliManifest.dependencies.yaml,
    zod: cliManifest.dependencies.zod,
  },
};
const stagedWorkspaceManifest = (name) => {
  const manifest = manifests[name];
  const dependencies = Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).map(([dependency, range]) => [
      dependency,
      range === "workspace:*"
        ? manifests[dependency.replace("@specra/", "")].version
        : range,
    ]),
  );
  return {
    name: manifest.name,
    version: manifest.version,
    private: manifest.private,
    license: manifest.license,
    type: manifest.type,
    exports: manifest.exports,
    dependencies,
  };
};

await Promise.all([
  writeFile(
    path.join(destination, "package.json"),
    `${JSON.stringify(stagedCliManifest, null, 2)}\n`,
  ),
  ...workspacePackages.map((name) =>
    writeFile(
      path.join(destination, "node_modules", "@specra", name, "package.json"),
      `${JSON.stringify(stagedWorkspaceManifest(name), null, 2)}\n`,
    ),
  ),
]);

process.stdout.write(`${destination}\n`);

async function canonicalDestination(candidate) {
  const parent = path.dirname(candidate);
  if (parent === candidate) return candidate;
  try {
    return path.join(await realpath(parent), path.basename(candidate));
  } catch {
    return path.join(
      await canonicalDestination(parent),
      path.basename(candidate),
    );
  }
}
