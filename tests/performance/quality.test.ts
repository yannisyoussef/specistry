import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  parseDocumentationArtifact,
  serializeDocumentationArtifact,
  type DocumentationArtifact,
  type Operation,
} from "@specra/model";
import { diffArtifacts } from "@specra/release";
import {
  collectFacts,
  evaluateQuality,
  parsePolicy,
  QUALITY_LIMITS,
  RULE_IDS,
  serializeEvaluation,
} from "@specra/quality";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Quality evaluation evidence (SPEC-011 §73, §132–§133, §185–§187, §200).
 * Rules are linear in the documentation they read, the report is bounded,
 * and a large policy costs nothing measurable. Budgets are regression
 * ceilings, generous enough that ordinary machine noise never fails CI;
 * the recorded numbers are the evidence.
 */

const fixture = fileURLToPath(
  new URL(
    "../fixtures/reader/testinbox/.specra/artifacts/documentation.json",
    import.meta.url,
  ),
);
const evidencePath = fileURLToPath(
  new URL("./quality-measurements.json", import.meta.url),
);
const NOW = new Date("2026-09-07T00:00:00Z");
const evidence: Record<string, unknown>[] = [];

afterAll(async () => {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
});

const base = parseDocumentationArtifact(await readFile(fixture, "utf8"));

/** A contract with `operations` operations and `schemas` reusable schemas. */
function synthetic(operations: number, schemas: number): DocumentationArtifact {
  const clone = JSON.parse(serializeDocumentationArtifact(base)) as {
    model: {
      versions: {
        services: {
          operations: Operation[];
          schemas: Record<string, unknown>;
        }[];
      }[];
    };
  };
  const service = clone.model.versions[0]?.services[0];
  const template = service?.operations[0];
  if (service === undefined || template === undefined) {
    throw new Error("fixture has no operation");
  }
  // Lean operations: 10,000 clones of a realistic one would exceed the
  // canonical model's own node budget, which is not what is being measured.
  service.operations = Array.from({ length: operations }, (_, index) => {
    const contractId = `syntheticOperation${index}`;
    return {
      contractId,
      deprecated: false,
      extensions: {},
      id: contractId,
      method: template.method,
      parameters: [],
      path: `/synthetic/${index}`,
      responses: [
        {
          bodies: [],
          description: "The operation succeeded.",
          headers: [],
          status: { code: 200, kind: "code" },
        },
      ],
      security: [],
      serverIds: template.serverIds,
      tags: template.tags,
      title: `Synthetic operation ${index}`,
    } as unknown as Operation;
  });
  // Keep the fixture's own definitions: the cloned operations reference
  // them, and a registry that dropped them would not be a valid artifact.
  const registry: Record<string, unknown> = { ...service.schemas };
  for (let index = 0; index < schemas; index += 1) {
    registry[`syntheticSchema${index}`] = {
      kind: "object",
      properties: {
        id: { kind: "scalar", type: "string" },
        label: { kind: "scalar", type: "string" },
      },
      propertyOrder: ["id", "label"],
      required: ["id"],
      additionalProperties: false,
    };
  }
  service.schemas = registry;
  return parseDocumentationArtifact(JSON.stringify(clone));
}

function measure<T>(run: () => T): { ms: number; value: T } {
  const started = process.hrtime.bigint();
  const value = run();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, value };
}

function rss(): number {
  return process.memoryUsage().rss;
}

