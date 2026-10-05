import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { licenseMetadata, readLicensePolicy } from "./lib/license-policy.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const supplied = process.argv[2];
if (supplied === undefined || process.argv.length !== 3) {
  throw new Error(
    "Usage: node scripts/build-release-candidate.mjs <new-directory>",
  );
}
const output = path.resolve(supplied);
try {
  await access(output);
  throw new Error("Release candidate output directory must not already exist.");
} catch (error) {
  if (error instanceof Error && !error.message.includes("ENOENT")) throw error;
}
await mkdir(output, { recursive: true });

const stagingRoot = await mkdtemp(path.join(tmpdir(), "specra-cli-stage-"));
const staged = run(process.execPath, [
  path.join(repositoryRoot, "scripts", "stage-cli-package.mjs"),
  path.join(stagingRoot, "package"),
]).trim();
const packedText = run("npm", [
  "pack",
  staged,
  "--pack-destination",
  output,
  "--ignore-scripts",
  "--json",
]);
const packed = JSON.parse(packedText)[0];
if (packed === undefined || typeof packed.filename !== "string") {
  throw new Error("npm pack did not report one release artifact.");
}
const manifest = JSON.parse(
  await readFile(path.join(staged, "package.json"), "utf8"),
);
const expectedBundles = [...manifest.bundleDependencies].sort();
const packedBundles = [...(packed.bundled ?? [])].sort();
if (
  expectedBundles.length !== packedBundles.length ||
  expectedBundles.some((name, index) => name !== packedBundles[index])
) {
  throw new Error(
    `Packed dependencies ${JSON.stringify(packedBundles)} differ from the staged manifest ${JSON.stringify(expectedBundles)}.`,
  );
}
const ownFiles = packed.files
  .map((entry) => entry.path)
  .filter((entry) => !entry.startsWith("node_modules/"));
const required = [
  "LICENSE",
  "LICENSES/Apache-2.0.txt",
  "NOTICE",
  "README.md",
  "dist/bin.js",
  "dist/index.d.ts",
  "package.json",
];
for (const file of required) {
  if (!ownFiles.includes(file))
    throw new Error(`Packed CLI is missing ${file}.`);
}
const forbidden = ownFiles.filter((file) =>
  /(?:^|\/)(?:\.agent|fixtures?|prompts?|reviews?|src|tests?)(?:\/|$)/i.test(
    file,
  ),
);
if (forbidden.length > 0) {
  throw new Error(`Packed CLI contains private files: ${forbidden.join(", ")}`);
}

const sbom = path.join(output, "specra-cli.cdx.json");
run(process.execPath, [
  path.join(
    repositoryRoot,
    "node_modules",
    "@cyclonedx",
    "cyclonedx-npm",
    "bin",
    "cyclonedx-npm-cli.js",
  ),
  "--omit",
  "dev",
  "--no-workspaces",
  "--output-reproducible",
  "--flatten-components",
  "--spec-version",
  "1.6",
  "--output-format",
  "JSON",
  "--output-file",
  sbom,
  "--validate",
  path.join(staged, "package.json"),
]);

const sbomDocument = JSON.parse(await readFile(sbom, "utf8"));
const sbomPackages = new Set(
  (sbomDocument.components ?? []).map((component) =>
    packageIdentity(
      component.group ? `${component.group}/${component.name}` : component.name,
      component.version,
    ),
  ),
);
const packedPackageManifests = packed.files
  .map((entry) => entry.path)
  .filter(isPackedPackageManifest);
const packedPackages = new Set(
  await Promise.all(
    packedPackageManifests.map(async (manifestPath) => {
      const packageManifest = JSON.parse(
        await readFile(path.join(staged, manifestPath), "utf8"),
      );
      return packageIdentity(packageManifest.name, packageManifest.version);
    }),
  ),
);
const missingSbomPackages = [...packedPackages].filter(
  (identity) => !sbomPackages.has(identity),
);
if (missingSbomPackages.length > 0) {
  throw new Error(
    `SBOM is missing packed package identities: ${missingSbomPackages.join(", ")}.`,
  );
}

const tarball = path.join(output, packed.filename);
const policy = await readLicensePolicy(repositoryRoot);
const releaseLicense = licenseMetadata(policy, manifest.version);
const licenseMetadataFile = path.join(output, "license-metadata.json");
await writeFile(
  licenseMetadataFile,
  `${JSON.stringify(releaseLicense, null, 2)}\n`,
);
const audit = {
  attestation: {
    executed: false,
    issuer: "protected-github-actions-workflow",
  },
  artifact: packed.filename,
  bundledDependencies: packed.bundled.sort(),
  entryCount: packed.entryCount,
  license: manifest.license,
  licenseMetadata: path.basename(licenseMetadataFile),
  node: manifest.engines.node,
  package: manifest.name,
  packageManagersTested: ["npm", "pnpm"],
  publicDistribution:
    releaseLicense.licensorConfirmed &&
    releaseLicense.finalParametersOwnerApproved
      ? "eligible-after-protected-review"
      : "blocked-owner-license-confirmation",
  sbom: path.basename(sbom),
  sourceCommit:
    process.env.GITHUB_SHA ?? run("git", ["rev-parse", "HEAD"]).trim(),
  version: manifest.version,
};
const auditFile = path.join(output, "release-audit.json");
await writeFile(auditFile, `${JSON.stringify(audit, null, 2)}\n`);

const checksumFiles = [tarball, sbom, auditFile, licenseMetadataFile];
const checksumLines = [];
for (const file of checksumFiles.sort()) {
  const bytes = await readFile(file);
  checksumLines.push(
    `${createHash("sha256").update(bytes).digest("hex")}  ${path.basename(file)}`,
  );
}
await writeFile(
  path.join(output, "SHA256SUMS"),
  `${checksumLines.join("\n")}\n`,
);
await rm(path.join(output, ".npm-cache"), { force: true, recursive: true });
await rm(stagingRoot, { force: true, recursive: true });

const outputs = (await readdir(output)).sort();
const sizes = Object.fromEntries(
  await Promise.all(
    outputs.map(async (name) => [
      name,
      (await stat(path.join(output, name))).size,
    ]),
  ),
);
process.stdout.write(`${JSON.stringify({ output, sizes }, null, 2)}\n`);

function run(command, args) {
  const environment = {
    ...process.env,
    CI: "true",
    npm_config_cache: path.join(output, ".npm-cache"),
  };
  // cyclonedx-npm shells out to npm. When this builder itself was started by
  // a pnpm script, npm_execpath points at pnpm and npm-only `ls` flags fail.
  // Let the child resolve the real npm executable from PATH instead.
  delete environment.npm_execpath;
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed (${result.status ?? "signal"}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function isPackedPackageManifest(file) {
  const segments = file.split("/");
  const nodeModules = segments.lastIndexOf("node_modules");
  if (nodeModules < 0 || segments.at(-1) !== "package.json") return false;
  const packageSegments = segments.slice(nodeModules + 1);
  return packageSegments[0]?.startsWith("@")
    ? packageSegments.length === 3
    : packageSegments.length === 2;
}

function packageIdentity(name, version) {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    typeof version !== "string" ||
    version.length === 0
  )
    throw new Error("Packed package or SBOM component lacks name or version.");
  return `${name}@${version}`;
}
