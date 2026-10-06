import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseReleaseCatalog,
  parseReleaseManifest,
  parseRouteTable,
} from "@specistry/release";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildProject,
  deprecateRelease,
  releaseProject,
  selectCurrentRelease,
} from "../../packages/cli/src/index";

/**
 * The release workflow end to end (SPEC-010 §6–§7, §14–§16, §86, §96–§98,
 * §157, §173): build a candidate, promote it, change the source, review the
 * structured candidates through a changelog, promote again, select and roll
 * back current, deprecate, and prove immutability, idempotence, concurrency
 * convergence, crash safety, and tamper detection.
 */

const cliBin = fileURLToPath(
  new URL("../../packages/cli/dist/bin.js", import.meta.url),
);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const OPENAPI_V1 = `openapi: 3.1.0
info:
  title: Versioned
  version: 1.0.0
tags:
  - name: Inboxes
paths:
  /inboxes:
    get:
      operationId: listInboxes
      tags: [Inboxes]
      parameters:
        - name: limit
          in: query
          schema: { type: integer }
      responses:
        '200': { description: ok }
  /inboxes/{id}/raw:
    get:
      operationId: getRawMessage
      tags: [Inboxes]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200': { description: ok }
`;

const OPENAPI_V2 = `openapi: 3.1.0
info:
  title: Versioned
  version: 2.0.0
tags:
  - name: Inboxes
paths:
  /inboxes:
    get:
      operationId: listInboxes
      deprecated: true
      tags: [Inboxes]
      parameters:
        - name: limit
          in: query
          schema: { type: integer }
        - name: cursor
          in: query
          schema: { type: string }
      responses:
        '200': { description: ok }
  /inboxes/{id}/messages/wait:
    post:
      operationId: waitForMessage
      tags: [Inboxes]
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200': { description: ok }
`;

async function project(
  openapi = OPENAPI_V1,
  extraConfig = "",
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "specistry-release-"));
  temporary.push(root);
  await mkdir(path.join(root, "docs"));
  await writeFile(
    path.join(root, "docs", "index.md"),
    "---\ntitle: Versioned docs\n---\n\nRead the [guide](./guide).\n",
  );
  await writeFile(
    path.join(root, "docs", "guide.md"),
    "---\ntitle: Guide\n---\n\nSee [inboxes](/api/inboxes/list-inboxes).\n",
  );
  await writeFile(path.join(root, "openapi.yaml"), openapi);
  await writeFile(
    path.join(root, "specistry.config.ts"),
    `export default { schemaVersion: 1, name: "Versioned", openapi: "./openapi.yaml", navigation: ["guide", { api: true }], environments: { production: { baseUrl: "https://api.example.com" } }${extraConfig} };`,
  );
  return root;
}

