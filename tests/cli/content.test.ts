import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseContentArtifact,
  parseNavigationArtifact,
} from "@specistry/content";
import {
  parseArtifactManifest,
  parseDocumentationArtifact,
} from "@specistry/model";
import { afterEach, describe, expect, it } from "vitest";

import { buildProject, validateProject } from "../../packages/cli/src/index";

/**
 * Authored content through the real CLI orchestrator (SPEC-006): diagnostics
 * with source locations for the edge fixture, artifacts for the navigation
 * fixture, determinism across working directories, and atomic replacement of
 * stale artifacts when a later build fails.
 */

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/content/", import.meta.url),
);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function copyFixture(name: string, prefix = "specistry-content-") {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), prefix)));
  temporary.push(parent);
  const project = path.join(parent, name);
  await cp(path.join(fixtureRoot, name), project, { recursive: true });
  return project;
}

function summary(
  diagnostics: readonly {
    readonly code: string;
    readonly path?: string;
    readonly line?: number;
    readonly column?: number;
    readonly severity: string;
  }[],
): readonly string[] {
  return diagnostics.map(
    (diagnostic) =>
      `${diagnostic.severity[0]} ${diagnostic.code} ${diagnostic.path ?? "-"}${
        diagnostic.line === undefined
          ? ""
          : `:${diagnostic.line}:${diagnostic.column}`
      }`,
  );
}

async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true });
  const files: string[] = [];
  for (const entry of entries) {
    if ((await stat(path.join(directory, entry))).isFile()) files.push(entry);
  }
  return files.sort();
}

describe("specistry validate with authored content", () => {
  it("reports every authoring error with a source location and keeps going", async () => {
    const project = await copyFixture("edge");
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.outcome).toBe("validation-failure");
    expect(summary(result.diagnostics)).toEqual([
      "e CONTENT_ASSET_INVALID source/docs/links.md:15:1",
      "e CONTENT_ASSET_NOT_FOUND source/docs/links.md:9:1",
      "e CONTENT_ASSET_OUTSIDE_ROOT source/docs/links.md:13:1",
      "e CONTENT_ASSET_UNSUPPORTED source/docs/links.md:11:1",
      "e CONTENT_COMPONENT_NESTING_INVALID source/docs/index.mdx:21:1",
      "e CONTENT_COMPONENT_PROP_INVALID source/docs/index.mdx:15:1",
      "e CONTENT_COMPONENT_UNKNOWN source/docs/index.mdx:13:1",
      "e CONTENT_ESM_FORBIDDEN source/docs/nested/valid.mdx:10:1",
      "e CONTENT_EXPRESSION_FORBIDDEN source/docs/index.mdx:9:25",
      "e CONTENT_FRONTMATTER_MISSING source/docs/no-frontmatter.md:1:1",
      "e CONTENT_FRONTMATTER_UNKNOWN_FIELD source/docs/index.mdx:1:1",
      "e CONTENT_HEADING_H1 source/docs/index.mdx:7:1",
      "e CONTENT_HTML_FORBIDDEN source/docs/index.mdx:11:1",
      "e CONTENT_HTML_FORBIDDEN source/docs/index.mdx:35:19",
      "e CONTENT_LINK_SCHEME_FORBIDDEN source/docs/index.mdx:27:81",
      "e CONTENT_LINK_TARGET_MISSING source/docs/links.md:7:1",
      "e CONTENT_LINK_TARGET_MISSING source/docs/links.md:7:154",
      "e NAVIGATION_PAGE_MISSING config#/navigation/0/items/0",
      "e ROUTE_COLLISION source/docs/nested/valid.mdx:1:1",
      "e ROUTE_SLUG_INVALID source/docs/Bad Name.md:1:1",
      "w CONTENT_HEADING_SKIPPED source/docs/nested/valid.mdx:8:1",
      "w CONTENT_LINK_ANCHOR_MISSING source/docs/links.md:7:35",
      "w CONTENT_LINK_ANCHOR_MISSING source/docs/links.md:7:77",
      "w NAVIGATION_PAGE_ORPHANED source/docs/links.md:1:1",
    ]);
    // Every message is fixed text: no author-controlled fragment leaks into
    // the report, and each error has a human message.
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).not.toMatch(/alert|script|Marquee|loud/);
      expect(diagnostic.message.length).toBeGreaterThan(10);
    }
  });

  it("rejects sources and assets that escape the docs directory through symlinks", async () => {
    const project = await copyFixture("navigation");
    const parent = path.dirname(project);
    await writeFile(
      path.join(parent, "outside.md"),
      "---\ntitle: Outside\n---\n\nNot yours.\n",
    );
    await writeFile(path.join(parent, "outside.png"), Buffer.alloc(16));
    await symlink(
      path.join(parent, "outside.md"),
      path.join(project, "docs", "linked.md"),
    );
    await rm(path.join(project, "docs", "images", "diagram.png"));
    await symlink(
      path.join(parent, "outside.png"),
      path.join(project, "docs", "images", "diagram.png"),
    );
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(summary(result.diagnostics)).toEqual([
      "e CONTENT_ASSET_OUTSIDE_ROOT source/docs/index.md:9:1",
      "e CONTENT_ASSET_OUTSIDE_ROOT source/docs/index.md:14:1",
      "e CONTENT_SOURCE_OUTSIDE_ROOT source/docs/linked.md",
      "w NAVIGATION_PAGE_ORPHANED source/docs/orphan.md:1:1",
    ]);
  });

  it("rejects an image above the per-file budget and an unsupported logo", async () => {
    const project = await copyFixture("navigation");
    await writeFile(
      path.join(project, "docs", "images", "diagram.png"),
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(2 * 1_024 * 1_024),
      ]),
    );
    await writeFile(path.join(project, "logo.svg"), "<svg><script/></svg>");
    await writeFile(
      path.join(project, "specistry.config.ts"),
      `export default { schemaVersion: 1, name: "Navigation", openapi: "./openapi.yaml", branding: { logo: "./logo.svg" } };`,
    );
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(summary(result.diagnostics)).toEqual([
      "e CONTENT_ASSET_TOO_LARGE source/docs/index.md:9:1",
      "e CONTENT_ASSET_TOO_LARGE source/docs/index.md:14:1",
      "e CONTENT_ASSET_UNSUPPORTED config#/branding/logo",
    ]);
  });
});

