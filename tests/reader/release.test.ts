import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadReaderArtifact,
  ReaderArtifactError,
  resetReaderArtifactCache,
} from "../../apps/web/lib/reader/artifact";
import {
  authoredPaths,
  findPage,
  pageBreadcrumbs,
  pageNeighbours,
} from "../../apps/web/lib/reader/content";
import { indexablePaths } from "../../apps/web/lib/reader/metadata";
import {
  loadedReleaseCount,
  loadReaderCatalog,
  loadReaderFor,
  loadReaderRelease,
  loadReleaseMetadata,
  MAX_LOADED_RELEASES,
  readerMode,
  releaseForAsset,
  releaseForSearch,
  resetReleaseCaches,
  resolveVersionRoute,
  versionOfPath,
  versionSwitchTargets,
} from "../../apps/web/lib/reader/release";
import {
  partitionSitemap,
  rootSitemap,
  sitemapPartitions,
} from "../../apps/web/lib/reader/sitemap";

/**
 * Release-scoped reading (SPEC-010 §5, §24–§28, §36–§42, §98, §114–§115,
 * §171–§172): the catalog loads first, releases load lazily and stay
 * bounded, every component is verified against its release manifest, a
 * swapped component from another release is refused, historical routes
 * mean exactly what they say, aliases redirect non-permanently, and the
 * sitemap lists canonical versioned URLs only.
 */

const fixture = fileURLToPath(
  new URL("../fixtures/reader/versioned/", import.meta.url),
);
const temporary: string[] = [];

async function copyFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "specra-versioned-reader-"));
  temporary.push(root);
  await cp(path.join(fixture, ".specra"), path.join(root, ".specra"), {
    recursive: true,
  });
  return root;
}

