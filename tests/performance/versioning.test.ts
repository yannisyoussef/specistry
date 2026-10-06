import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseDocumentationArtifact } from "@specistry/model";
import { diffArtifacts, serializeContractDiff } from "@specistry/release";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  loadedReleaseCount,
  loadReaderCatalog,
  loadReaderRelease,
  resetReleaseCaches,
} from "../../apps/web/lib/reader/release";
import {
  partitionSitemap,
  sitemapPartitions,
} from "../../apps/web/lib/reader/sitemap";
import { leanOperationsDocument } from "./ingestion-generator.mjs";

/**
 * Multi-version evidence (SPEC-010 §127–§135, §204): a 20-release catalog
 * costs one small file at startup and one release per first request;
 * releases stay bounded in memory; the structured diff of two
 * 10,000-operation contracts stays fast and bounded; release promotion
 * time and store growth are recorded; a large release's sitemap partitions
 * deterministically. Budgets are regression ceilings; the numbers are the
 * evidence.
 */

const cliBin = fileURLToPath(
  new URL("../../packages/cli/dist/bin.js", import.meta.url),
);
const evidencePath = fileURLToPath(
  new URL("./versioning-measurements.json", import.meta.url),
);
const versioned = fileURLToPath(
  new URL("../fixtures/reader/versioned/", import.meta.url),
);
const temporary: string[] = [];
const evidence: Record<string, unknown>[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

afterAll(async () => {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
});

function run(
  cwd: string,
  args: readonly string[],
): { ms: number; json: Record<string, unknown> } {
  const started = performance.now();
  const result = spawnSync(process.execPath, [cliBin, ...args, "--json"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
  });
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  return {
    json: JSON.parse(result.stdout) as Record<string, unknown>,
    ms: performance.now() - started,
  };
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    total += entry.isDirectory()
      ? await directorySize(full)
      : (await stat(full)).size;
  }
  return total;
}

/** A project with 20 retained releases of a 200-operation contract, each with a different page. */
async function twentyReleases(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "specistry-versions-"));
  temporary.push(root);
  await mkdir(path.join(root, "docs"));
  // The generator returns JSON text already.
  await writeFile(path.join(root, "openapi.json"), leanOperationsDocument(200));
  await writeFile(
    path.join(root, "specistry.config.ts"),
    'export default { schemaVersion: 1, name: "Many", openapi: "./openapi.json", environments: { a: { baseUrl: "https://a.example.com" } } };',
  );
  const promotions: number[] = [];
  let firstBuildMs = 0;
  for (let index = 1; index <= 20; index += 1) {
    await writeFile(
      path.join(root, "docs", "index.md"),
      `---\ntitle: Release ${index}\n---\n\nRelease ${index} of the Many API. Keyword release${index}.\n`,
    );
    const built = run(root, ["build"]);
    if (index === 1) firstBuildMs = built.ms;
    promotions.push(run(root, ["release", `v${index}`, "--current"]).ms);
  }
  evidence.push({
    catalogBytes: (
      await stat(path.join(root, ".specistry", "releases", "catalog.json"))
    ).size,
    firstBuildMs: Math.round(firstBuildMs),
    kind: "twenty-releases",
    promotionMsAverage: Math.round(
      promotions.reduce((total, ms) => total + ms, 0) / promotions.length,
    ),
    promotionMsMax: Math.round(Math.max(...promotions)),
    storeBytes: await directorySize(path.join(root, ".specistry", "releases")),
    storeBytesPerRelease: Math.round(
      (await directorySize(path.join(root, ".specistry", "releases"))) / 20,
    ),
  });
  return root;
}

