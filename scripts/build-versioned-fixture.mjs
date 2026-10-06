// Rebuilds the multi-version reader fixture (SPEC-010) from its sources with
// the packaged CLI: the v1 project under history/v1 is built and released,
// the root v2 project is built against that store (writing the private diff
// candidates) and released as current, and v1 is deprecated. Everything the
// reader serves comes from the resulting .specistry directory, which the drift
// guard reproduces byte for byte. Usage:
//   node scripts/build-versioned-fixture.mjs [<fixture dir>] [<output dir>]
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, "..", "packages", "cli", "dist", "bin.js");
const fixture = path.resolve(
  process.argv[2] ??
    path.join(here, "..", "tests", "fixtures", "reader", "versioned"),
);
const output = path.resolve(process.argv[3] ?? fixture);

function run(cwd, args) {
  const result = spawnSync(process.execPath, [cli, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `specistry ${args.join(" ")} failed in ${cwd}:\n${result.stdout}\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

const exclude = (entry) => !entry.includes(`${path.sep}.specistry`);
const work = mkdtempSync(path.join(tmpdir(), "specistry-versioned-"));
try {
  // v1: its own project, released first.
  const v1 = path.join(work, "v1");
  cpSync(path.join(fixture, "history", "v1"), v1, {
    filter: exclude,
    recursive: true,
  });
  run(v1, ["build"]);
  run(v1, ["release", "v1", "--date", "2026-08-01", "--label", "1.0"]);
  // v2: the root sources with v1's store carried over.
  const v2 = path.join(work, "v2");
  cpSync(fixture, v2, {
    filter: (entry) => exclude(entry) && !entry.includes(`${path.sep}history`),
    recursive: true,
  });
  cpSync(
    path.join(v1, ".specistry", "releases"),
    path.join(v2, ".specistry", "releases"),
    { recursive: true },
  );
  run(v2, ["build"]);
  run(v2, [
    "release",
    "v2",
    "--current",
    "--date",
    "2026-09-05",
    "--label",
    "2.0",
  ]);
  run(v2, ["deprecate", "v1"]);
  rmSync(path.join(output, ".specistry"), { force: true, recursive: true });
  cpSync(path.join(v2, ".specistry"), path.join(output, ".specistry"), {
    recursive: true,
  });
  process.stdout.write(`${path.join(output, ".specistry")}\n`);
} finally {
  rmSync(work, { force: true, recursive: true });
}
