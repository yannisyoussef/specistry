import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { parseDocumentationArtifact } from "@specistry/model";
import {
  generateAll,
  parseSnippetsArtifact,
  projectArtifact,
  PROTOCOL_LANGUAGES,
  serializeSnippetsArtifact,
  type EnvironmentProjection,
} from "@specistry/snippets";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  leanOperationsDocument,
  operationsDocument,
} from "./ingestion-generator.mjs";

/**
 * Code samples at scale (SPEC-008 §136–§140, §180): for the TestInbox
 * fixture, 1,000 rich operations, and 10,000 lean operations, measure the
 * projection, the artifact bytes and gzip bytes, and the six-language
 * generation per operation, with one and with five environments and the
 * multi-media-type fixture operations. The artifact stores projections, not
 * generated text, so its size is linear in operations and independent of
 * environments; generation runs on the server per request and is memoized.
 * Budgets are regression ceilings; the numbers are the evidence.
 */

const cliIndex = fileURLToPath(
  new URL("../../packages/cli/dist/index.js", import.meta.url),
);
const evidencePath = fileURLToPath(
  new URL("./snippets-measurements.json", import.meta.url),
);
const fixtureRoot = fileURLToPath(
  new URL("../fixtures/reader/testinbox/", import.meta.url),
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

const FIVE_ENVIRONMENTS: readonly EnvironmentProjection[] = Array.from(
  { length: 5 },
  (_, index) => ({
    baseUrl: `https://env${index}.example.com/v1`,
    id: `env${index}`,
    label: `Environment ${index}`,
  }),
);

function measure(
  kind: string,
  documentationJson: string,
  extra: Record<string, unknown> = {},
) {
  const artifact = parseDocumentationArtifact(documentationJson);
  const operations =
    artifact.model.versions[0]?.services.reduce(
      (total, service) => total + service.operations.length,
      0,
    ) ?? 0;
  const projectStart = performance.now();
  const projected = projectArtifact(artifact);
  const projectMs = performance.now() - projectStart;
  const serializeStart = performance.now();
  const json = serializeSnippetsArtifact({
    environments: [],
    operations: projected.operations,
    sdkExamples: {},
    sdks: [],
    snippetsVersion: 1,
  });
  const serializeMs = performance.now() - serializeStart;
  const parseStart = performance.now();
  const parsed = parseSnippetsArtifact(json);
  const parseMs = performance.now() - parseStart;
  const projections = Object.values(parsed.operations);
  const sample = projections.filter(
    (_, index) =>
      index % Math.max(1, Math.floor(projections.length / 200)) === 0,
  );
  const generateStart = performance.now();
  let characters = 0;
  for (const projection of sample) {
    const set = generateAll(projection, [], {});
    for (const snippet of set.snippets) characters += snippet.code.length;
  }
  const generateMs = performance.now() - generateStart;
  const multiStart = performance.now();
  for (const projection of sample) {
    for (const environment of FIVE_ENVIRONMENTS) {
      generateAll(projection, FIVE_ENVIRONMENTS, {
        environment: environment.id,
      });
    }
  }
  const multiEnvironmentMs = performance.now() - multiStart;
  const measurement = {
    ...extra,
    artifactBytes: Buffer.byteLength(json, "utf8"),
    artifactBytesPerOperation: Math.round(
      Buffer.byteLength(json, "utf8") / Math.max(1, operations),
    ),
    averageSnippetCharacters: Math.round(
      characters / Math.max(1, sample.length * PROTOCOL_LANGUAGES.length),
    ),
    generateMsPerOperation: generateMs / Math.max(1, sample.length),
    gzipBytes: gzipSync(json).byteLength,
    kind,
    multiEnvironmentMsPerOperation:
      multiEnvironmentMs / Math.max(1, sample.length),
    operations,
    parseMs,
    projectMs,
    sampledOperations: sample.length,
    serializeMs,
  };
  evidence.push(measurement);
  return measurement;
}

async function buildSynthetic(name: string, document: object | string) {
  const project = await mkdtemp(
    path.join(tmpdir(), `specistry-snippets-${name}-`),
  );
  temporary.push(project);
  await mkdir(path.join(project, "docs"));
  // The generators return JSON text already.
  await writeFile(
    path.join(project, "openapi.json"),
    typeof document === "string" ? document : JSON.stringify(document),
  );
  await writeFile(
    path.join(project, "specistry.config.ts"),
    `export default { schemaVersion: 1, name: "${name}", openapi: "./openapi.json", environments: { a: { baseUrl: "https://a.example.com" }, b: { baseUrl: "https://b.example.com" }, c: { baseUrl: "https://c.example.com" } } };`,
  );
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { buildProject } from ${JSON.stringify(cliIndex)};
       const result = await buildProject({ cwd: process.cwd() });
       console.log(JSON.stringify({ ok: result.ok, rss: process.resourceUsage().maxRSS, snippets: result.ok ? result.snippets : null, diagnostics: result.ok ? [] : result.diagnostics.slice(0, 3) }));`,
    ],
    {
      cwd: project,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
    },
  );
  const buildMs = performance.now() - started;
  expect(result.status, result.stderr).toBe(0);
  const parsed = JSON.parse(
    result.stdout.trim().split("\n").at(-1) ?? "{}",
  ) as {
    ok: boolean;
    rss: number;
    snippets: { operations: number; sdkExamples: number } | null;
  };
  expect(parsed.ok).toBe(true);
  return {
    artifacts: path.join(project, ".specistry", "artifacts"),
    buildMs,
    maxRssBytes: parsed.rss * 1024,
  };
}

describe("code samples at scale", () => {
  it("projects and generates the TestInbox fixture quickly", async () => {
    const documentation = await readFile(
      path.join(fixtureRoot, ".specistry", "artifacts", "documentation.json"),
      "utf8",
    );
    const written = await readFile(
      path.join(fixtureRoot, ".specistry", "artifacts", "snippets.json"),
      "utf8",
    );
    const measurement = measure("testinbox", documentation, {
      committedArtifactBytes: Buffer.byteLength(written, "utf8"),
      committedGzipBytes: gzipSync(written).byteLength,
    });
    expect(measurement.operations).toBe(25);
    expect(measurement.projectMs).toBeLessThan(200);
    expect(measurement.generateMsPerOperation).toBeLessThan(20);
    // Multi-media operations (JSON + form, multipart) are part of the fixture.
    const parsed = parseSnippetsArtifact(written);
    const multi = Object.values(parsed.operations).filter(
      (projection) => projection.bodies.length > 1,
    );
    expect(multi.length).toBeGreaterThan(0);
  });

  it("stays linear for 1,000 rich operations", async () => {
    const built = await buildSynthetic("rich-1000", operationsDocument(1_000));
    const documentation = await readFile(
      path.join(built.artifacts, "documentation.json"),
      "utf8",
    );
    const written = await readFile(
      path.join(built.artifacts, "snippets.json"),
      "utf8",
    );
    const measurement = measure("operations-1000", documentation, {
      buildMs: built.buildMs,
      committedArtifactBytes: Buffer.byteLength(written, "utf8"),
      committedGzipBytes: gzipSync(written).byteLength,
      maxRssBytes: built.maxRssBytes,
    });
    expect(measurement.operations).toBe(1_000);
    expect(measurement.projectMs).toBeLessThan(5_000);
    expect(measurement.artifactBytesPerOperation).toBeLessThan(4_096);
    expect(measurement.generateMsPerOperation).toBeLessThan(20);
  }, 300_000);

  it("stays linear for 10,000 operations with no Cartesian growth across environments", async () => {
    const built = await buildSynthetic(
      "lean-10000",
      leanOperationsDocument(10_000),
    );
    const documentation = await readFile(
      path.join(built.artifacts, "documentation.json"),
      "utf8",
    );
    const written = await readFile(
      path.join(built.artifacts, "snippets.json"),
      "utf8",
    );
    const measurement = measure("operations-10000", documentation, {
      buildMs: built.buildMs,
      committedArtifactBytes: Buffer.byteLength(written, "utf8"),
      committedGzipBytes: gzipSync(written).byteLength,
      maxRssBytes: built.maxRssBytes,
    });
    expect(measurement.operations).toBe(10_000);
    expect(measurement.projectMs).toBeLessThan(20_000);
    expect(measurement.artifactBytesPerOperation).toBeLessThan(2_048);
    expect(measurement.gzipBytes).toBeLessThan(4 * 1024 * 1024);
    // Five environments cost five generations, never five artifacts.
    expect(measurement.multiEnvironmentMsPerOperation).toBeLessThan(100);
    expect(parseSnippetsArtifact(written).environments).toHaveLength(3);
  }, 600_000);
});
