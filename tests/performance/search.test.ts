import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { parseContentArtifact, parseNavigationArtifact } from "@specra/content";
import { parseDocumentationArtifact } from "@specra/model";
import { parseSnippetsArtifact } from "@specra/snippets";
import {
  buildSearch,
  parseSearchArtifact,
  projectSearchDocuments,
} from "@specra/search";
import { createSearchClient } from "@specra/search/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { writeSyntheticSite } from "./content-generator.mjs";
import { leanOperationsDocument } from "./ingestion-generator.mjs";

/**
 * Search at scale (SPEC-007 §124–128): for the TestInbox fixture, a 1,000
 * page site, a 10,000-operation API, and both combined, measure projection,
 * index construction, serialization, artifact bytes and gzip bytes, browser-
 * style hydration (`createSearchClient` from the parsed artifact), and query
 * latency for the golden queries. Large projects are built by the packaged
 * orchestrator in a fresh process so the measurements include the real CLI
 * path; the search core is then measured in this process from the artifacts
 * it wrote. Budgets are regression ceilings, the numbers are the evidence.
 */

const cliIndex = fileURLToPath(
  new URL("../../packages/cli/dist/index.js", import.meta.url),
);
const evidencePath = fileURLToPath(
  new URL("./search-measurements.json", import.meta.url),
);
const fixtureRoot = fileURLToPath(
  new URL("../fixtures/reader/testinbox/", import.meta.url),
);
const temporary: string[] = [];
const evidence: Record<string, unknown>[] = [];
const QUERIES = [
  "create inbox",
  "POST /v1/inboxes",
  "authentication",
  "expiresAt",
  "inbox",
  "auth",
  "getResource12",
  "section 3 page 4",
  "heading 5",
];

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

interface Measurement {
  readonly kind: string;
  readonly pages: number;
  readonly operations: number;
  readonly documents: number;
  readonly terms: number;
  readonly projectMs: number;
  readonly indexMs: number;
  readonly serializeMs: number;
  readonly artifactBytes: number;
  readonly gzipBytes: number;
  readonly hydrateMs: number;
  readonly queryMedianMs: number;
  readonly queryMaxMs: number;
  readonly buildMs?: number;
  readonly maxRssBytes?: number;
}

async function measureArtifacts(
  kind: string,
  artifacts: string,
  extra: Partial<Measurement> = {},
) {
  const artifact = parseDocumentationArtifact(
    await readFile(path.join(artifacts, "documentation.json"), "utf8"),
  );
  let pages: readonly Parameters<
    typeof projectSearchDocuments
  >[0]["pages"][number][] = [];
  let navigation: Parameters<typeof projectSearchDocuments>[0]["navigation"];
  try {
    pages = parseContentArtifact(
      await readFile(path.join(artifacts, "content.json"), "utf8"),
    ).pages;
    navigation = parseNavigationArtifact(
      await readFile(path.join(artifacts, "navigation.json"), "utf8"),
    );
  } catch {
    // API-only project.
  }
  const operations =
    artifact.model.versions[0]?.services.reduce(
      (total, service) => total + service.operations.length,
      0,
    ) ?? 0;
  // SDK labels are indexed with mapped operations (SPEC-008); the build
  // derives them from the snippets artifact it wrote alongside.
  const operationTerms = new Map<string, readonly string[]>();
  try {
    const snippets = parseSnippetsArtifact(
      await readFile(path.join(artifacts, "snippets.json"), "utf8"),
    );
    const labels = new Map(snippets.sdks.map((sdk) => [sdk.id, sdk.label]));
    for (const [key, examples] of Object.entries(snippets.sdkExamples)) {
      operationTerms.set(
        key,
        examples.flatMap((example) => labels.get(example.sdk) ?? []),
      );
    }
  } catch {
    // Older artifact without snippets.
  }
  const input = { artifact, navigation, operationTerms, pages };
  const projectStart = performance.now();
  const projection = projectSearchDocuments(input);
  const projectMs = performance.now() - projectStart;
  const indexStart = performance.now();
  const built = buildSearch(input);
  const indexMs = performance.now() - indexStart - projectMs;
  const serializeStart = performance.now();
  const json = built.json;
  const serializeMs = performance.now() - serializeStart;
  // The reader serves the same bytes; the browser parses and hydrates them.
  const written = await readFile(path.join(artifacts, "search.json"), "utf8");
  expect(written).toBe(json);
  const hydrateStart = performance.now();
  const client = createSearchClient(parseSearchArtifact(json), () =>
    performance.now(),
  );
  const hydrateMs = performance.now() - hydrateStart;
  const latencies: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    for (const query of QUERIES) {
      const started = performance.now();
      const response = client.search(query);
      latencies.push(performance.now() - started);
      expect(response.hits.length).toBeLessThanOrEqual(12);
    }
  }
  latencies.sort((left, right) => left - right);
  const measurement: Measurement = {
    ...extra,
    artifactBytes: Buffer.byteLength(json, "utf8"),
    documents: projection.documents.length,
    gzipBytes: gzipSync(json).byteLength,
    hydrateMs: Number(hydrateMs.toFixed(1)),
    indexMs: Number(Math.max(indexMs, 0).toFixed(1)),
    kind,
    operations,
    pages: pages.length,
    projectMs: Number(projectMs.toFixed(1)),
    queryMaxMs: Number((latencies[latencies.length - 1] ?? 0).toFixed(2)),
    queryMedianMs: Number(
      (latencies[Math.floor(latencies.length / 2)] ?? 0).toFixed(2),
    ),
    serializeMs: Number(serializeMs.toFixed(1)),
    terms: built.statistics.terms,
  };
  evidence.push(measurement);
  console.log(
    `[search] ${kind}: ${measurement.documents} documents (${measurement.pages} pages, ${measurement.operations} operations), ${measurement.terms} terms; project ${measurement.projectMs} ms, index ${measurement.indexMs} ms, serialize ${measurement.serializeMs} ms; ${(measurement.artifactBytes / 1_048_576).toFixed(2)} MiB (${(measurement.gzipBytes / 1_048_576).toFixed(2)} MiB gzip); hydrate ${measurement.hydrateMs} ms; query median ${measurement.queryMedianMs} ms, max ${measurement.queryMaxMs} ms${extra.buildMs === undefined ? "" : `; CLI build ${extra.buildMs} ms, peak RSS ${((extra.maxRssBytes ?? 0) / 1_048_576).toFixed(0)} MiB`}`,
  );
  return measurement;
}