describe("specistry build with authored content", () => {
  it("writes content, navigation, assets, and manifest records for the navigation fixture", async () => {
    const project = await copyFixture("navigation");
    const result = await buildProject({ cwd: project });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.content).toEqual({ assets: 1, pages: 6 });
    expect(summary(result.diagnostics)).toEqual([
      "w NAVIGATION_PAGE_ORPHANED source/docs/orphan.md:1:1",
    ]);
    expect(result.artifacts.files).toEqual([
      "documentation.json",
      "manifest.json",
      "content.json",
      "navigation.json",
      "search.json",
      "snippets.json",
      "playground.json",
      "assets/8a8489932558b153.png",
    ]);
    const artifacts = path.join(project, ".specistry", "artifacts");
    const manifest = parseArtifactManifest(
      await readFile(path.join(artifacts, "manifest.json"), "utf8"),
    );
    expect(manifest.files).toEqual({
      content: "content.json",
      documentation: "documentation.json",
      navigation: "navigation.json",
      playground: "playground.json",
      search: "search.json",
      snippets: "snippets.json",
    });
    expect(manifest.playground).toMatchObject({
      enabled: false,
      environments: 0,
      version: 1,
    });
    // The snippets artifact is recorded the same way (SPEC-008).
    expect(manifest.snippets).toMatchObject({
      operations: result.snippets.operations,
      sdkExamples: 0,
      version: 1,
    });
    // The search artifact is recorded with its version, size, and digest.
    expect(manifest.search).toMatchObject({
      documents: result.search.documents,
      version: 1,
    });
    expect(manifest.search?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.search?.bytes).toBeGreaterThan(1_000);
    expect(manifest.statistics.pages).toBe(6);
    expect(manifest.branding).toEqual({ accent: "#0f766e" });
    expect(manifest.assets).toEqual([
      {
        bytes: 157,
        path: "assets/8a8489932558b153.png",
        sha256:
          "8a8489932558b153cc3c27fa379c138de9a9025ec748680a0ae99a52e006945b",
      },
    ]);
    // Authored sources are recorded next to the contract with their hashes.
    expect(manifest.sources.map((source) => source.path)).toEqual([
      "docs/guides/advanced/tuning.md",
      "docs/guides/first-steps.mdx",
      "docs/index.md",
      "docs/introduction.md",
      "docs/orphan.md",
      "docs/reference/index.md",
      "openapi.yaml",
    ]);

    const content = parseContentArtifact(
      await readFile(path.join(artifacts, "content.json"), "utf8"),
    );
    expect(content.pages.map((page) => page.route)).toEqual([
      "/",
      "/docs/guides/advanced/tuning",
      "/docs/guides/first-steps",
      "/docs/introduction",
      "/docs/orphan",
      "/docs/reference",
    ]);
    const home = content.pages[0];
    expect(home?.title).toBe("Navigation home");
    // The image reference was rewritten to the content-addressed asset.
    expect(JSON.stringify(home?.body)).toContain(
      '"src":"assets/8a8489932558b153.png"',
    );
    expect(JSON.stringify(home?.body)).not.toContain("images/diagram.png");
    // The hero media poster is rewritten to the same content-addressed asset.
    const hero = home?.body[0];
    expect(hero?.kind === "hero" && hero.media?.poster).toBe(
      "assets/8a8489932558b153.png",
    );
    expect(hero?.kind === "hero" && hero.media?.link).toEqual({
      href: "/docs/introduction",
      label: "Read the introduction",
      target: "page",
    });
    const steps = content.pages.find(
      (page) => page.route === "/docs/guides/first-steps",
    );
    expect(steps?.body.map((block) => block.kind)).toEqual([
      "heading",
      "steps",
      "heading",
      "cards",
    ]);
    expect(steps?.headings.map((heading) => heading.id)).toEqual([
      "install",
      "next",
    ]);

    const navigation = parseNavigationArtifact(
      await readFile(path.join(artifacts, "navigation.json"), "utf8"),
    );
    expect(navigation.items.map((item) => item.kind)).toEqual([
      "page",
      "section",
      "api",
      "section",
    ]);
    expect(navigation.items[2]).toEqual({ kind: "api", label: "Widgets API" });
    const guides = navigation.items[1];
    expect(guides.kind === "section" && guides.items[0]).toEqual({
      kind: "page",
      label: "First steps (renamed)",
      route: "/docs/guides/first-steps",
    });

    // The canonical model lists the pages so the search slice can index them.
    const documentation = parseDocumentationArtifact(
      await readFile(path.join(artifacts, "documentation.json"), "utf8"),
    );
    expect(
      documentation.model.versions[0]?.pages.map((page) => page.id),
    ).toEqual([
      "home~",
      "docs~guides~advanced~tuning",
      "docs~guides~first-steps",
      "docs~introduction",
      "docs~orphan",
      "docs~reference",
    ]);
    // The copied asset is byte-identical to the source.
    expect(
      await readFile(path.join(artifacts, "assets", "8a8489932558b153.png")),
    ).toEqual(
      await readFile(path.join(project, "docs", "images", "diagram.png")),
    );
  });

  it("produces byte-identical artifacts from different working directories", async () => {
    const first = await copyFixture("navigation", "specistry-a-");
    const second = await copyFixture("navigation", "specistry-bbbbbbbb-");
    const results = await Promise.all([
      buildProject({ cwd: first }),
      buildProject({ cwd: second }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const firstFiles = await filesUnder(
      path.join(first, ".specistry", "artifacts"),
    );
    expect(firstFiles).toEqual(
      await filesUnder(path.join(second, ".specistry", "artifacts")),
    );
    for (const file of firstFiles) {
      const a = await readFile(
        path.join(first, ".specistry", "artifacts", file),
      );
      const b = await readFile(
        path.join(second, ".specistry", "artifacts", file),
      );
      expect(a.equals(b), file).toBe(true);
      // No absolute path from either temporary parent leaks into the output.
      expect(a.toString("latin1")).not.toContain(first);
      expect(a.toString("latin1")).not.toContain(second);
    }
  });

  it("removes stale artifacts when a later build fails and never leaves partial output", async () => {
    const project = await copyFixture("navigation");
    const artifacts = path.join(project, ".specistry", "artifacts");
    expect((await buildProject({ cwd: project })).ok).toBe(true);
    expect(await filesUnder(artifacts)).toHaveLength(8);
    await writeFile(
      path.join(project, "docs", "broken.md"),
      "---\ntitle: Broken\n---\n\n<Nope />\n",
    );
    const failed = await buildProject({ cwd: project });
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(summary(failed.diagnostics)).toContain(
      "e CONTENT_COMPONENT_UNKNOWN source/docs/broken.md:5:1",
    );
    await expect(stat(artifacts)).rejects.toMatchObject({ code: "ENOENT" });
    // Repairing the page restores the full artifact set atomically.
    await rm(path.join(project, "docs", "broken.md"));
    expect((await buildProject({ cwd: project })).ok).toBe(true);
    expect(await filesUnder(artifacts)).toHaveLength(8);
  });

  it("builds an API-only project without content artifacts", async () => {
    const project = await copyFixture("navigation");
    // The docs directory must exist (configuration contract); an empty one
    // means the project has no authored pages.
    await rm(path.join(project, "docs"), { recursive: true });
    await mkdir(path.join(project, "docs"));
    await writeFile(
      path.join(project, "specistry.config.ts"),
      `export default { schemaVersion: 1, name: "Navigation", openapi: "./openapi.yaml" };`,
    );
    const result = await buildProject({ cwd: project });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.content).toEqual({ assets: 0, pages: 0 });
    // API-only projects still get search: groups and operations.
    expect(result.search.documents).toBeGreaterThan(0);
    expect(result.artifacts.files).toEqual([
      "documentation.json",
      "manifest.json",
      "search.json",
      "snippets.json",
      "playground.json",
    ]);
    const manifest = parseArtifactManifest(
      await readFile(
        path.join(project, ".specistry", "artifacts", "manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.files.content).toBeUndefined();
    expect(manifest.assets).toBeUndefined();
  });
});