beforeEach(() => {
  resetReleaseCaches();
  resetReaderArtifactCache();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("reader mode", () => {
  it("serves releases when a catalog exists, the candidate otherwise, and honours the override", async () => {
    expect(await readerMode(fixture)).toBe("releases");
    const testinbox = fileURLToPath(
      new URL("../fixtures/reader/testinbox/", import.meta.url),
    );
    expect(await readerMode(testinbox)).toBe("candidate");
    expect(await readerMode(fixture, { SPECRA_SERVE: "candidate" })).toBe(
      "candidate",
    );
    const candidate = await loadReaderFor("/docs/v2", fixture);
    expect(candidate.version?.id).toBe("v2");
  });
});

describe("release loader", () => {
  it("loads the catalog first and releases lazily, bounded", async () => {
    const reader = await loadReaderCatalog(fixture);
    expect(reader?.catalog.current).toBe("v2");
    expect(reader?.catalog.releases.map((release) => release.version)).toEqual([
      "v1",
      "v2",
    ]);
    expect(loadedReleaseCount()).toBe(0);
    const v1 = await loadReaderRelease("v1", fixture);
    expect(loadedReleaseCount()).toBe(1);
    expect(v1.version).toMatchObject({
      current: false,
      id: "v1",
      label: "1.0",
      state: "deprecated",
    });
    expect(v1.roots).toEqual({
      api: "/api/v1",
      docs: "/docs/v1",
      home: "/docs/v1",
    });
    // The same immutable release is served from the cache; a different one is loaded.
    expect(await loadReaderRelease("v1", fixture)).toBe(v1);
    const v2 = await loadReaderRelease("v2", fixture);
    expect(loadedReleaseCount()).toBe(2);
    expect(v2.version).toMatchObject({
      current: true,
      id: "v2",
      label: "2.0",
      state: "supported",
      changelog: true,
    });
    expect(MAX_LOADED_RELEASES).toBe(4);
  });

  it("keeps every href, route, and index inside the served release", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const v2 = await loadReaderRelease("v2", fixture);
    expect(v1.index.apiRoot).toBe("/api/v1");
    expect(
      v1.index.services[0]?.groups[0]?.operations.map(
        (operation) => operation.href,
      ),
    ).toEqual([
      "/api/v1/inboxes/list-inboxes",
      "/api/v1/inboxes/create-inbox",
      "/api/v1/inboxes/get-raw-message",
    ]);
    expect(
      v2.index.services[0]?.groups[0]?.operations.map(
        (operation) => operation.href,
      ),
    ).toEqual([
      "/api/v2/inboxes/list-inboxes",
      "/api/v2/inboxes/create-inbox",
      "/api/v2/inboxes/wait-for-message",
    ]);
    // Navigation, pages, breadcrumbs, neighbours, and authored links.
    expect([...(v1.content?.pages.keys() ?? [])]).toEqual([
      "/docs/v1",
      "/docs/v1/authentication",
      "/docs/v1/getting-started",
    ]);
    expect([...(v2.content?.pages.keys() ?? [])]).toEqual([
      "/docs/v2",
      "/docs/v2/authentication",
      "/docs/v2/quickstart",
    ]);
    expect(v1.content?.entries.map((entry) => entry.route)).toEqual([
      "/docs/v1",
      "/docs/v1/getting-started",
      "/docs/v1/authentication",
      "/api/v1",
    ]);
    const started = findPage(v1.content, "/docs/v1/getting-started")!;
    expect(pageBreadcrumbs(v1.content!, started)[0]).toEqual({
      href: "/docs/v1",
      label: "Guides",
    });
    expect(pageNeighbours(v1.content!, started.route).next?.route).toBe(
      "/docs/v1/authentication",
    );
    expect(JSON.stringify(started.body)).toContain(
      '"/api/v1/inboxes/create-inbox"',
    );
    expect(JSON.stringify(started.body)).not.toContain('"/api/inboxes');
    expect(JSON.stringify(v1.content?.home?.body)).toContain(
      '"/docs/v1/getting-started"',
    );
    expect(findPage(v2.content, "/docs/v1/quickstart")).toBeUndefined();
    expect(findPage(v2.content, "/docs/v2/quickstart")?.title).toBe(
      "Quickstart",
    );
    expect(authoredPaths(v1.content)).toEqual([
      "/docs/v1",
      "/docs/v1/getting-started",
      "/docs/v1/authentication",
    ]);
    expect(
      indexablePaths(v1.index, authoredPaths(v1.content), v1.roots),
    ).toEqual([
      "/docs/v1",
      "/docs/v1/getting-started",
      "/docs/v1/authentication",
      "/api/v1",
      "/api/v1/inboxes",
      "/api/v1/inboxes/list-inboxes",
      "/api/v1/inboxes/create-inbox",
      "/api/v1/inboxes/get-raw-message",
    ]);
    // Snippets, SDK text, search, and playground are the release's own.
    expect(Object.keys(v1.snippets?.artifact.operations ?? {})).toContain(
      "openapi.yaml~getRawMessage",
    );
    expect(Object.keys(v2.snippets?.artifact.operations ?? {})).not.toContain(
      "openapi.yaml~getRawMessage",
    );
    expect(JSON.stringify(v1.snippets?.artifact.sdkExamples)).toContain(
      "VERSIONED_API_KEY",
    );
    expect(JSON.stringify(v2.snippets?.artifact.sdkExamples)).toContain(
      "VERSIONED_TOKEN",
    );
    expect(v1.search?.json).toContain("glacier");
    expect(v1.search?.json).not.toContain("waterfall");
    expect(v2.search?.json).toContain("waterfall");
    expect(v1.search?.path).not.toBe(v2.search?.path);
    expect(v1.playground?.origins).toEqual(["http://127.0.0.1:47391"]);
    expect(v2.playground?.origins).toEqual(["http://127.0.0.1:47393"]);
  });

  it("evicts the oldest release beyond the bound without corrupting reloads", async () => {
    const root = await copyFixture();
    // Fabricate additional catalog entries pointing at copies of v1 to exceed the bound.
    const store = path.join(root, ".specra", "releases");
    const catalog = JSON.parse(
      await readFile(path.join(store, "catalog.json"), "utf8"),
    ) as { releases: { version: string }[] };
    const v1 = catalog.releases[0]!;
    for (const version of ["v1a", "v1b", "v1c", "v1d"]) {
      await cp(path.join(store, "v1"), path.join(store, version), {
        recursive: true,
      });
      const manifest = await readFile(
        path.join(store, version, "release.json"),
        "utf8",
      );
      // The manifest names the version; re-key the copy under its new id.
      const routes = (
        await readFile(path.join(store, version, "routes.json"), "utf8")
      )
        .replaceAll("/v1", `/${version}`)
        .replace('"version":"v1"', `"version":"${version}"`);
      await writeFile(path.join(store, version, "routes.json"), routes);
      const redirects = (
        await readFile(path.join(store, version, "redirects.json"), "utf8")
      ).replace('"version":"v1"', `"version":"${version}"`);
      await writeFile(path.join(store, version, "redirects.json"), redirects);
      const { createHash } = await import("node:crypto");
      const parsed = JSON.parse(manifest) as {
        version: string;
        components: Record<string, { sha256: string; bytes: number }>;
        digest: string;
        assets: unknown[];
        project: unknown;
      };
      parsed.version = version;
      parsed.components.routes = {
        ...parsed.components.routes!,
        bytes: Buffer.byteLength(routes),
        sha256: createHash("sha256").update(routes).digest("hex"),
      };
      parsed.components.redirects = {
        ...parsed.components.redirects!,
        bytes: Buffer.byteLength(redirects),
        sha256: createHash("sha256").update(redirects).digest("hex"),
      };
      const { computeReleaseDigest, serializeReleaseManifest } =
        await import("@specra/release");
      parsed.digest = computeReleaseDigest(parsed as never);
      await writeFile(
        path.join(store, version, "release.json"),
        serializeReleaseManifest(parsed as never),
      );
      catalog.releases.push({ ...v1, digest: parsed.digest, version });
    }
    await writeFile(path.join(store, "catalog.json"), JSON.stringify(catalog));
    const loaded = [];
    for (const version of ["v1", "v2", "v1a", "v1b", "v1c", "v1d"]) {
      loaded.push(await loadReaderRelease(version, root));
      expect(loadedReleaseCount()).toBeLessThanOrEqual(MAX_LOADED_RELEASES);
    }
    expect(loadedReleaseCount()).toBe(MAX_LOADED_RELEASES);
    // The evicted release reloads correctly, still its own version.
    const again = await loadReaderRelease("v1", root);
    expect(again.version?.id).toBe("v1");
    expect(again.index.apiRoot).toBe("/api/v1");
    expect(loaded[0]).not.toBe(again);
  });
});

describe("release integrity", () => {
  it("refuses a component swapped in from another release even though it parses", async () => {
    const root = await copyFixture();
    const store = path.join(root, ".specra", "releases");
    for (const file of [
      "search.json",
      "snippets.json",
      "playground.json",
      "content.json",
      "navigation.json",
      "documentation.json",
    ]) {
      await writeFile(
        path.join(store, "v1", file),
        await readFile(path.join(store, "v2", file), "utf8"),
      );
      resetReleaseCaches();
      await expect(loadReaderRelease("v1", root)).rejects.toThrow(
        /does not match the release manifest/,
      );
      await cp(
        path.join(fixture, ".specra", "releases", "v1", file),
        path.join(store, "v1", file),
      );
    }
    resetReleaseCaches();
    expect((await loadReaderRelease("v1", root)).version?.id).toBe("v1");
  });

  it("refuses a tampered route table, redirect table, changelog, manifest digest, or catalog entry", async () => {
    const root = await copyFixture();
    const store = path.join(root, ".specra", "releases");
    const original = await readFile(
      path.join(store, "v2", "routes.json"),
      "utf8",
    );
    await writeFile(
      path.join(store, "v2", "routes.json"),
      original.replace("/docs/v2/quickstart", "/docs/v2/quickstart-x"),
    );
    await expect(loadReleaseMetadata("v2", root)).rejects.toThrow(
      /does not match the release manifest/,
    );
    await writeFile(path.join(store, "v2", "routes.json"), original);
    resetReleaseCaches();
    const redirects = await readFile(
      path.join(store, "v2", "redirects.json"),
      "utf8",
    );
    await writeFile(
      path.join(store, "v2", "redirects.json"),
      redirects.replace("/docs/v2/quickstart", "https://evil.example"),
    );
    await expect(loadReleaseMetadata("v2", root)).rejects.toThrow(
      /does not match/,
    );
    await writeFile(path.join(store, "v2", "redirects.json"), redirects);
    resetReleaseCaches();
    const manifest = await readFile(
      path.join(store, "v2", "release.json"),
      "utf8",
    );
    await writeFile(
      path.join(store, "v2", "release.json"),
      manifest.replace('"version": "v2"', '"version": "v1"'),
    );
    await expect(loadReleaseMetadata("v2", root)).rejects.toThrow(
      /does not match the catalog|invalid/,
    );
    await writeFile(path.join(store, "v2", "release.json"), manifest);
    resetReleaseCaches();
    const catalog = await readFile(path.join(store, "catalog.json"), "utf8");
    await writeFile(
      path.join(store, "catalog.json"),
      catalog.replace('"current": "v2"', '"current": "v3"'),
    );
    await expect(loadReaderCatalog(root)).rejects.toThrow(
      /catalog .* is invalid/,
    );
    await writeFile(
      path.join(store, "catalog.json"),
      catalog.replace('"catalogFormat": 1', '"catalogFormat": 2'),
    );
    resetReleaseCaches();
    await expect(loadReaderCatalog(root)).rejects.toThrow(ReaderArtifactError);
  });

  it("never falls back to the current release for an unknown version", async () => {
    await expect(loadReaderRelease("v3", fixture)).rejects.toThrow(
      /not a retained release/,
    );
    await expect(loadReaderRelease("V2", fixture)).rejects.toThrow(
      /not a retained release/,
    );
    await expect(loadReaderRelease("../v2", fixture)).rejects.toThrow(
      /not a retained release/,
    );
    expect(await versionOfPath("/docs/v3/quickstart", fixture)).toBeUndefined();
    expect(await versionOfPath("/docs/v2/quickstart", fixture)).toBe("v2");
  });
});

describe("route resolution", () => {
  it("redirects mutable aliases non-permanently and serves versioned routes", async () => {
    expect(await resolveVersionRoute("/", fixture)).toEqual({
      kind: "redirect",
      location: "/docs/v2",
      status: 307,
    });
    expect(await resolveVersionRoute("/docs", fixture)).toEqual({
      kind: "redirect",
      location: "/docs/v2",
      status: 307,
    });
    expect(await resolveVersionRoute("/api", fixture)).toEqual({
      kind: "redirect",
      location: "/api/v2",
      status: 307,
    });
    expect(await resolveVersionRoute("/docs/quickstart", fixture)).toEqual({
      kind: "redirect",
      location: "/docs/v2/quickstart",
      status: 307,
    });
    expect(
      await resolveVersionRoute("/api/inboxes/create-inbox", fixture),
    ).toEqual({
      kind: "redirect",
      location: "/api/v2/inboxes/create-inbox",
      status: 307,
    });
    expect(await resolveVersionRoute("/docs/v2/quickstart", fixture)).toEqual({
      kind: "serve",
      version: "v2",
    });
    expect(
      await resolveVersionRoute("/docs/v1/getting-started", fixture),
    ).toEqual({ kind: "serve", version: "v1" });
    expect(await resolveVersionRoute("/docs/v2/changelog", fixture)).toEqual({
      kind: "serve",
      version: "v2",
    });
    expect(
      await resolveVersionRoute("/api/v1/inboxes/get-raw-message", fixture),
    ).toEqual({ kind: "serve", version: "v1" });
  });

  it("follows a catalog change (rollback) on the next request without a restart", async () => {
    const root = await copyFixture();
    expect(await resolveVersionRoute("/", root)).toEqual({
      kind: "redirect",
      location: "/docs/v2",
      status: 307,
    });
    // `specra current v1` rewrites catalog.json only; the reader notices the
    // new file (size or mtime) and re-reads it, keeping every release.
    const catalogPath = path.join(root, ".specra", "releases", "catalog.json");
    const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
      current: string;
      releases: { version: string; state: string }[];
    };
    catalog.current = "v1";
    for (const release of catalog.releases) release.state = "supported";
    await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    expect(await resolveVersionRoute("/", root)).toEqual({
      kind: "redirect",
      location: "/docs/v1",
      status: 307,
    });
    expect(await resolveVersionRoute("/docs/getting-started", root)).toEqual({
      kind: "redirect",
      location: "/docs/v1/getting-started",
      status: 307,
    });
    expect(await resolveVersionRoute("/docs/v2/quickstart", root)).toEqual({
      kind: "serve",
      version: "v2",
    });
    // Removing the catalog returns the reader to candidate mode on the next
    // request; a version route is then a real 404 (never a stale answer).
    await rm(catalogPath);
    expect(await readerMode(root)).toBe("candidate");
  });

  it("applies frozen redirects permanently and 404s everything unknown", async () => {
    expect(
      await resolveVersionRoute("/docs/v2/getting-started", fixture),
    ).toEqual({
      kind: "redirect",
      location: "/docs/v2/quickstart",
      status: 308,
    });
    // A legacy unversioned path that is a frozen redirect of the current release.
    expect(await resolveVersionRoute("/docs/getting-started", fixture)).toEqual(
      { kind: "redirect", location: "/docs/v2/quickstart", status: 307 },
    );
    for (const pathname of [
      "/docs/v3",
      "/docs/v3/quickstart",
      "/docs/does-not-exist",
      "/docs/v1/quickstart",
      "/docs/v1/changelog",
      "/api/v2/inboxes/get-raw-message",
      "/api/v1/inboxes/wait-for-message",
      "/docs/V2",
      "/docs/v2/..",
      "/api/v2/inboxes/create-inbox/extra",
    ]) {
      expect(await resolveVersionRoute(pathname, fixture), pathname).toEqual({
        kind: "not-found",
      });
    }
  });

  it("finds version counterparts by identity and falls back to the release home", async () => {
    expect(
      await versionSwitchTargets("/docs/v2/authentication", "v2", fixture),
    ).toEqual([
      { counterpart: true, href: "/docs/v2/authentication", id: "v2" },
      { counterpart: true, href: "/docs/v1/authentication", id: "v1" },
    ]);
    expect(
      await versionSwitchTargets("/docs/v2/quickstart", "v2", fixture),
    ).toEqual([
      { counterpart: true, href: "/docs/v2/quickstart", id: "v2" },
      { counterpart: false, href: "/docs/v1", id: "v1" },
    ]);
    expect(
      await versionSwitchTargets(
        "/api/v1/inboxes/get-raw-message",
        "v1",
        fixture,
      ),
    ).toEqual([
      { counterpart: false, href: "/docs/v2", id: "v2" },
      { counterpart: true, href: "/api/v1/inboxes/get-raw-message", id: "v1" },
    ]);
    expect(
      await versionSwitchTargets("/api/v1/inboxes/create-inbox", "v1", fixture),
    ).toEqual([
      { counterpart: true, href: "/api/v2/inboxes/create-inbox", id: "v2" },
      { counterpart: true, href: "/api/v1/inboxes/create-inbox", id: "v1" },
    ]);
  });
});

