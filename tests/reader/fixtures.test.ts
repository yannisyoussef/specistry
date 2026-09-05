import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * The reader fixtures commit their canonical artifacts so tests and browser
 * runs never depend on the ingestion pipeline. This guard rebuilds each fixture
 * through the packaged CLI and fails when the committed bytes drift from what
 * `specra build` produces, so a fixture can never describe a stale contract.
 */

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/reader/", import.meta.url),
);
const cliPath = fileURLToPath(
  new URL("../../packages/cli/dist/bin.js", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("reader fixtures", () => {
  it.each(["testinbox", "edge", "multi"])(
    "keeps the committed %s artifact identical to a fresh specra build",
    async (fixture) => {
      const source = path.join(fixtureRoot, fixture);
      const project = await mkdtemp(path.join(tmpdir(), "specra-fixture-"));
      temporaryDirectories.push(project);
      await cp(source, project, {
        filter: (entry) => !entry.includes(`${path.sep}.specra`),
        recursive: true,
      });
      const built = spawnSync(process.execPath, [cliPath, "build", "--json"], {
        cwd: project,
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(built.status, built.stderr).toBe(0);
      expect(JSON.parse(built.stdout)).toMatchObject({ ok: true });
      for (const file of ["documentation.json", "manifest.json"]) {
        const fresh = await readFile(
          path.join(project, ".specra", "artifacts", file),
          "utf8",
        );
        const committed = await readFile(
          path.join(source, ".specra", "artifacts", file),
          "utf8",
        );
        expect(
          fresh,
          `${fixture}/${file} drifted; rebuild it with specra build`,
        ).toBe(committed);
      }
    },
    90_000,
  );
});
