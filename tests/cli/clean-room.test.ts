import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("CLI clean-room package", () => {
  it("installs the packed executable and validates outside the monorepo", async () => {
    const cleanRoom = await mkdtemp(path.join(tmpdir(), "specra-clean-room-"));
    try {
      const packages = path.join(cleanRoom, "packages");
      const project = path.join(cleanRoom, "project");
      await mkdir(packages);
      await mkdir(path.join(project, "docs"), { recursive: true });
      await writeFile(path.join(project, "openapi.yaml"), "openapi: 3.1.0\n");
      await writeFile(
        path.join(project, "specra.config.ts"),
        `import { defineConfig } from "@specra/config";
         export default defineConfig({ schemaVersion: 1, name: "Clean room", openapi: "./openapi.yaml" });`,
      );
      await writeFile(
        path.join(project, "package.json"),
        JSON.stringify({ name: "clean-room", private: true, version: "1.0.0" }),
      );

      const packed = command(
        "npm",
        [
          "pack",
          path.join(repositoryRoot, "packages/cli"),
          "--pack-destination",
          packages,
          "--ignore-scripts",
          "--json",
        ],
        cleanRoom,
      );
      expect(packed.status, packed.stderr).toBe(0);
      const packResult = JSON.parse(packed.stdout) as readonly [
        {
          readonly filename: string;
          readonly files: readonly { readonly path: string }[];
        },
      ];
      expect(packResult[0].files.map((file) => file.path)).toEqual(
        expect.arrayContaining(["dist/bin.js", "dist/index.d.ts"]),
      );
      const tarball = path.join(packages, packResult[0].filename);

      const installed = command(
        "npm",
        [
          "install",
          tarball,
          "--ignore-scripts",
          "--offline",
          "--no-audit",
          "--no-fund",
        ],
        project,
      );
      expect(installed.status, installed.stderr).toBe(0);

      const executable = path.join(
        project,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "specra.cmd" : "specra",
      );
      const validated = command(executable, ["validate", "--json"], project);
      expect(validated.status, validated.stderr).toBe(0);
      expect(JSON.parse(validated.stdout)).toEqual({
        artifacts: { directory: ".specra/artifacts" },
        diagnostics: [],
        ok: true,
      });

      const programmatic = command(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import path from "node:path";
           import { validateProject } from "@specra/cli";
           const result = await validateProject({ root: process.cwd() });
           console.log(JSON.stringify({ ok: result.ok, artifact: result.ok ? result.context.paths.artifactRoot.endsWith(path.join(".specra", "artifacts")) : false, diagnostics: result.diagnostics }));`,
        ],
        project,
      );
      expect(programmatic.status, programmatic.stderr).toBe(0);
      expect(JSON.parse(programmatic.stdout)).toEqual({
        artifact: true,
        diagnostics: [],
        ok: true,
      });
    } finally {
      await rm(cleanRoom, { force: true, recursive: true });
    }
  }, 20_000);
});

function command(
  executable: string,
  args: readonly string[],
  cwd: string,
): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: path.join(cwd, ".npm-cache"),
    },
    timeout: 15_000,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}