describe("content-addressed lookups", () => {
  it("maps a search name to exactly one release and unknown names to nothing", async () => {
    const v1 = await loadReaderRelease("v1", fixture);
    const v2 = await loadReaderRelease("v2", fixture);
    expect(
      await releaseForSearch(v1.search!.path.slice("/search/".length), fixture),
    ).toBe("v1");
    expect(
      await releaseForSearch(v2.search!.path.slice("/search/".length), fixture),
    ).toBe("v2");
    expect(
      await releaseForSearch("index.0000000000000000.json", fixture),
    ).toBeUndefined();
    expect(
      await releaseForAsset("0000000000000000.png", fixture),
    ).toBeUndefined();
  });
});

describe("sitemaps", () => {
  it("lists canonical versioned URLs per release and never an alias", async () => {
    vi.stubEnv("SPECRA_SITE_URL", "https://versioned.example.test");
    vi.stubEnv("SPECRA_PROJECT_ROOT", fixture);
    const partitions = await sitemapPartitions();
    expect(partitions.map((partition) => partition.name)).toEqual([
      "v1.xml",
      "v2.xml",
    ]);
    const index = await rootSitemap();
    expect(index).toContain("<sitemapindex");
    expect(index).toContain("https://versioned.example.test/sitemaps/v1.xml");
    expect(index).toContain("https://versioned.example.test/sitemaps/v2.xml");
    const v2 = await partitionSitemap("v2.xml");
    expect(v2).toContain("<loc>https://versioned.example.test/docs/v2</loc>");
    expect(v2).toContain(
      "<loc>https://versioned.example.test/docs/v2/changelog</loc>",
    );
    expect(v2).toContain(
      "<loc>https://versioned.example.test/api/v2/inboxes/wait-for-message</loc>",
    );
    expect(v2).not.toContain("/docs</loc>");
    expect(v2).not.toContain("test/</loc>");
    expect(v2).not.toContain("/api</loc>");
    expect(v2).not.toContain("/docs/v1");
    expect(await partitionSitemap("v3.xml")).toBeUndefined();
    expect(await partitionSitemap("../catalog.json")).toBeUndefined();
  });

  it("keeps the candidate-mode urlset", async () => {
    vi.stubEnv("SPECRA_SITE_URL", "https://docs.example.test");
    vi.stubEnv(
      "SPECRA_PROJECT_ROOT",
      fileURLToPath(new URL("../fixtures/reader/testinbox/", import.meta.url)),
    );
    resetReleaseCaches();
    const sitemap = await rootSitemap();
    expect(sitemap).toContain("<urlset");
    expect(sitemap).toContain("<loc>https://docs.example.test/</loc>");
    expect(sitemap).toContain(
      "<loc>https://docs.example.test/api/inboxes/get-inbox</loc>",
    );
    expect(await sitemapPartitions()).toEqual([]);
  });
});

describe("candidate mode compatibility", () => {
  it("still serves the unversioned reader for a project without releases", async () => {
    const testinbox = fileURLToPath(
      new URL("../fixtures/reader/testinbox/", import.meta.url),
    );
    const reader = await loadReaderArtifact(testinbox);
    expect(reader.roots).toEqual({ api: "/api", docs: "/docs", home: "/" });
    expect(reader.version).toBeUndefined();
    expect(reader.index.apiRoot).toBe("/api");
    expect(findPage(reader.content, "/docs/authentication")?.route).toBe(
      "/docs/authentication",
    );
    expect(findPage(reader.content, "/docs")?.route).toBe("/");
  });
});
