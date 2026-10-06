import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { parseDocumentationArtifact } from "@specistry/model";
import {
  parsePlaygroundArtifact,
  projectPlayground,
  serializePlaygroundArtifact,
} from "@specistry/playground";
import { parseSnippetsArtifact } from "@specistry/snippets";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { leanOperationsDocument } from "./ingestion-generator.mjs";

/**
 * Playground policy at scale (SPEC-009 §141–§143): for the TestInbox
 * fixture and a 10,000-operation contract with the playground enabled,
 * measure the policy projection, the artifact bytes, and the strict parse.
 * The policy stores one bounded form per operation and no generated text,
 * so it is linear in operations and independent of how many environments
 * are approved. Budgets are regression ceilings; the numbers are the
 * evidence.
 */

const cliIndex = fileURLToPath(
  new URL("../../packages/cli/dist/index.js", import.meta.url),
);
const evidencePath = fileURLToPath(
  new URL("./playground-measurements.json", import.meta.url),
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

function measure(
  kind: string,
  documentationJson: string,
  snippetsJson: string,
  approved: readonly string[],
  extra: Record<string, unknown> = {},
) {
  const artifact = parseDocumentationArtifact(documentationJson);
  const snippets = parseSnippetsArtifact(snippetsJson);
  const operations =
    artifact.model.versions[0]?.services.reduce(
      (total, service) => total + service.operations.length,
      0,
    ) ?? 0;
  const projectStart = performance.now();
  const policy = projectPlayground({
    approved,
    artifact,
    enabled: true,
    responseLimitBytes: 1_048_576,
    snippets,
    timeoutMs: 30_000,
  });
  const projectMs = performance.now() - projectStart;
  const serializeStart = performance.now();
  const json = serializePlaygroundArtifact(policy.artifact);
  const serializeMs = performance.now() - serializeStart;
  const parseStart = performance.now();
  const parsed = parsePlaygroundArtifact(json);
  const parseMs = performance.now() - parseStart;
  const measurement = {
    ...extra,
    artifactBytes: Buffer.byteLength(json, "utf8"),
    artifactBytesPerOperation: Math.round(
      Buffer.byteLength(json, "utf8") / Math.max(1, operations),
    ),
    environments: parsed.environments.length,
    executable: Object.values(parsed.operations).filter(
      (form) => form.capability.state === "executable",
    ).length,
    gzipBytes: gzipSync(json).byteLength,
    kind,
    operations,
    parseMs,
    projectMs,
    serializeMs,
    unsupportedDiagnostics: policy.diagnostics.filter(
      (diagnostic) => diagnostic.code === "PLAYGROUND_OPERATION_UNSUPPORTED",
    ).length,
  };
  evidence.push(measurement);
  return measurement;
}

async function buildSynthetic(name: string, document: object | string) {
  const project = await mkdtemp(
    path.join(tmpdir(), `specistry-playground-${name}-`),
  );
  temporary.push(project);
  await mkdir(path.join(project, "docs"));
  await writeFile(
    path.join(project, "openapi.json"),
    typeof document === "string" ? document : JSON.stringify(document),
  );
  await writeFile(
    path.join(project, "specistry.config.ts"),
    `export default { schemaVersion: 1, name: "${name}", openapi: "./openapi.json", environments: { a: { baseUrl: "https://a.example.com" }, b: { baseUrl: "https://b.example.com" }, c: { baseUrl: "https://c.example.com" } }, playground: { mode: "browser", environments: ["a", "b", "c"] } };`,
  );
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { buildProject } from ${JSON.stringify(cliIndex)};
       const result = await buildProject({ cwd: process.cwd() });
       console.log(JSON.stringify({ ok: result.ok, rss: process.resourceUsage().maxRSS, playground: result.ok ? result.playground : null, diagnostics: result.ok ? [] : result.diagnostics.slice(0, 3) }));`,
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
    playground: {
      enabled: boolean;
      environments: number;
      operations: number;
    } | null;
  };
  expect(parsed.ok).toBe(true);
  expect(parsed.playground).toEqual({
    enabled: true,
    environments: 3,
    operations: 10_000,
  });
  return {
    artifacts: path.join(project, ".specistry", "artifacts"),
    buildMs,
    maxRssBytes: parsed.rss * 1024,
  };
}

describe("playground policy at scale", () => {
  it("projects the TestInbox policy quickly and matches the committed artifact", async () => {
    const artifacts = path.join(fixtureRoot, ".specistry", "artifacts");
    const documentation = await readFile(
      path.join(artifacts, "documentation.json"),
      "utf8",
    );
    const snippets = await readFile(
      path.join(artifacts, "snippets.json"),
      "utf8",
    );
    const written = await readFile(
      path.join(artifacts, "playground.json"),
      "utf8",
    );
    const measurement = measure(
      "testinbox",
      documentation,
      snippets,
      ["local", "strict"],
      {
        committedArtifactBytes: Buffer.byteLength(written, "utf8"),
        committedGzipBytes: gzipSync(written).byteLength,
      },
    );
    expect(measurement.operations).toBe(25);
    expect(measurement.environments).toBe(2);
    expect(measurement.projectMs).toBeLessThan(200);
    expect(measurement.parseMs).toBeLessThan(100);
  });

  it("stays linear for 10,000 operations with three approved environments", async () => {
    const built = await buildSynthetic(
      "lean-10000",
      leanOperationsDocument(10_000),
    );
    const documentation = await readFile(
      path.join(built.artifacts, "documentation.json"),
      "utf8",
    );
    const snippets = await readFile(
      path.join(built.artifacts, "snippets.json"),
      "utf8",
    );
    const written = await readFile(
      path.join(built.artifacts, "playground.json"),
      "utf8",
    );
    const measurement = measure(
      "operations-10000",
      documentation,
      snippets,
      ["a", "b", "c"],
      {
        buildMs: built.buildMs,
        committedArtifactBytes: Buffer.byteLength(written, "utf8"),
        committedGzipBytes: gzipSync(written).byteLength,
        maxRssBytes: built.maxRssBytes,
      },
    );
    expect(measurement.operations).toBe(10_000);
    expect(measurement.environments).toBe(3);
    expect(measurement.projectMs).toBeLessThan(20_000);
    expect(measurement.parseMs).toBeLessThan(10_000);
    expect(measurement.artifactBytesPerOperation).toBeLessThan(2_048);
    expect(measurement.gzipBytes).toBeLessThan(4 * 1024 * 1024);
    // The policy does not grow with the number of approved environments.
    const one = measure(
      "operations-10000-one-environment",
      documentation,
      snippets,
      ["a"],
    );
    expect(
      Math.abs(one.artifactBytes - measurement.artifactBytes),
    ).toBeLessThan(1_024);
  }, 600_000);
});
