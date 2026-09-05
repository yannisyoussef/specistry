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
const configDirectory = path.join(repositoryRoot, "packages", "config");
const cliManifest = JSON.parse(
  await readFile(path.join(cliDirectory, "package.json"), "utf8"),
);
const configManifest = JSON.parse(
  await readFile(path.join(configDirectory, "package.json"), "utf8"),
);
// The staged tree is assembled explicitly rather than by copying whatever
// `node_modules` contains. When the CLI gains a dependency, extend this script
// and the clean-room bundled-dependency assertion together.
const stagedDependencies = ["@specra/config", "zod"];
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

await mkdir(destination);
await cp(path.join(cliDirectory, "dist"), path.join(destination, "dist"), {
  recursive: true,
});
await mkdir(path.join(destination, "node_modules", "@specra", "config"), {
  recursive: true,
});
await cp(
  path.join(configDirectory, "dist"),
  path.join(destination, "node_modules", "@specra", "config", "dist"),
  { recursive: true },
);
await cp(zodDirectory, path.join(destination, "node_modules", "zod"), {
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
    "@specra/config": configManifest.version,
    zod: cliManifest.dependencies.zod,
  },
};
const stagedConfigManifest = {
  name: configManifest.name,
  version: configManifest.version,
  private: configManifest.private,
  license: configManifest.license,
  type: configManifest.type,
  exports: configManifest.exports,
  dependencies: configManifest.dependencies,
};

await Promise.all([
  writeFile(
    path.join(destination, "package.json"),
    `${JSON.stringify(stagedCliManifest, null, 2)}\n`,
  ),
  writeFile(
    path.join(destination, "node_modules", "@specra", "config", "package.json"),
    `${JSON.stringify(stagedConfigManifest, null, 2)}\n`,
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
