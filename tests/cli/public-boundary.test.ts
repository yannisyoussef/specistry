import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("public consumer boundary", () => {
  it("accepts documented package imports and ignores prose", async () => {
    const root = await consumer();
    await writeFile(
      path.join(root, "specra.config.ts"),
      'import { defineConfig } from "@specra/config";\nexport default defineConfig({ name: "Docs", schemaVersion: 1 });\n',
    );
    await mkdir(path.join(root, "docs"));
    await writeFile(
      path.join(root, "docs", "boundary.md"),
      "Documentation may explain why packages/*/src is private.\n",
    );
    expect(run(root)).toMatchObject({ status: 0, stderr: "" });
  });

  it("rejects monorepo paths, local protocols, helpers, and hidden overrides", async () => {
    for (const source of [
      'import "../../packages/model/src/index.js";',
      '{"dependencies":{"@specra/cli":"workspace:*"}}',
      'import "@specra/model/dist/index.js";',
      'import "./fixtures.test-helper.js";',
      "process.env.SPECRA_PRIVATE_ROOT",
    ]) {
      const root = await consumer();
      await writeFile(path.join(root, "consumer.mjs"), source);
      const result = run(root);
      expect(result.status, source).toBe(1);
      expect(result.stderr, source).toContain("Private Specra boundary");
    }
  });
});

async function consumer(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "specra-boundary-"));
  directories.push(root);
  return root;
}

function run(root: string) {
  return spawnSync(
    process.execPath,
    [path.resolve("scripts/check-public-boundary.mjs"), root],
    { encoding: "utf8" },
  );
}
