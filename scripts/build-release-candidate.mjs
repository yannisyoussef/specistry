import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

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

const staged = path.join(output, "staged-cli");
run(process.execPath, [
  path.join(repositoryRoot, "scripts", "stage-cli-package.mjs"),
  staged,
]);
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
const ownFiles = packed.files
  .map((entry) => entry.path)
  .filter((entry) => !entry.startsWith("node_modules/"));
const required = [
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
  "--ignore-npm-errors",
  "--no-workspaces",
  "--output-reproducible",
  "--spec-version",
  "1.6",
  "--output-format",
  "JSON",
  "--output-file",
  sbom,
  "--validate",
  path.join(staged, "package.json"),
]);

const tarball = path.join(output, packed.filename);
const manifest = JSON.parse(
  await readFile(path.join(staged, "package.json"), "utf8"),
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
  node: manifest.engines.node,
  package: manifest.name,
  packageManagersTested: ["npm", "pnpm"],
  publicDistribution:
    manifest.license === "UNLICENSED"
      ? "blocked-owner-license-decision"
      : "eligible-after-protected-review",
  sbom: path.basename(sbom),
  sourceCommit:
    process.env.GITHUB_SHA ?? run("git", ["rev-parse", "HEAD"]).trim(),
  version: manifest.version,
};
const auditFile = path.join(output, "release-audit.json");
await writeFile(auditFile, `${JSON.stringify(audit, null, 2)}\n`);

const checksumFiles = [tarball, sbom, auditFile];
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

// The staging tree exists only to make the package and SBOM inspectable. It is
// intentionally retained in the local evidence directory, which is ignored by
// Git; callers may compare it with the tarball before release.
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
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "true",
      npm_config_cache: path.join(output, ".npm-cache"),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} failed (${result.status ?? "signal"}): ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}
