import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseSearchArtifact } from "@specistry/search";
import { createSearchClient } from "@specistry/search/client";
import { describe, expect, it } from "vitest";

import {
  loadReaderRelease,
  resetReleaseCaches,
  resolveVersionRoute,
  versionSwitchTargets,
} from "../../apps/web/lib/reader/release";

const repositoryRoot = process.cwd();

describe("CLI clean-room package", () => {
  it("installs the packed executable and validates outside the monorepo", async () => {
    // npm's packer keys the staged root by the path it is given but its
    // bundled children by realpath. A symlinked temporary directory (macOS
    // `/var` -> `/private/var`) therefore silently drops every bundled
    // dependency, so the clean room must be canonical before staging.
    const cleanRoom = await realpath(
      await mkdtemp(path.join(tmpdir(), "specistry-clean-room-")),
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
      // An explicit SDK mapping (SPEC-008): authored code in a project file,
      // declared through the config, never inferred.
      await mkdir(path.join(project, "sdk"));
      await writeFile(
        path.join(project, "sdk", "ping.ts"),
        'import { CleanRoom } from "@clean-room/sdk";\n\nconst client = new CleanRoom();\nawait client.ping();\n',
      );
      await writeFile(
        path.join(project, "specistry.config.ts"),
        `import { defineConfig } from "@specistry/config";
         export default defineConfig({
           schemaVersion: 1,
           name: "Clean room",
           openapi: "./openapi.yaml",
           navigation: ["quickstart", { api: true }],
           environments: { production: { baseUrl: "https://example.test" } },
           sdks: [{ id: "typescript", label: "TypeScript SDK", language: "typescript", package: "@clean-room/sdk", coverage: "complete", examples: [{ operation: "ping", file: "./sdk/ping.ts" }] }],
         });`,
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
        readonly private: boolean;
        readonly name: string;
        readonly bin: Readonly<Record<string, string>>;
        readonly publishConfig: Readonly<Record<string, string>>;
        readonly bundleDependencies: readonly string[];
        readonly dependencies: Readonly<Record<string, string>>;
      };
      expect(stagedManifest).toMatchObject({
        name: "@specistry/cli",
        private: false,
        bin: { specistry: "./dist/bin.js" },
        publishConfig: {
          access: "public",
          registry: "https://registry.npmjs.org",
        },
      });
      expect(Object.keys(stagedManifest.bin)).toEqual(["specistry"]);
      // npm bundles exactly the staged closure: the declared dependencies,
      // the workspace packages' own dependencies (yaml under @specistry/openapi,
      // the parser and highlighter trees under @specistry/content), and every
      // transitive package those need, all resolved offline from the tree.
      const expectedBundled = new Set(Object.keys(stagedManifest.dependencies));
      for (const name of Object.keys(stagedManifest.dependencies)) {
        if (!name.startsWith("@specistry/")) continue;
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
          "@specistry/playground",
          "@specistry/search",
          "@specistry/snippets",
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

      const installedManifest = JSON.parse(
        await readFile(
          path.join(
            project,
            "node_modules",
            "@specistry",
            "cli",
            "package.json",
          ),
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
        process.platform === "win32" ? "specistry.cmd" : "specistry",
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
          artifacts: { directory: ".specistry/artifacts" },
          content: { assets: 1, pages: 2 },
          diagnostics: [],
          ok: true,
          search: { documents: expect.any(Number) as number },
          snippets: { operations: 1, sdkExamples: 1 },
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
            directory: ".specistry/artifacts",
            files: [
              "documentation.json",
              "manifest.json",
              "content.json",
              "navigation.json",
              "search.json",
              "snippets.json",
              "playground.json",
              expect.stringMatching(/^assets\/[a-f0-9]{16}\.png$/),
            ],
          }),
          ok: true,
        }),
      );
      // The snippets artifact carries the projection, the configured
      // environment, and the authored SDK example; the search index knows
      // the SDK label. All of it was produced offline by the packed CLI.
      const snippets = JSON.parse(
        await readFile(
          path.join(project, ".specistry", "artifacts", "snippets.json"),
          "utf8",
        ),
      ) as {
        readonly environments: readonly { readonly baseUrl: string }[];
        readonly operations: Readonly<
          Record<string, { readonly method: string }>
        >;
        readonly sdkExamples: Readonly<
          Record<
            string,
            readonly { readonly code: string; readonly sdk: string }[]
          >
        >;
      };
      expect(snippets.environments).toEqual([
        {
          baseUrl: "https://example.test",
          id: "production",
          label: "production",
        },
      ]);
      expect(Object.values(snippets.operations)[0]?.method).toBe("GET");
      expect(Object.values(snippets.sdkExamples)[0]?.[0]).toMatchObject({
        code: 'import { CleanRoom } from "@clean-room/sdk";\n\nconst client = new CleanRoom();\nawait client.ping();',
        sdk: "typescript",
      });
      // The SDK label is indexed with the operation (terms, not display text).
      const searchClient = createSearchClient(
        parseSearchArtifact(
          await readFile(
            path.join(project, ".specistry", "artifacts", "search.json"),
            "utf8",
          ),
        ),
        () => 0,
      );
      expect(
        searchClient.search("typescript sdk ping").hits[0]?.document.route,
      ).toBe("/api/operations/ping");
      const content = JSON.parse(
        await readFile(
          path.join(project, ".specistry", "artifacts", "content.json"),
          "utf8",
        ),
      ) as { readonly pages: readonly { readonly route: string }[] };
      expect(content.pages.map((page) => page.route)).toEqual([
        "/",
        "/docs/quickstart",
      ]);
      const manifest = JSON.parse(
        await readFile(
          path.join(project, ".specistry", "artifacts", "manifest.json"),
          "utf8",
        ),
      );
      expect(manifest).toEqual(
        expect.objectContaining({ artifactFormat: 1, modelVersion: 1 }),
      );
      const documentation = await readFile(
        path.join(project, ".specistry", "artifacts", "documentation.json"),
        "utf8",
      );
      expect(JSON.parse(documentation).model.modelVersion).toBe(1);

      const programmatic = command(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import path from "node:path";
           import { validateProject } from "@specistry/cli";
           const result = await validateProject({ root: process.cwd() });
           console.log(JSON.stringify({ ok: result.ok, artifact: result.ok ? result.context.paths.artifactRoot.endsWith(path.join(".specistry", "artifacts")) : false, diagnostics: result.diagnostics }));`,
        ],
        project,
      );
      expect(programmatic.status, programmatic.stderr).toBe(0);
      expect(JSON.parse(programmatic.stdout)).toEqual({
        artifact: true,
        diagnostics: [],
        ok: true,
      });

      // SPEC-011: the packed CLI evaluates documentation quality, the
      // configured gate actually fails on a real violation, and a governed
      // suppression — not a silent bypass — makes it pass again.
      const checked = command(executable, ["check", "--json"], project);
      expect(checked.status, checked.stderr).toBe(0);
      expect(checked.stderr).toBe("");
      const evaluation = JSON.parse(checked.stdout) as {
        ok: boolean;
        quality: {
          qualityFormat: number;
          summary: { gate: string; error: number };
          findings: { rule: string; target: { identity: string } }[];
        };
      };
      expect(evaluation).toMatchObject({
        ok: true,
        quality: { qualityFormat: 1, summary: { error: 0, gate: "passed" } },
      });
      // Deterministic: the same artifacts and policy give the same bytes.
      expect(command(executable, ["check", "--json"], project).stdout).toBe(
        checked.stdout,
      );

      const violation = evaluation.quality.findings.find(
        (finding) => finding.rule === "operation-description",
      );
      expect(
        violation,
        JSON.stringify(evaluation.quality.summary),
      ).toBeDefined();
      const failingConfig = `import { defineConfig } from "@specistry/config";
         export default defineConfig({
           schemaVersion: 1,
           name: "Clean room",
           openapi: "./openapi.yaml",
           navigation: ["quickstart", { api: true }],
           environments: { production: { baseUrl: "https://example.test" } },
           quality: { rules: { "operation-description": "error" } },
           sdks: [{ id: "typescript", label: "TypeScript SDK", language: "typescript", package: "@clean-room/sdk", coverage: "complete", examples: [{ operation: "ping", file: "./sdk/ping.ts" }] }],
         });`;
      await writeFile(path.join(project, "specistry.config.ts"), failingConfig);
      const failed = command(executable, ["check"], project);
      expect(failed.status).toBe(3);
      expect(failed.stderr).toContain("Quality gate failed");
      expect(failed.stderr).toContain("operation-description");

      // A typo in the policy is a configuration error, not a quiet pass.
      await writeFile(
        path.join(project, "specistry.config.ts"),
        failingConfig.replace("operation-description", "operation-descriptin"),
      );
      const typo = command(executable, ["check", "--json"], project);
      expect(typo.status).toBe(2);
      expect(JSON.parse(typo.stdout)).toMatchObject({
        diagnostics: [{ code: "QUALITY_RULE_UNKNOWN" }],
        ok: false,
      });

      await writeFile(
        path.join(project, "specistry.config.ts"),
        failingConfig.replace(
          `quality: { rules: { "operation-description": "error" } },`,
          `quality: { rules: { "operation-description": "error" }, suppressions: [{ rule: "operation-description", target: ${JSON.stringify(violation?.target.identity ?? "")}, reason: "Tracked in DOC-14; prose lands with the next release." }] },`,
        ),
      );
      const suppressed = command(executable, ["check", "--json"], project);
      expect(suppressed.status, suppressed.stderr).toBe(0);
      const governed = JSON.parse(suppressed.stdout) as {
        quality: { summary: { gate: string; suppressed: number } };
      };
      expect(governed.quality.summary).toMatchObject({
        gate: "passed",
        suppressed: 1,
      });
      // Restore the project's own configuration for the release workflow.
      await writeFile(
        path.join(project, "specistry.config.ts"),
        failingConfig.replace(
          `quality: { rules: { "operation-description": "error" } },`,
          "",
        ),
      );

      // SPEC-010: the packed CLI promotes the candidate into an immutable
      // release, diffs the next candidate against it, publishes the author's
      // changelog, and selects current; the reader then serves both versions
      // from the same project root without a rebuild.
      const releasedV1 = command(
        executable,
        [
          "release",
          "v1",
          "--json",
          "--current",
          "--date",
          "2026-08-01",
          "--label",
          "1.0",
        ],
        project,
      );
      expect(releasedV1.status, releasedV1.stderr).toBe(0);
      expect(JSON.parse(releasedV1.stdout)).toEqual(
        expect.objectContaining({
          ok: true,
          release: expect.objectContaining({
            changelog: false,
            current: "v1",
            directory: ".specistry/releases/v1",
            unchanged: false,
            version: "v1",
          }),
        }),
      );
      const store = path.join(project, ".specistry", "releases");
      const digestsOf = async (version: string) => {
        const directory = path.join(store, version);
        const digests: Record<string, string> = {};
        const walk = async (relative: string): Promise<void> => {
          const entries = await readdir(path.join(directory, relative), {
            withFileTypes: true,
          });
          for (const entry of entries.sort((a, b) =>
            a.name < b.name ? -1 : 1,
          )) {
            const name = path.posix.join(relative, entry.name);
            if (entry.isDirectory()) await walk(name);
            else
              digests[name] = createHash("sha256")
                .update(await readFile(path.join(directory, name)))
                .digest("hex");
          }
        };
        await walk("");
        return digests;
      };
      const v1Before = await digestsOf("v1");
      expect(Object.keys(v1Before)).toEqual(
        expect.arrayContaining([
          "release.json",
          "routes.json",
          "redirects.json",
          "documentation.json",
          "search.json",
        ]),
      );

      // Version 2 of the sources: a new operation, a new page, a redirect.
      await writeFile(
        path.join(project, "openapi.yaml"),
        "openapi: 3.1.0\ninfo:\n  title: Clean room\n  version: 2.0.0\npaths:\n  /ping:\n    get:\n      operationId: ping\n      responses:\n        '200':\n          description: ok\n  /pong:\n    get:\n      operationId: pong\n      responses:\n        '200':\n          description: ok\n",
      );
      await writeFile(
        path.join(project, "docs", "migration.mdx"),
        "---\ntitle: Migration\n---\n\nCall [pong](/api/operations/pong) after [ping](/api/operations/ping).\n",
      );
      await writeFile(
        path.join(project, "specistry.config.ts"),
        `import { defineConfig } from "@specistry/config";
         export default defineConfig({
           schemaVersion: 1,
           name: "Clean room",
           openapi: "./openapi.yaml",
           navigation: ["quickstart", "migration", { api: true }],
           environments: { production: { baseUrl: "https://example.test" } },
           redirects: [{ from: "/docs/upgrade", to: "/docs/migration" }],
           sdks: [{ id: "typescript", label: "TypeScript SDK", language: "typescript", package: "@clean-room/sdk", coverage: "complete", examples: [{ operation: "ping", file: "./sdk/ping.ts" }] }],
         });`,
      );
      const rebuilt = command(executable, ["build", "--json"], project);
      expect(rebuilt.status, rebuilt.stderr).toBe(0);
      expect(JSON.parse(rebuilt.stdout)).toEqual(
        expect.objectContaining({
          candidates: { count: 1, from: "v1", truncated: false },
          ok: true,
        }),
      );
      const candidates = JSON.parse(
        await readFile(
          path.join(project, ".specistry", "candidates", "diff.json"),
          "utf8",
        ),
      ) as { candidates: readonly { id: string; label: string }[] };
      expect(candidates.candidates).toEqual([
        expect.objectContaining({
          id: "v1..candidate:operation-added:openapi.yaml~pong",
          label: "GET /pong",
        }),
      ]);

      // Releasing without a review of the candidate fails closed.
      const unreviewed = command(
        executable,
        ["release", "v2", "--json", "--date", "2026-09-06"],
        project,
      );
      expect(unreviewed.status).toBe(2);
      expect(JSON.parse(unreviewed.stdout)).toEqual(
        expect.objectContaining({
          diagnostics: [
            expect.objectContaining({ code: "CHANGELOG_CANDIDATE_UNREVIEWED" }),
          ],
          ok: false,
        }),
      );
      await mkdir(path.join(project, "changelog"));
      await writeFile(
        path.join(project, "changelog", "v2.json"),
        JSON.stringify({
          title: "Changelog",
          from: "v1",
          entries: [
            {
              date: "2026-09-06",
              items: [
                {
                  kind: "added",
                  operation: "openapi.yaml~pong",
                  candidates: ["v1..v2:operation-added:openapi.yaml~pong"],
                  text: "Answer a ping.",
                },
              ],
            },
          ],
          omitted: [],
        }),
      );
      const releasedV2 = command(
        executable,
        ["release", "v2", "--json", "--date", "2026-09-06", "--label", "2.0"],
        project,
      );
      expect(releasedV2.status, releasedV2.stdout + releasedV2.stderr).toBe(0);
      expect(JSON.parse(releasedV2.stdout)).toEqual(
        expect.objectContaining({
          release: expect.objectContaining({
            candidates: 1,
            changelog: true,
            current: "v1",
            from: "v1",
            unchanged: false,
            version: "v2",
          }),
        }),
      );
      // Re-releasing identical bytes is a no-op; v1 is untouched throughout.
      const again = command(
        executable,
        ["release", "v2", "--json", "--date", "2026-09-06", "--label", "2.0"],
        project,
      );
      expect(again.status, again.stdout).toBe(0);
      expect(JSON.parse(again.stdout).release.unchanged).toBe(true);
      expect(await digestsOf("v1")).toEqual(v1Before);

      const selected = command(
        executable,
        ["current", "v2", "--json"],
        project,
      );
      expect(selected.status, selected.stderr).toBe(0);
      expect(JSON.parse(selected.stdout)).toEqual(
        expect.objectContaining({
          catalog: expect.objectContaining({
            current: "v2",
            releases: [
              expect.objectContaining({ changelog: false, version: "v1" }),
              expect.objectContaining({ changelog: true, version: "v2" }),
            ],
          }),
          ok: true,
        }),
      );
      expect(await digestsOf("v1")).toEqual(v1Before);
      const v2Redirects = JSON.parse(
        await readFile(path.join(store, "v2", "redirects.json"), "utf8"),
      );
      expect(v2Redirects).toEqual({
        entries: [
          { from: "/docs/v2/upgrade", status: 308, to: "/docs/v2/migration" },
        ],
        redirectsFormat: 1,
        version: "v2",
      });
      const published = JSON.parse(
        await readFile(path.join(store, "v2", "changelog.json"), "utf8"),
      ) as { entries: readonly { items: readonly { text: string }[] }[] };
      expect(published.entries[0]?.items[0]?.text).toBe("Answer a ping.");

      // The reader resolves aliases, frozen redirects, and both releases,
      // each scoped to its own routes; nothing falls back to current.
      resetReleaseCaches();
      const resolve = (pathname: string) =>
        resolveVersionRoute(pathname, project);
      expect(await resolve("/")).toEqual({
        kind: "redirect",
        location: "/docs/v2",
        status: 307,
      });
      expect(await resolve("/docs/quickstart")).toEqual({
        kind: "redirect",
        location: "/docs/v2/quickstart",
        status: 307,
      });
      expect(await resolve("/docs/v2/upgrade")).toEqual({
        kind: "redirect",
        location: "/docs/v2/migration",
        status: 308,
      });
      expect(await resolve("/docs/v1/upgrade")).toEqual({ kind: "not-found" });
      expect(await resolve("/docs/v1/migration")).toEqual({
        kind: "not-found",
      });
      expect(await resolve("/api/v1/operations/pong")).toEqual({
        kind: "not-found",
      });
      expect(await resolve("/api/v2/operations/pong")).toEqual({
        kind: "serve",
        version: "v2",
      });
      expect(await resolve("/docs/v3")).toEqual({ kind: "not-found" });
      const v1 = await loadReaderRelease("v1", project);
      const v2 = await loadReaderRelease("v2", project);
      expect(v1.index.operationCount).toBe(1);
      expect(v2.index.operationCount).toBe(2);
      expect([...(v1.content?.pages.keys() ?? [])]).toEqual([
        "/docs/v1",
        "/docs/v1/quickstart",
      ]);
      expect([...(v2.content?.pages.keys() ?? [])].sort()).toEqual([
        "/docs/v2",
        "/docs/v2/migration",
        "/docs/v2/quickstart",
      ]);
      expect(v1.index.apiRoot).toBe("/api/v1");
      expect(
        await versionSwitchTargets("/docs/v2/migration", "v2", project),
      ).toEqual([
        { counterpart: true, href: "/docs/v2/migration", id: "v2" },
        { counterpart: false, href: "/docs/v1", id: "v1" },
      ]);

      // SPEC-011: the public diff reads the retained releases, reports the
      // same structural facts in both modes, and changes nothing.
      const humanDiff = command(
        executable,
        ["diff", "--from", "v1", "--to", "v2"],
        project,
      );
      expect(humanDiff.status, humanDiff.stderr).toBe(0);
      expect(humanDiff.stdout).toContain("Specistry diff v1 → v2");
      expect(humanDiff.stdout).toContain("+ GET /pong");
      const jsonDiff = command(
        executable,
        ["diff", "--from", "v1", "--to", "v2", "--json"],
        project,
      );
      expect(jsonDiff.status, jsonDiff.stderr).toBe(0);
      expect(jsonDiff.stderr).toBe("");
      expect(JSON.parse(jsonDiff.stdout)).toMatchObject({
        diff: {
          candidates: [
            {
              id: "v1..v2:operation-added:openapi.yaml~pong",
              kind: "operation-added",
            },
          ],
          diffFormat: 1,
          from: "v1",
          to: "v2",
        },
        ok: true,
      });
      // Deterministic and read-only.
      expect(
        command(
          executable,
          ["diff", "--from", "v1", "--to", "v2", "--json"],
          project,
        ).stdout,
      ).toBe(jsonDiff.stdout);
      expect(await digestsOf("v1")).toEqual(v1Before);
      const compatibility = command(
        executable,
        ["check", "--version", "v2", "--from", "v1", "--json"],
        project,
      );
      expect(compatibility.status).toBe(0);
      expect(JSON.parse(compatibility.stdout)).toMatchObject({
        quality: {
          comparison: { from: "v1" },
          target: { kind: "release", version: "v2" },
        },
      });

      // pnpm is the second supported consumer package manager. Install the
      // exact same tarball into another empty project, still offline, and
      // prove the public executable is linked without a workspace.
      const pnpmProject = path.join(cleanRoom, "pnpm-project");
      await mkdir(pnpmProject);
      await writeFile(
        path.join(pnpmProject, "package.json"),
        JSON.stringify({
          name: "pnpm-consumer",
          private: true,
          version: "1.0.0",
        }),
      );
      const pnpmCli = process.env.npm_execpath;
      expect(
        pnpmCli,
        "pnpm must expose npm_execpath to its test process",
      ).toEqual(expect.stringContaining("pnpm"));
      const pnpmInstalled = command(
        process.execPath,
        [pnpmCli!, "add", "--offline", "--ignore-scripts", tarball],
        pnpmProject,
      );
      expect(pnpmInstalled.status, pnpmInstalled.stderr).toBe(0);
      const pnpmExecutable = path.join(
        pnpmProject,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "specistry.cmd" : "specistry",
      );
      const help = command(pnpmExecutable, ["--help"], pnpmProject);
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toContain("build      Validate and write");
    } finally {
      await rm(cleanRoom, { force: true, recursive: true });
    }
    // Pack, offline install, validate, two authored builds with the
    // highlighter, the quality gate cases, two releases, the public diff,
    // and the reader take ~18 s uninstrumented and ~45 s under coverage on
    // a GitHub runner; the ceiling is generous so timing never fails it.
  }, 240_000);
});

function command(
  executable: string,
  args: readonly string[],
  cwd: string,
): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  // npm and pnpm may be installed by a host runtime older than Specistry's
  // supported Node line. Package installation is still useful evidence, but
  // execute their linked public bin with this test process's validated Node.
  const linkedSpecistry = new Set(["specistry", "specistry.cmd"]).has(
    path.basename(executable),
  );
  const installedEntry = path.resolve(
    path.dirname(executable),
    "../@specistry/cli/dist/bin.js",
  );
  const result = spawnSync(
    linkedSpecistry ? process.execPath : executable,
    linkedSpecistry ? [installedEntry, ...args] : args,
    {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: path.join(cwd, ".npm-cache"),
      },
      timeout: 60_000,
    },
  );
  if (result.error !== undefined) throw result.error;
  return result;
}