async function fileNames(directory: string): Promise<string[]> {
  return (await readdir(directory)).sort();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

describe("release workflow", () => {
  it("promotes a candidate into an immutable release with a route table, catalog, and identity", async () => {
    const root = await project();
    const built = await buildProject({ cwd: root });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    // No catalog yet: a plain build writes no candidates.
    expect(built.candidates).toBeUndefined();

    const released = await releaseProject({ cwd: root, version: "v1" });
    expect(released.ok, JSON.stringify(released)).toBe(true);
    if (!released.ok) return;
    expect(released.release).toMatchObject({
      changelog: false,
      components: [
        "content",
        "documentation",
        "manifest",
        "navigation",
        "playground",
        "redirects",
        "routes",
        "search",
        "snippets",
      ],
      current: "v1",
      directory: ".specistry/releases/v1",
      unchanged: false,
      version: "v1",
    });
    expect(released.release.from).toBeUndefined();
    const store = path.join(root, ".specistry", "releases");
    expect(await fileNames(store)).toEqual(["catalog.json", "v1"]);
    expect(await fileNames(path.join(store, "v1"))).toEqual([
      "content.json",
      "documentation.json",
      "manifest.json",
      "navigation.json",
      "playground.json",
      "redirects.json",
      "release.json",
      "routes.json",
      "search.json",
      "snippets.json",
    ]);
    // Frozen bytes are exactly the candidate's bytes.
    for (const name of [
      "documentation.json",
      "content.json",
      "search.json",
      "snippets.json",
      "playground.json",
      "manifest.json",
    ]) {
      expect(await readFile(path.join(store, "v1", name), "utf8")).toBe(
        await readFile(
          path.join(root, ".specistry", "artifacts", name),
          "utf8",
        ),
      );
    }
    const manifest = parseReleaseManifest(
      await readFile(path.join(store, "v1", "release.json"), "utf8"),
    );
    expect(manifest.version).toBe("v1");
    expect(manifest.digest).toBe(released.release.digest);
    for (const component of Object.values(manifest.components)) {
      expect(
        sha256(await readFile(path.join(store, "v1", component.file), "utf8")),
      ).toBe(component.sha256);
    }
    const catalog = parseReleaseCatalog(
      await readFile(path.join(store, "catalog.json"), "utf8"),
    );
    expect(catalog).toEqual({
      catalogFormat: 1,
      current: "v1",
      releases: [
        {
          changelog: false,
          digest: manifest.digest,
          state: "supported",
          version: "v1",
        },
      ],
    });
    const routes = parseRouteTable(
      await readFile(path.join(store, "v1", "routes.json"), "utf8"),
    );
    expect(routes.routes.map((route) => route.path)).toEqual([
      "/docs/v1",
      "/docs/v1/guide",
      "/api/v1",
      "/api/v1/inboxes",
      "/api/v1/inboxes/list-inboxes",
      "/api/v1/inboxes/get-raw-message",
    ]);
    const text = await readFile(path.join(store, "v1", "release.json"), "utf8");
    expect(text).not.toMatch(/\/private|\/tmp|C:\\\\|\d{4}-\d{2}-\d{2}T/);
  });

  it("is idempotent for identical bytes and refuses different content under the same id", async () => {
    const root = await project();
    await buildProject({ cwd: root });
    const first = await releaseProject({ cwd: root, version: "v1" });
    expect(first.ok).toBe(true);
    const again = await releaseProject({ cwd: root, version: "v1" });
    expect(again.ok).toBe(true);
    if (!again.ok || !first.ok) return;
    expect(again.release.unchanged).toBe(true);
    expect(again.release.digest).toBe(first.release.digest);

    await writeFile(
      path.join(root, "docs", "guide.md"),
      "---\ntitle: Guide\n---\n\nChanged.\n",
    );
    await buildProject({ cwd: root, from: "v1" });
    const conflict = await releaseProject({ cwd: root, version: "v1" });
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "VERSION_ALREADY_EXISTS",
    ]);
    // The retained release is untouched.
    expect(
      sha256(
        await readFile(
          path.join(root, ".specistry", "releases", "v1", "content.json"),
          "utf8",
        ),
      ),
    ).not.toBe(
      sha256(
        await readFile(
          path.join(root, ".specistry", "artifacts", "content.json"),
          "utf8",
        ),
      ),
    );
    const caseVariant = await releaseProject({ cwd: root, version: "V1" });
    expect(caseVariant.ok).toBe(false);
    if (!caseVariant.ok)
      expect(caseVariant.diagnostics[0]?.code).toBe("VERSION_ALREADY_EXISTS");
  });

  it("requires a reviewed changelog for the structured candidates and publishes only the author's text", async () => {
    const root = await project();
    await buildProject({ cwd: root });
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);
    await writeFile(path.join(root, "openapi.yaml"), OPENAPI_V2);
    const built = await buildProject({ cwd: root });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.candidates).toEqual({
      count: 3,
      from: "v1",
      truncated: false,
    });
    const candidates = JSON.parse(
      await readFile(
        path.join(root, ".specistry", "candidates", "diff.json"),
        "utf8",
      ),
    ) as { candidates: { id: string }[] };
    expect(candidates.candidates.map((candidate) => candidate.id)).toEqual([
      "v1..candidate:operation-removed:openapi.yaml~getRawMessage",
      "v1..candidate:operation-added:openapi.yaml~waitForMessage",
      "v1..candidate:operation-changed:openapi.yaml~listInboxes",
    ]);

    const unreviewed = await releaseProject({ cwd: root, version: "v2" });
    expect(unreviewed.ok).toBe(false);
    if (!unreviewed.ok) {
      expect(
        unreviewed.diagnostics.map(
          (diagnostic) => `${diagnostic.code}@${diagnostic.path}`,
        ),
      ).toEqual(["CHANGELOG_CANDIDATE_UNREVIEWED@source/changelog/v2.json"]);
    }
    expect(await fileNames(path.join(root, ".specistry", "releases"))).toEqual([
      "catalog.json",
      "v1",
    ]);

    await mkdir(path.join(root, "changelog"));
    await writeFile(
      path.join(root, "changelog", "v2.json"),
      JSON.stringify({
        entries: [
          {
            date: "2026-09-05",
            items: [
              {
                candidates: [
                  "v1..v2:operation-added:openapi.yaml~waitForMessage",
                ],
                kind: "added",
                operation: "openapi.yaml~waitForMessage",
                text: "Wait synchronously for a message.",
              },
              {
                candidates: [
                  "v1..v2:operation-removed:openapi.yaml~getRawMessage",
                ],
                kind: "removed",
                operation: "openapi.yaml~getRawMessage",
                text: "Raw messages are gone.",
              },
            ],
          },
        ],
        from: "v1",
        omitted: ["v1..v2:operation-changed:openapi.yaml~listInboxes"],
        summary: "Version 2.",
        title: "Changelog",
      }),
    );
    const released = await releaseProject({
      cwd: root,
      current: true,
      date: "2026-09-06",
      label: "2.0",
      version: "v2",
    });
    expect(released.ok, JSON.stringify(released)).toBe(true);
    if (!released.ok) return;
    expect(released.release).toMatchObject({
      candidates: 3,
      changelog: true,
      current: "v2",
      from: "v1",
    });
    const store = path.join(root, ".specistry", "releases");
    const changelog = JSON.parse(
      await readFile(path.join(store, "v2", "changelog.json"), "utf8"),
    ) as { entries: unknown[]; reviewed: unknown };
    expect(changelog.reviewed).toEqual({
      included: [
        "v1..v2:operation-added:openapi.yaml~waitForMessage",
        "v1..v2:operation-removed:openapi.yaml~getRawMessage",
      ],
      omitted: ["v1..v2:operation-changed:openapi.yaml~listInboxes"],
    });
    expect(JSON.stringify(changelog)).not.toMatch(/We've|streamlined/);
    const catalog = parseReleaseCatalog(
      await readFile(path.join(store, "catalog.json"), "utf8"),
    );
    expect(catalog.current).toBe("v2");
    expect(
      catalog.releases.map((release) => [
        release.version,
        release.changelog,
        release.label,
        release.date,
      ]),
    ).toEqual([
      ["v1", false, undefined, undefined],
      ["v2", true, "2.0", "2026-09-06"],
    ]);
    // v1 is byte-identical to before v2 existed, and the candidates stay private.
    const v1 = parseReleaseManifest(
      await readFile(path.join(store, "v1", "release.json"), "utf8"),
    );
    expect(v1.digest).toBe(catalog.releases[0]?.digest);
    expect(await fileNames(path.join(store, "v2"))).toContain("changelog.json");
    expect(await fileNames(path.join(store, "v2"))).not.toContain("diff.json");
    const routes = parseRouteTable(
      await readFile(path.join(store, "v2", "routes.json"), "utf8"),
    );
    expect(
      routes.routes.some((route) => route.path === "/docs/v2/changelog"),
    ).toBe(true);
  });

  it("selects, rolls back, and deprecates through the catalog without touching releases", async () => {
    const root = await project();
    await buildProject({ cwd: root });
    await releaseProject({ cwd: root, version: "v1" });
    await writeFile(
      path.join(root, "docs", "guide.md"),
      "---\ntitle: Guide\n---\n\nSecond.\n",
    );
    await buildProject({ cwd: root });
    await releaseProject({ cwd: root, current: true, version: "v2" });
    const store = path.join(root, ".specistry", "releases");
    const before = {
      v1: await readFile(path.join(store, "v1", "release.json"), "utf8"),
      v2: await readFile(path.join(store, "v2", "release.json"), "utf8"),
    };
    const rollback = await selectCurrentRelease({ cwd: root, version: "v1" });
    expect(rollback.ok).toBe(true);
    if (rollback.ok) expect(rollback.catalog.current).toBe("v1");
    expect(await readFile(path.join(store, "v1", "release.json"), "utf8")).toBe(
      before.v1,
    );
    expect(await readFile(path.join(store, "v2", "release.json"), "utf8")).toBe(
      before.v2,
    );
    const missing = await selectCurrentRelease({ cwd: root, version: "v9" });
    expect(missing.ok).toBe(false);
    if (!missing.ok)
      expect(missing.diagnostics[0]?.code).toBe("VERSION_NOT_FOUND");
    const deprecateCurrent = await deprecateRelease({
      cwd: root,
      version: "v1",
    });
    expect(deprecateCurrent.ok).toBe(false);
    if (!deprecateCurrent.ok)
      expect(deprecateCurrent.diagnostics[0]?.code).toBe("VERSION_IS_CURRENT");
    const deprecated = await deprecateRelease({ cwd: root, version: "v2" });
    expect(deprecated.ok).toBe(true);
    if (deprecated.ok)
      expect(deprecated.catalog.releases[1]).toMatchObject({
        state: "deprecated",
        version: "v2",
      });
    const invalid = await selectCurrentRelease({ cwd: root, version: "../v1" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.diagnostics[0]?.code).toBe("VERSION_ID_INVALID");
  });

  it("rejects invalid version ids, missing candidates, tampered candidates, and unknown comparison bases", async () => {
    const root = await project();
    for (const version of [
      "current",
      "api",
      "v 1",
      "../x",
      "v1/../v2",
      "V1%2f",
      "",
    ]) {
      const result = await releaseProject({ cwd: root, version });
      expect(result.ok, version).toBe(false);
      if (!result.ok)
        expect(result.diagnostics[0]?.code).toBe("VERSION_ID_INVALID");
    }
    const noCandidate = await releaseProject({ cwd: root, version: "v1" });
    expect(noCandidate.ok).toBe(false);
    if (!noCandidate.ok)
      expect(noCandidate.diagnostics[0]?.code).toBe("CANDIDATE_MISSING");
    await buildProject({ cwd: root });
    const searchFile = path.join(
      root,
      ".specistry",
      "artifacts",
      "search.json",
    );
    const original = await readFile(searchFile, "utf8");
    await writeFile(searchFile, `${original} `);
    const tampered = await releaseProject({ cwd: root, version: "v1" });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok)
      expect(tampered.diagnostics[0]).toMatchObject({
        code: "CANDIDATE_INVALID",
        path: "artifact#/search.json",
      });
    await writeFile(searchFile, original);
    const unknownBase = await releaseProject({
      cwd: root,
      from: "v0",
      version: "v1",
    });
    expect(unknownBase.ok).toBe(false);
    if (!unknownBase.ok)
      expect(unknownBase.diagnostics[0]?.code).toBe("VERSION_NOT_FOUND");
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);
  });

  it("freezes configured redirects and fails on cycles, shadowing, and external targets", async () => {
    const good = await project(
      OPENAPI_V1,
      ', redirects: [{ from: "/docs/old-guide", to: "/docs/guide" }, { from: "/docs/older-guide", to: "/docs/old-guide" }]',
    );
    await buildProject({ cwd: good });
    const released = await releaseProject({ cwd: good, version: "v1" });
    expect(released.ok, JSON.stringify(released)).toBe(true);
    const redirects = JSON.parse(
      await readFile(
        path.join(good, ".specistry", "releases", "v1", "redirects.json"),
        "utf8",
      ),
    ) as { entries: unknown[] };
    expect(redirects.entries).toEqual([
      { from: "/docs/v1/old-guide", status: 308, to: "/docs/v1/guide" },
      { from: "/docs/v1/older-guide", status: 308, to: "/docs/v1/guide" },
    ]);
    const bad = await project(
      OPENAPI_V1,
      ', redirects: [{ from: "/docs/a", to: "/docs/b" }, { from: "/docs/b", to: "/docs/a" }, { from: "/docs/guide", to: "/docs/a" }]',
    );
    await buildProject({ cwd: bad });
    const failed = await releaseProject({ cwd: bad, version: "v1" });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(
        failed.diagnostics.map(
          (diagnostic) => `${diagnostic.code}@${diagnostic.path}`,
        ),
      ).toEqual([
        "REDIRECT_CYCLE@config#/redirects/0",
        "REDIRECT_CYCLE@config#/redirects/1",
        "REDIRECT_SOURCE_SHADOWS_ROUTE@config#/redirects/2",
      ]);
    }
    expect(await fileNames(path.join(bad, ".specistry"))).not.toContain(
      "releases",
    );
    const external = await project(
      OPENAPI_V1,
      ', redirects: [{ from: "/docs/x", to: "https://evil.example" }]',
    );
    const config = await buildProject({ cwd: external });
    expect(config.ok).toBe(false);
    if (!config.ok) expect(config.diagnostics[0]?.code).toBe("CONFIG_INVALID");
  });

  it("converges concurrent identical releases and rejects a concurrent different one", async () => {
    const root = await project();
    await buildProject({ cwd: root });
    const results = await Promise.all([
      releaseProject({ cwd: root, version: "v1" }),
      releaseProject({ cwd: root, version: "v1" }),
      releaseProject({ cwd: root, version: "v1" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const digests = new Set(
      results.map((result) => (result.ok ? result.release.digest : "")),
    );
    expect(digests.size).toBe(1);
    const store = path.join(root, ".specistry", "releases");
    expect(await fileNames(store)).toEqual(["catalog.json", "v1"]);
    const catalog = parseReleaseCatalog(
      await readFile(path.join(store, "catalog.json"), "utf8"),
    );
    expect(catalog.releases).toHaveLength(1);

    // Two processes with different candidates racing for v2: one wins, one fails.
    const other = await project();
    await writeFile(
      path.join(other, "docs", "guide.md"),
      "---\ntitle: Guide\n---\n\nOther.\n",
    );
    await buildProject({ cwd: other });
    await rm(path.join(other, ".specistry", "releases"), {
      force: true,
      recursive: true,
    });
    await writeFile(
      path.join(root, "docs", "guide.md"),
      "---\ntitle: Guide\n---\n\nRoot.\n",
    );
    await buildProject({ cwd: root });
    // Point the second project's store at the first one's through a copy of
    // the candidate: simulate by releasing the other candidate into root.
    await rm(path.join(root, ".specistry", "artifacts"), {
      force: true,
      recursive: true,
    });
    const raced = await Promise.all([
      releaseProject({ cwd: other, version: "v2" }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return releaseProject({ cwd: other, version: "v2" });
      })(),
    ]);
    expect(raced.every((result) => result.ok)).toBe(true);
    expect(await fileNames(path.join(other, ".specistry", "releases"))).toEqual(
      ["catalog.json", "v2"],
    );
  });

  it("never exposes a half-written release: staging leftovers are ignored and symlinked stores refused", async () => {
    const root = await project();
    await buildProject({ cwd: root });
    const store = path.join(root, ".specistry", "releases");
    await mkdir(path.join(store, ".staging-v1-deadbeef"), { recursive: true });
    await writeFile(
      path.join(store, ".staging-v1-deadbeef", "release.json"),
      "{}",
    );
    const released = await releaseProject({ cwd: root, version: "v1" });
    expect(released.ok).toBe(true);
    expect(await fileNames(store)).toEqual([
      ".staging-v1-deadbeef",
      "catalog.json",
      "v1",
    ]);
    // A version directory that is not a valid release is refused, never overwritten.
    await mkdir(path.join(store, "v2"));
    await writeFile(path.join(store, "v2", "release.json"), "{ not json");
    const broken = await releaseProject({ cwd: root, version: "v2" });
    expect(broken.ok).toBe(false);
    if (!broken.ok)
      expect(broken.diagnostics[0]?.code).toBe("RELEASE_MANIFEST_INVALID");
    expect(await readFile(path.join(store, "v2", "release.json"), "utf8")).toBe(
      "{ not json",
    );
    // A catalog that names a missing current fails closed.
    await writeFile(
      path.join(store, "catalog.json"),
      JSON.stringify({ catalogFormat: 1, current: "v9", releases: [] }),
    );
    const corrupt = await releaseProject({ cwd: root, version: "v3" });
    expect(corrupt.ok).toBe(false);
    if (!corrupt.ok)
      expect(corrupt.diagnostics[0]?.code).toBe("CATALOG_INVALID");
    // A store that escapes the project through a symlink is refused.
    const outside = await mkdtemp(path.join(tmpdir(), "specistry-outside-"));
    temporary.push(outside);
    const escaped = await project();
    await buildProject({ cwd: escaped });
    await mkdir(path.join(escaped, ".specistry"), { recursive: true });
    await symlink(outside, path.join(escaped, ".specistry", "releases"));
    const escapedRelease = await releaseProject({
      cwd: escaped,
      version: "v1",
    });
    expect(escapedRelease.ok).toBe(false);
    expect(await fileNames(outside)).toEqual([]);
  });

  it("copies assets into the release, reports unknown changelog candidates, refuses a tampered comparison base, and honours cancellation", async () => {
    const root = await project(
      OPENAPI_V1,
      ', branding: { logo: "./logo.png" }',
    );
    await writeFile(
      path.join(root, "logo.png"),
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
      ]),
    );
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    const controller = new AbortController();
    controller.abort();
    const aborted = await releaseProject({
      cwd: root,
      signal: controller.signal,
      version: "v1",
    });
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.diagnostics[0]?.code).toBe("CANCELLED");
    const released = await releaseProject({ cwd: root, version: "v1" });
    expect(released.ok, JSON.stringify(released)).toBe(true);
    const store = path.join(root, ".specistry", "releases");
    const manifest = parseReleaseManifest(
      await readFile(path.join(store, "v1", "release.json"), "utf8"),
    );
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]?.path).toMatch(/^assets\/[a-f0-9]{16}\.png$/);
    expect(await fileNames(path.join(store, "v1", "assets"))).toEqual([
      manifest.assets[0]?.path.slice("assets/".length),
    ]);

    // A changelog item naming a candidate the comparison never produced.
    await writeFile(path.join(root, "openapi.yaml"), OPENAPI_V2);
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    await mkdir(path.join(root, "changelog"));
    await writeFile(
      path.join(root, "changelog", "v2.json"),
      JSON.stringify({
        title: "Changelog",
        entries: [
          {
            date: "2026-09-06",
            items: [
              {
                kind: "added",
                candidates: ["v1..v2:operation-added:openapi.yaml~nope"],
                text: "x",
              },
            ],
          },
        ],
        omitted: "all",
      }),
    );
    const unknown = await releaseProject({ cwd: root, version: "v2" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok)
      expect(unknown.diagnostics[0]).toMatchObject({
        code: "CHANGELOG_CANDIDATE_UNKNOWN",
        path: "source/changelog/v2.json#/entries/0/items/0/candidates/0",
      });

    // A retained release whose documentation no longer matches its manifest
    // cannot serve as a comparison base.
    const documentation = path.join(store, "v1", "documentation.json");
    const original = await readFile(documentation, "utf8");
    await writeFile(documentation, `${original} `);
    const tamperedBase = await releaseProject({
      cwd: root,
      from: "v1",
      version: "v2",
    });
    expect(tamperedBase.ok).toBe(false);
    if (!tamperedBase.ok)
      expect(tamperedBase.diagnostics[0]).toMatchObject({
        code: "RELEASE_MANIFEST_INVALID",
        path: "cli#/from",
      });
    await writeFile(documentation, original);
  });

  it("recovers a stale catalog lock and reports a live one", async () => {
    const root = await project();
    await buildProject({ cwd: root });
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);
    const lock = path.join(root, ".specistry", "releases", ".lock");
    await writeFile(lock, "");
    const stale = (Date.now() - 120_000) / 1000;
    await utimes(lock, stale, stale);
    const recovered = await selectCurrentRelease({ cwd: root, version: "v1" });
    expect(recovered.ok).toBe(true);
    await writeFile(lock, "");
    const started = Date.now();
    const locked = await deprecateRelease({ cwd: root, version: "v1" });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.diagnostics[0]?.code).toBe("RELEASE_LOCKED");
    // The wait is bounded (10 s) so an abandoned live lock never hangs a CI job.
    expect(Date.now() - started).toBeLessThan(15_000);
    await rm(lock);
    expect((await deprecateRelease({ cwd: root, version: "v1" })).ok).toBe(
      false,
    );
  }, 30_000);

  it("exposes the commands through the packaged binary with human and JSON output", async () => {
    const root = await project();
    await buildProject({ cwd: root });
    const run = (args: readonly string[]) =>
      spawnSync(process.execPath, [cliBin, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 60_000,
      });
    const released = run(["release", "v1", "--json", "--date", "2026-09-06"]);
    expect(released.status, released.stderr).toBe(0);
    const json = JSON.parse(released.stdout) as {
      ok: boolean;
      release: { version: string; current: string };
    };
    expect(json.ok).toBe(true);
    expect(json.release).toMatchObject({ current: "v1", version: "v1" });
    const human = run(["release", "v1"]);
    expect(human.status).toBe(0);
    expect(human.stdout).toContain("already exists with identical content");
    const usage = run(["release"]);
    expect(usage.status).toBe(64);
    expect(usage.stderr).toContain("requires a version id");
    const badDate = run(["release", "v2", "--date", "tomorrow"]);
    expect(badDate.status).toBe(64);
    const help = run(["release", "--help"]);
    expect(help.stdout).toContain("immutable");
    const current = run(["current", "v1", "--json"]);
    expect(current.status).toBe(0);
    expect(JSON.parse(current.stdout)).toMatchObject({
      catalog: { current: "v1" },
      ok: true,
    });
    const missing = run(["current", "v7"]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("VERSION_NOT_FOUND");
    const root_help = run(["--help"]);
    expect(root_help.stdout).toContain("release");
  });
});
