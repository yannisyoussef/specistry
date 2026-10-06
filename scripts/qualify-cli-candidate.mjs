import { execFileSync } from "node:child_process";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { digest, verifyPublishableManifest } from "./lib/npm-publication.mjs";
import { readReleaseIdentity } from "./lib/release-identity.mjs";

const [directory, odexaRoot] = process.argv.slice(2);
if (!directory || !odexaRoot || process.argv.length !== 4)
  throw new Error(
    "Usage: node scripts/qualify-cli-candidate.mjs <candidate> <reviewed-odexa>",
  );
const identity = await readReleaseIdentity(process.cwd());
const tarball = path.resolve(directory, identity.tarball);
const before = digest(await readFile(tarball));
verifyPublishableManifest(
  JSON.parse(
    execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  ),
  identity.version,
);
const audit = JSON.parse(
  await readFile(path.join(directory, "release-audit.json"), "utf8"),
);
if (audit.version !== identity.version || audit.artifact !== identity.tarball)
  throw new Error("Candidate identity mismatch.");
const odexaSource = execFileSync(
  "git",
  ["-C", path.resolve(odexaRoot), "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
if (
  execFileSync(
    "git",
    [
      "-C",
      path.resolve(odexaRoot),
      "status",
      "--porcelain",
      "--untracked-files=no",
    ],
    { encoding: "utf8" },
  ).trim()
)
  throw new Error(
    "Odexa integration must be committed and reviewed, not locally patched.",
  );
const work = await realpath(
  await mkdtemp(path.join(tmpdir(), "specistry-qualification-")),
);
try {
  execFileSync(
    process.execPath,
    ["scripts/check-public-boundary.mjs", "dogfood/specistry-docs", odexaRoot],
    { stdio: "inherit" },
  );
  for (const manager of ["npm", "pnpm"]) {
    const consumer = path.join(work, manager);
    await cp("dogfood/specistry-docs", consumer, {
      recursive: true,
      filter: (file) => !file.includes(`${path.sep}.specistry`),
    });
    await writeFile(
      path.join(consumer, "package.json"),
      '{"name":"qualified-consumer","private":true,"version":"1.0.0"}\n',
    );
    const args =
      manager === "npm"
        ? ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"]
        : ["add", tarball, "--ignore-scripts", "--ignore-workspace"];
    execFileSync(manager, args, {
      cwd: consumer,
      stdio: "inherit",
      env: { ...process.env, CI: "true" },
    });
    const bin = path.join(consumer, "node_modules", ".bin", "specistry");
    // pnpm exposes a shell shim, while npm exposes a symlink. Exercise the
    // public executable itself rather than interpreting either with Node.
    for (const command of ["--help", "validate", "build", "check"])
      execFileSync(bin, [command], { cwd: consumer, stdio: "inherit" });
  }
  execFileSync(
    "python3",
    [
      "-B",
      path.join(odexaRoot, "scripts", "specistry-docs.py"),
      "--tarball",
      tarball,
    ],
    { stdio: "inherit" },
  );
  if (before !== digest(await readFile(tarball)))
    throw new Error("Consumer qualification changed tarball bytes.");
  audit.qualification = {
    selfDocumentation: "PASS",
    odexa: "PASS",
    packageManagers: ["npm", "pnpm"],
    artifactSha256: before,
    odexaSource,
  };
  await writeFile(
    path.join(directory, "release-audit.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
  );
  const names = [
    identity.tarball,
    identity.sbom,
    "license-metadata.json",
    "release-audit.json",
  ].sort();
  const lines = await Promise.all(
    names.map(
      async (name) =>
        `${digest(await readFile(path.join(directory, name)))}  ${name}`,
    ),
  );
  await writeFile(path.join(directory, "SHA256SUMS"), `${lines.join("\n")}\n`);
  console.log("Exact candidate qualified; tarball unchanged.");
} finally {
  await rm(work, { recursive: true, force: true });
}