describe("quality evaluation at scale", () => {
  it("evaluates the realistic fixture in a few milliseconds", () => {
    const facts = collectFacts({
      artifact: base,
      target: { kind: "candidate" },
    });
    const { ms, value } = measure(() => evaluateQuality(facts, { now: NOW }));
    const json = serializeEvaluation(value);
    evidence.push({
      evaluateMs: Number(ms.toFixed(2)),
      findings: value.findings.length,
      kind: "testinbox",
      operations: 25,
      outputBytes: Buffer.byteLength(json, "utf8"),
      rules: RULE_IDS.length,
      summary: value.summary,
    });
    expect(ms).toBeLessThan(500);
    expect(value.summary.gate).toBe("passed");
  });

  it.each([
    [1_000, 200],
    [10_000, 2_000],
  ])(
    "stays linear over %i operations and a large schema registry",
    (operations, schemas) => {
      const artifact = synthetic(operations, schemas);
      const before = rss();
      const facts = measure(() =>
        collectFacts({ artifact, target: { kind: "candidate" } }),
      );
      const evaluation = measure(() =>
        evaluateQuality(facts.value, { now: NOW }),
      );
      const serialized = measure(() => serializeEvaluation(evaluation.value));
      evidence.push({
        collectMs: Number(facts.ms.toFixed(2)),
        evaluateMs: Number(evaluation.ms.toFixed(2)),
        findings: evaluation.value.findings.length,
        kind: `operations-${operations}`,
        operations,
        outputBytes: Buffer.byteLength(serialized.value, "utf8"),
        rssBytesDelta: rss() - before,
        schemas,
        serializeMs: Number(serialized.ms.toFixed(2)),
        truncated: evaluation.value.summary.truncated,
      });
      // Bounded whatever the input size (SPEC-011 §71, §187).
      expect(evaluation.value.findings.length).toBeLessThanOrEqual(
        QUALITY_LIMITS.maxFindings + QUALITY_LIMITS.maxSuppressions,
      );
      expect(Buffer.byteLength(serialized.value, "utf8")).toBeLessThan(
        8 * 1_024 * 1_024,
      );
      expect(facts.ms + evaluation.ms).toBeLessThan(
        operations >= 10_000 ? 20_000 : 5_000,
      );
    },
  );

  it("carries a thousand overrides and a thousand suppressions for free", () => {
    const artifact = synthetic(2_000, 100);
    const facts = collectFacts({ artifact, target: { kind: "candidate" } });
    const suppressions = Array.from(
      { length: QUALITY_LIMITS.maxSuppressions },
      (_, index) => ({
        reason: "Recorded in the migration plan for the next major version.",
        rule: "operation-description",
        target: `openapi.yaml~syntheticOperation${index}`,
      }),
    );
    const parsed = measure(() =>
      parsePolicy({
        rules: Object.fromEntries(RULE_IDS.map((id) => [id, "warning"])),
        suppressions,
      }),
    );
    expect(parsed.value.diagnostics).toEqual([]);
    const evaluation = measure(() =>
      evaluateQuality(facts, { now: NOW, policy: parsed.value.policy }),
    );
    evidence.push({
      evaluateMs: Number(evaluation.ms.toFixed(2)),
      kind: "large-policy",
      overrides: RULE_IDS.length,
      parsePolicyMs: Number(parsed.ms.toFixed(2)),
      suppressed: evaluation.value.summary.suppressed,
      suppressions: suppressions.length,
    });
    // The rule stops at its per-rule budget, so only the findings it did
    // emit can be suppressed; the point is that a large policy is cheap.
    expect(evaluation.value.summary.suppressed).toBeGreaterThan(0);
    expect(parsed.ms).toBeLessThan(1_000);
    expect(evaluation.ms).toBeLessThan(10_000);
  });

  it("classifies compatibility over a large diff without a cross product", () => {
    const before = synthetic(5_000, 100);
    // The target drops 100 operations, which every compatibility rule must
    // classify without comparing each operation with every candidate.
    const shrunk = JSON.parse(serializeDocumentationArtifact(before)) as {
      model: { versions: { services: { operations: unknown[] }[] }[] };
    };
    const service = shrunk.model.versions[0]?.services[0];
    if (service !== undefined) {
      service.operations = service.operations.slice(0, -100);
    }
    const after = parseDocumentationArtifact(JSON.stringify(shrunk));
    const diff = measure(() =>
      diffArtifacts(
        { artifact: before, version: "v1" },
        { artifact: after, version: "candidate" },
      ),
    );
    const facts = collectFacts({
      artifact: after,
      comparison: { artifact: before, diff: diff.value, from: "v1" },
      target: { kind: "candidate" },
    });
    const evaluation = measure(() => evaluateQuality(facts, { now: NOW }));
    const compatibility = evaluation.value.findings.filter(
      (finding) => finding.category === "compatibility",
    ).length;
    evidence.push({
      candidates: diff.value.candidates.length,
      compatibilityFindings: compatibility,
      diffMs: Number(diff.ms.toFixed(2)),
      evaluateMs: Number(evaluation.ms.toFixed(2)),
      kind: "compatibility-5000",
      operations: 5_000,
    });
    expect(compatibility).toBe(100);
    // 5,000 operations against ~1,000 changed candidates: a cross product
    // would be 5,000,000 comparisons and take seconds.
    expect(evaluation.ms).toBeLessThan(10_000);
  });
});
