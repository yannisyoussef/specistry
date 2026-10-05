import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * The multi-version fixture commits its release store so reader tests and
 * browser runs never depend on the release pipeline. This guard reproduces
 * the store from the fixture's sources through the packaged CLI (build,
 * release, build, release, deprecate) and fails on any byte drift, proving
 * releases are deterministic and the fixture describes exactly what
 * `specra release` produces (SPEC-010 §102–§103).
 */

const fixture = fileURLToPath(
  new URL("../fixtures/reader/versioned/", import.meta.url),
);
const script = fileURLToPath(
  new URL("../../scripts/build-versioned-fixture.mjs", import.meta.url),
);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function files(directory: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => (left.name < right.name ? -1 : 1),
  )) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory())
      out.push(
        ...(await files(path.join(directory, entry.name), `${relative}/`)),
      );
    else out.push(relative);
  }
  return out;
}

describe("versioned fixture", () => {
  it("keeps the committed release store identical to a fresh build-release-release run", async () => {
    const output = await mkdtemp(
      path.join(tmpdir(), "specra-versioned-drift-"),
    );
    temporary.push(output);
    const result = spawnSync(process.execPath, [script, fixture, output], {
      encoding: "utf8",
      timeout: 180_000,
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const committed = path.join(fixture, ".specra");
    const fresh = path.join(output, ".specra");
    const committedFiles = await files(committed);
    expect(await files(fresh)).toEqual(committedFiles);
    for (const file of committedFiles) {
      expect(await readFile(path.join(fresh, file)), file).toEqual(
        await readFile(path.join(committed, file)),
      );
    }
    expect(committedFiles).toContain("releases/catalog.json");
    expect(committedFiles).toContain("releases/v1/release.json");
    expect(committedFiles).toContain("releases/v2/changelog.json");
    expect(committedFiles).toContain("candidates/diff.json");
  }, 240_000);
});
