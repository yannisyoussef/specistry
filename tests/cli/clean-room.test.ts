import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("CLI clean-room package", () => {
  it("installs the packed executable and validates outside the monorepo", async () => {
    // npm's packer keys the staged root by the path it is given but its
    // bundled children by realpath. A symlinked temporary directory (macOS
    // `/var` -> `/private/var`) therefore silently drops every bundled
    // dependency, so the clean room must be canonical before staging.
    const cleanRoom = await realpath(
      await mkdtemp(path.join(tmpdir(), "specra-clean-room-")),
    );
    try {
      const packages = path.join(cleanRoom, "packages");
      const staged = path.join(cleanRoom, "staged-cli");
      const project = path.join(cleanRoom, "project");
      await mkdir(packages);
      await mkdir(path.join(project, "docs", "images"), { recursive: true });
      // An authored site next to the contract: two pages, one image, and a
      // configured navigation that inserts the generated API reference.
      await writeFile(
        path.join(project, "docs", "index.mdx"),
        '---\ntitle: Clean room docs\ndescription: Built offline from the packed CLI.\n---\n\n<Callout type="tip">\n\nRead the [quickstart](./quickstart).\n\n</Callout>\n\n![Diagram](./images/diagram.png)\n',
      );
      await writeFile(
        path.join(project, "docs", "quickstart.mdx"),
        "---\ntitle: Quickstart\n---\n\n## Ping\n\nCall [ping](/api/operations/ping).\n\n```bash\ncurl https://example.test/ping\n```\n",
      );
      await writeFile(
        path.join(project, "docs", "images", "diagram.png"),
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
          0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
          0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
        ]),
      );
      await writeFile(
        path.join(project, "openapi.yaml"),
        "openapi: 3.1.0\ninfo:\n  title: Clean room\n  version: 1.0.0\npaths:\n  /ping:\n    get:\n      operationId: ping\n      responses:\n        '200':\n          description: ok\n",
      );
      await writeFile(
        path.join(project, "specra.config.ts"),
        `import { defineConfig } from "@specra/config";
         export default defineConfig({ schemaVersion: 1, name: "Clean room", openapi: "./openapi.yaml", navigation: ["quickstart", { api: true }] });`,
      );
      await writeFile(
        path.join(project, "package.json"),
        JSON.stringify({ name: "clean-room", private: true, version: "1.0.0" }),
      );

      const staging = command(
        process.execPath,
        [path.join(repositoryRoot, "scripts", "stage-cli-package.mjs"), staged],
        cleanRoom,
      );
      expect(staging.status, staging.stderr).toBe(0);
      expect(staging.stdout.trim()).toBe(staged);

      const packed = command(
        "npm",
        [
          "pack",
          staged,
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
          readonly bundled: readonly string[];
          readonly entryCount: number;
        },
      ];
      expect(packResult[0].files.map((file) => file.path)).toEqual(
        expect.arrayContaining(["dist/bin.js", "dist/index.d.ts"]),
      );
      const packedPaths = packResult[0].files.map((file) => file.path);
      expect(
        packedPaths.every(
          (packedPath) =>
            !path.isAbsolute(packedPath) &&
            !packedPath.split("/").includes(".."),
        ),
      ).toBe(true);
      expect(
        packedPaths.filter((packedPath) =>
          packedPath.endsWith("zod/package.json"),
        ),
        JSON.stringify({
          bundled: packResult[0].bundled,
          entryCount: packResult[0].entryCount,
          sample: packedPaths.slice(-10),
        }),
      ).toEqual(["node_modules/zod/package.json"]);
      const stagedManifest = JSON.parse(
        await readFile(path.join(staged, "package.json"), "utf8"),
      ) as {
        readonly bundleDependencies: readonly string[];
        readonly dependencies: Readonly<Record<string, string>>;
      };
      // npm bundles exactly the staged closure: the declared dependencies,
      // the workspace packages' own dependencies (yaml under @specra/openapi,
      // the parser and highlighter trees under @specra/content), and every
      // transitive package those need, all resolved offline from the tree.
      const expectedBundled = new Set(Object.keys(stagedManifest.dependencies));
      for (const name of Object.keys(stagedManifest.dependencies)) {
        if (!name.startsWith("@specra/")) continue;
        const nested = JSON.parse(
          await readFile(
            path.join(staged, "node_modules", name, "package.json"),
            "utf8",
          ),
        ) as { readonly dependencies?: Readonly<Record<string, string>> };
        for (const dependency of Object.keys(nested.dependencies ?? {})) {
          expectedBundled.add(dependency);
        }
      }
      const bundled = [...packResult[0].bundled].sort();
      expect(bundled).toEqual([...stagedManifest.bundleDependencies].sort());
      for (const name of expectedBundled) expect(bundled).toContain(name);
      expect(bundled).toEqual(
        expect.arrayContaining([
          "mdast-util-from-markdown",
          "micromark",
          "@shikijs/core",
          "@shikijs/engine-javascript",
          "@specra/search",
          "minisearch",
        ]),
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
      expect(installed.stderr).toBe("");

      const installedManifest = JSON.parse(
        await readFile(
          path.join(project, "node_modules", "@specra", "cli", "package.json"),
          "utf8",
        ),
      );
      expect(installedManifest.engines).toEqual({
        node: ">=24.20.0 <25",
      });

      const executable = path.join(
        project,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "specra.cmd" : "specra",
      );
      const validated = command(executable, ["validate", "--json"], project);
      if (validated.status !== 0) {
        // Surface the CLI's own report; the exit code alone says nothing.
        throw new Error(
          `validate failed (${validated.status}):\n${validated.stdout}\n${validated.stderr}`,
        );
      }
      expect(JSON.parse(validated.stdout)).toEqual(
        expect.objectContaining({
          artifacts: { directory: ".specra/artifacts" },
          content: { assets: 1, pages: 2 },
          diagnostics: [],
          ok: true,
          search: { documents: expect.any(Number) as number },
          statistics: {
            documents: 1,
            operations: 1,
            references: 0,
            schemas: 0,
          },
        }),
      );

      const built = command(executable, ["build", "--json"], project);
      expect(built.status, built.stderr).toBe(0);
      expect(JSON.parse(built.stdout)).toEqual(
        expect.objectContaining({
          artifacts: expect.objectContaining({
            directory: ".specra/artifacts",
            files: [
              "documentation.json",
              "manifest.json",
              "content.json",
              "navigation.json",
              "search.json",
              expect.stringMatching(/^assets\/[a-f0-9]{16}\.png$/),
            ],
          }),
          ok: true,
        }),
      );
      const content = JSON.parse(
        await readFile(
          path.join(project, ".specra", "artifacts", "content.json"),
          "utf8",
        ),
      ) as { readonly pages: readonly { readonly route: string }[] };
      expect(content.pages.map((page) => page.route)).toEqual([
        "/",
        "/docs/quickstart",
      ]);
      const manifest = JSON.parse(
        await readFile(
          path.join(project, ".specra", "artifacts", "manifest.json"),
          "utf8",
        ),
      );
      expect(manifest).toEqual(
        expect.objectContaining({ artifactFormat: 1, modelVersion: 1 }),
      );
      const documentation = await readFile(
        path.join(project, ".specra", "artifacts", "documentation.json"),
        "utf8",
      );
      expect(JSON.parse(documentation).model.modelVersion).toBe(1);

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
    // Pack, offline install, validate, and an authored build with the
    // highlighter take ~8 s uninstrumented and ~20 s under coverage on a
    // GitHub runner; the ceiling is generous so timing never fails the case.
  }, 120_000);
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
    timeout: 60_000,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}