describe("multi-version reader", () => {
  it("starts from a small catalog, loads releases lazily, and bounds memory across 20 releases", async () => {
    const root = await twentyReleases();
    resetReleaseCaches();
    if (global.gc) global.gc();
    const before = process.memoryUsage();
    const catalogStart = performance.now();
    const reader = await loadReaderCatalog(root);
    const catalogMs = performance.now() - catalogStart;
    expect(reader?.catalog.releases).toHaveLength(20);
    expect(reader?.catalog.current).toBe("v20");
    expect(loadedReleaseCount()).toBe(0);
    const afterCatalog = process.memoryUsage();
    const firstStart = performance.now();
    await loadReaderRelease("v20", root);
    const firstMs = performance.now() - firstStart;
    const secondStart = performance.now();
    await loadReaderRelease("v19", root);
    const secondMs = performance.now() - secondStart;
    const cachedStart = performance.now();
    await loadReaderRelease("v20", root);
    const cachedMs = performance.now() - cachedStart;
    for (let index = 1; index <= 20; index += 1)
      await loadReaderRelease(`v${index}`, root);
    if (global.gc) global.gc();
    const afterAll20 = process.memoryUsage();
    const measurement = {
      cachedReleaseMs: Number(cachedMs.toFixed(3)),
      catalogHeapBytesDelta: afterCatalog.heapUsed - before.heapUsed,
      catalogMs: Number(catalogMs.toFixed(3)),
      firstReleaseMs: Number(firstMs.toFixed(3)),
      heapBytesAfterTouchingAll: afterAll20.heapUsed,
      kind: "reader-memory",
      loadedReleasesAfterTouchingAll: loadedReleaseCount(),
      rssBytesAfterTouchingAll: afterAll20.rss,
      secondReleaseMs: Number(secondMs.toFixed(3)),
    };
    evidence.push(measurement);
    expect(loadedReleaseCount()).toBeLessThanOrEqual(4);
    expect(catalogMs).toBeLessThan(200);
    expect(cachedMs).toBeLessThan(firstMs);
    // Touching every release must not cost 20 parsed releases of heap.
    expect(afterAll20.heapUsed - afterCatalog.heapUsed).toBeLessThan(
      200 * 1024 * 1024,
    );
  }, 300_000);
});

describe("structured diff at scale", () => {
  it("diffs two 10,000-operation contracts quickly with a bounded, value-free output", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "specistry-diff-scale-"));
    temporary.push(root);
    await mkdir(path.join(root, "docs"));
    await writeFile(
      path.join(root, "specistry.config.ts"),
      'export default { schemaVersion: 1, name: "Scale", openapi: "./openapi.json", environments: { a: { baseUrl: "https://a.example.com" } } };',
    );
    await writeFile(
      path.join(root, "openapi.json"),
      leanOperationsDocument(10_000),
    );
    run(root, ["build"]);
    const before = parseDocumentationArtifact(
      await readFile(
        path.join(root, ".specistry", "artifacts", "documentation.json"),
        "utf8",
      ),
    );
    // Next release: drop 1,000 operations, add 1,000, change 2,000 descriptions.
    const document = JSON.parse(leanOperationsDocument(10_000)) as {
      paths: Record<
        string,
        Record<string, { description?: string; summary?: string }>
      >;
    };
    const keys = Object.keys(document.paths);
    for (const key of keys.slice(0, 1_000)) delete document.paths[key];
    for (let index = 0; index < 1_000; index += 1) {
      document.paths[`/added/${index}`] = {
        get: {
          ...Object.values(document.paths[keys[1_500]!]!)[0]!,
          summary: `Added ${index}`,
        },
      };
      (
        document.paths[`/added/${index}`]!.get as { operationId?: string }
      ).operationId = `added${index}`;
    }
    for (const key of keys.slice(2_000, 4_000)) {
      const operation = Object.values(document.paths[key]!)[0]!;
      operation.description = `${operation.description ?? ""} changed`;
    }
    await writeFile(path.join(root, "openapi.json"), JSON.stringify(document));
    run(root, ["build"]);
    const after = parseDocumentationArtifact(
      await readFile(
        path.join(root, ".specistry", "artifacts", "documentation.json"),
        "utf8",
      ),
    );
    const rssBefore = process.memoryUsage().rss;
    const started = performance.now();
    const diff = diffArtifacts(
      { artifact: before, version: "v1" },
      { artifact: after, version: "v2" },
    );
    const diffMs = performance.now() - started;
    const text = serializeContractDiff(diff);
    const measurement = {
      candidates: diff.candidates.length,
      counts: diff.counts,
      diffMs: Number(diffMs.toFixed(1)),
      kind: "diff-10000",
      outputBytes: Buffer.byteLength(text, "utf8"),
      rssBytesDelta: process.memoryUsage().rss - rssBefore,
      truncated: diff.truncated,
    };
    evidence.push(measurement);
    expect(diff.counts["operation-removed"]).toBe(1_000);
    expect(diff.counts["operation-added"]).toBe(1_000);
    expect(diff.counts["operation-changed"]).toBe(2_000);
    expect(diff.truncated).toBe(false);
    expect(diffMs).toBeLessThan(10_000);
    expect(text).not.toMatch(/breaking|"value"/);
    // Byte-identical across runs.
    expect(
      serializeContractDiff(
        diffArtifacts(
          { artifact: before, version: "v1" },
          { artifact: after, version: "v2" },
        ),
      ),
    ).toBe(text);
  }, 300_000);
});