function buildInFreshProcess(root: string): {
  readonly buildMs: number;
  readonly maxRssBytes: number;
} {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=2048",
      "--input-type=module",
      "-e",
      `const { buildProject } = await import(${JSON.stringify(cliIndex)});
       const result = await buildProject({ cwd: process.argv[1] });
       process.stdout.write(JSON.stringify({ ok: result.ok, diagnostics: result.diagnostics.map((d) => d.code), maxRssBytes: process.resourceUsage().maxRSS * 1024 }));`,
      "--",
      root,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1_024 * 1_024 },
  );
  expect(result.status, result.stderr).toBe(0);
  const summary = JSON.parse(result.stdout) as {
    ok: boolean;
    diagnostics: string[];
    maxRssBytes: number;
  };
  expect(summary.ok, summary.diagnostics.join(",")).toBe(true);
  return {
    buildMs: Math.round(performance.now() - started),
    maxRssBytes: summary.maxRssBytes,
  };
}

async function site(
  options: Parameters<typeof writeSyntheticSite>[1],
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "specra-search-scale-"));
  temporary.push(root);
  await writeSyntheticSite(root, options);
  return root;
}

describe("search at scale", () => {
  it("indexes the TestInbox fixture in milliseconds with a small artifact", async () => {
    const measurement = await measureArtifacts(
      "testinbox",
      path.join(fixtureRoot, ".specra", "artifacts"),
    );
    expect(measurement.gzipBytes).toBeLessThan(64 * 1_024);
    expect(measurement.queryMaxMs).toBeLessThan(50);
  });

  it("scales to 1,000 authored pages", async () => {
    const root = await site({ pages: 1_000, sections: 20 });
    const built = buildInFreshProcess(root);
    const measurement = await measureArtifacts(
      "pages-1000",
      path.join(root, ".specra", "artifacts"),
      built,
    );
    expect(measurement.documents).toBeGreaterThan(6_000);
    expect(measurement.gzipBytes).toBeLessThan(5 * 1_024 * 1_024);
    expect(measurement.hydrateMs).toBeLessThan(2_000);
    expect(measurement.queryMedianMs).toBeLessThan(50);
    expect(measurement.queryMaxMs).toBeLessThan(500);
  }, 180_000);

  it("scales to 10,000 API operations", async () => {
    const root = await site({
      openapi: leanOperationsDocument(10_000),
      pages: 1,
      sections: 1,
    });
    const built = buildInFreshProcess(root);
    const measurement = await measureArtifacts(
      "operations-10000",
      path.join(root, ".specra", "artifacts"),
      built,
    );
    expect(measurement.operations).toBe(10_000);
    expect(measurement.gzipBytes).toBeLessThan(5 * 1_024 * 1_024);
    expect(measurement.hydrateMs).toBeLessThan(3_000);
    expect(measurement.queryMedianMs).toBeLessThan(50);
    expect(measurement.queryMaxMs).toBeLessThan(500);
  }, 180_000);

  it("keeps a combined 1,000-page, 10,000-operation corpus usable", async () => {
    const root = await site({
      openapi: leanOperationsDocument(10_000),
      pages: 1_000,
      sections: 20,
    });
    const built = buildInFreshProcess(root);
    const measurement = await measureArtifacts(
      "combined",
      path.join(root, ".specra", "artifacts"),
      built,
    );
    expect(measurement.gzipBytes).toBeLessThan(8 * 1_024 * 1_024);
    expect(measurement.hydrateMs).toBeLessThan(5_000);
    expect(measurement.queryMedianMs).toBeLessThan(80);
    expect(measurement.queryMaxMs).toBeLessThan(800);
    expect(built.maxRssBytes).toBeLessThan(2 * 1_024 * 1_024 * 1_024);
  }, 300_000);
});