describe("sitemap scale", () => {
  it("partitions a large release deterministically and never lists an alias", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "specistry-sitemap-scale-"));
    temporary.push(root);
    await cp(
      path.join(versioned, ".specistry"),
      path.join(root, ".specistry"),
      {
        recursive: true,
      },
    );
    // Inflate v2's route table to cross the partition threshold; the manifest
    // digest is recomputed so the tampering guard accepts the inflated table.
    const store = path.join(root, ".specistry", "releases");
    const routes = JSON.parse(
      await readFile(path.join(store, "v2", "routes.json"), "utf8"),
    ) as {
      routes: {
        identity: string;
        indexable: boolean;
        kind: string;
        path: string;
      }[];
    };
    for (let index = 0; index < 100_000; index += 1) {
      routes.routes.push({
        identity: `page:bulk-${index}`,
        indexable: true,
        kind: "page",
        path: `/docs/v2/bulk-${index}`,
      });
    }
    const text = `${JSON.stringify(routes)}\n`;
    await writeFile(path.join(store, "v2", "routes.json"), text);
    const { createHash } = await import("node:crypto");
    const {
      computeReleaseDigest,
      serializeReleaseManifest,
      parseReleaseManifest,
    } = await import("@specistry/release");
    const manifest = parseReleaseManifest(
      await readFile(path.join(store, "v2", "release.json"), "utf8"),
    );
    const components = {
      ...manifest.components,
      routes: {
        ...manifest.components.routes!,
        bytes: Buffer.byteLength(text, "utf8"),
        sha256: createHash("sha256").update(text).digest("hex"),
      },
    };
    const digest = computeReleaseDigest({
      assets: manifest.assets,
      components,
    });
    await writeFile(
      path.join(store, "v2", "release.json"),
      serializeReleaseManifest({ ...manifest, components, digest }),
    );
    const catalog = await readFile(path.join(store, "catalog.json"), "utf8");
    await writeFile(
      path.join(store, "catalog.json"),
      catalog.replace(manifest.digest, digest),
    );
    resetReleaseCaches();
    process.env.SPECISTRY_SITE_URL = "https://versioned.example.test";
    process.env.SPECISTRY_PROJECT_ROOT = root;
    try {
      const started = performance.now();
      const partitions = await sitemapPartitions();
      const first = await partitionSitemap("v2-1.xml");
      const last = await partitionSitemap("v2-3.xml");
      const ms = performance.now() - started;
      evidence.push({
        kind: "sitemap-100000",
        ms: Number(ms.toFixed(1)),
        partitions: partitions.map((partition) => partition.name),
        urlsInFirst: (first?.match(/<url>/g) ?? []).length,
      });
      expect(partitions.map((partition) => partition.name)).toEqual([
        "v1.xml",
        "v2-1.xml",
        "v2-2.xml",
        "v2-3.xml",
      ]);
      expect((first?.match(/<url>/g) ?? []).length).toBe(45_000);
      expect((last?.match(/<url>/g) ?? []).length).toBe(100_009 - 90_000);
      expect(first).not.toContain(
        "<loc>https://versioned.example.test/docs</loc>",
      );
      expect(ms).toBeLessThan(5_000);
    } finally {
      delete process.env.SPECISTRY_SITE_URL;
      delete process.env.SPECISTRY_PROJECT_ROOT;
      resetReleaseCaches();
    }
  }, 120_000);
});
