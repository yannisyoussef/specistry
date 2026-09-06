import { describe, expect, it, vi } from "vitest";

import { DEFAULT_POLICY, QUALITY_LIMITS } from "./contracts.js";
import { evaluateQuality } from "./engine.js";
import {
  factsFor,
  firstService,
  manyOperations,
  mutate,
  testinbox,
} from "./fixtures.test-helper.js";
import { parsePolicy } from "./policy.js";
import { operationDescription } from "./rules/operations.js";
import { serializeEvaluation } from "./serialize.js";

/**
 * SPEC-011 §51–§57, §71–§74, §113–§114, §177–§179: the frozen precedence,
 * the threshold arithmetic at its boundaries, governed suppressions,
 * bounded evaluation that fails safely, and deterministic output.
 */

const NOW = new Date("2026-09-07T00:00:00Z");
const service = firstService(testinbox);
const undocumented = mutate((entry) => {
  const target = entry.operations[0];
  if (target !== undefined)
    delete (target as { description?: string }).description;
});
const firstOperation = `${service.id}~${service.operations[0]?.id ?? ""}`;

function evaluate(policyInput: Parameters<typeof parsePolicy>[0]) {
  const { diagnostics, policy } = parsePolicy(policyInput);
  expect(diagnostics).toEqual([]);
  return evaluateQuality(factsFor(undocumented), { now: NOW, policy });
}

describe("severity precedence", () => {
  it("uses the rule default, then the configured override, then off", () => {
    const base = evaluateQuality(factsFor(undocumented), { now: NOW });
    const finding = base.findings.find(
      (entry) =>
        entry.rule === "operation-description" &&
        entry.target.identity === firstOperation,
    );
    expect(finding?.severity).toBe("warning");

    const promoted = evaluate({ rules: { "operation-description": "error" } });
    expect(
      promoted.findings.find(
        (entry) =>
          entry.rule === "operation-description" &&
          entry.target.identity === firstOperation,
      )?.severity,
    ).toBe("error");
    expect(promoted.summary.gate).toBe("failed");

    const off = evaluate({ rules: { "operation-description": "off" } });
    expect(
      off.findings.some((entry) => entry.rule === "operation-description"),
    ).toBe(false);
    // A rule that is off is not evaluated at all, so it is not counted.
    expect(off.summary.rules).toBe(base.summary.rules - 1);
  });
});

describe("thresholds", () => {
  it("fails on the configured severity and never on a lower one", () => {
    expect(evaluate({ failOn: "error" }).summary.gate).toBe("passed");
    const onWarning = evaluate({ failOn: "warning" });
    expect(onWarning.summary).toMatchObject({
      gate: "failed",
      reason: "warning",
    });
    expect(evaluate({ failOn: "info" }).summary).toMatchObject({
      gate: "failed",
      // Warnings outrank info, so they are the first reason reported.
      reason: "warning",
    });
    expect(evaluate({ failOn: "never" }).summary.gate).toBe("passed");
  });

  it("counts warnings against maxWarnings at every boundary", () => {
    const warnings = evaluateQuality(factsFor(undocumented), { now: NOW })
      .summary.warning;
    expect(warnings).toBeGreaterThan(1);
    expect(evaluate({ maxWarnings: 0 }).summary).toMatchObject({
      gate: "failed",
      reason: "maxWarnings",
    });
    expect(evaluate({ maxWarnings: warnings - 1 }).summary.gate).toBe("failed");
    // Exactly at the limit is allowed; one more is not.
    expect(evaluate({ maxWarnings: warnings }).summary.gate).toBe("passed");
    expect(evaluate({ maxWarnings: warnings + 1 }).summary.gate).toBe("passed");
  });

  it("never fails when the policy says never, whatever the findings", () => {
    const promoted = evaluate({
      failOn: "never",
      maxWarnings: 0,
      rules: { "operation-description": "error" },
    });
    expect(promoted.summary.error).toBeGreaterThan(0);
    expect(promoted.summary.gate).toBe("passed");
  });
});

describe("suppressions", () => {
  const suppression = {
    reason: "Tracked in DOC-14; the endpoint is being retired.",
    rule: "operation-description",
    target: firstOperation,
  };

  it("hides one finding, keeps counting it, and shows the reason", () => {
    const result = evaluate({ suppressions: [suppression] });
    const finding = result.findings.find(
      (entry) =>
        entry.rule === "operation-description" &&
        entry.target.identity === firstOperation,
    );
    expect(finding?.suppressed?.reason).toBe(suppression.reason);
    expect(result.summary.suppressed).toBe(1);
    const plain = evaluateQuality(factsFor(undocumented), { now: NOW });
    expect(result.summary.warning).toBe(plain.summary.warning - 1);
  });

  it("applies on the expiry day and stops the day after", () => {
    const onTheDay = evaluateQuality(factsFor(undocumented), {
      now: new Date("2026-09-07T23:59:59Z"),
      policy: parsePolicy({
        suppressions: [{ ...suppression, expires: "2026-09-07" }],
      }).policy,
    });
    expect(
      onTheDay.findings.find(
        (entry) => entry.target.identity === firstOperation,
      )?.suppressed,
    ).toBeDefined();
    expect(
      onTheDay.findings.some((entry) => entry.rule === "suppression-expired"),
    ).toBe(false);

    const afterwards = evaluateQuality(factsFor(undocumented), {
      now: new Date("2026-09-08T00:00:00Z"),
      policy: parsePolicy({
        suppressions: [{ ...suppression, expires: "2026-09-07" }],
      }).policy,
    });
    expect(
      afterwards.findings.find(
        (entry) =>
          entry.rule === "operation-description" &&
          entry.target.identity === firstOperation,
      )?.suppressed,
    ).toBeUndefined();
    expect(
      afterwards.findings.some((entry) => entry.rule === "suppression-expired"),
    ).toBe(true);
  });

  it("reports a suppression that matches nothing", () => {
    const result = evaluate({
      suppressions: [
        {
          reason: "The operation was removed last quarter.",
          rule: "operation-description",
          target: `${service.id}~no_such_operation`,
        },
      ],
    });
    const stale = result.findings.find(
      (entry) => entry.rule === "suppression-unused",
    );
    expect(stale?.severity).toBe("warning");
    expect(stale?.target.identity).toBe(
      `operation-description@${service.id}~no_such_operation`,
    );
  });

  it("keeps evaluating a rule that is suppressed on one target only", () => {
    const result = evaluate({ suppressions: [suppression] });
    const others = result.findings.filter(
      (entry) =>
        entry.rule === "operation-description" &&
        entry.suppressed === undefined,
    );
    // Suppressing one entity must not silence the rule everywhere, or stale
    // suppressions could never be detected (SPEC-011 §179).
    expect(others.length).toBeGreaterThan(0);
  });
});

describe("bounded evaluation", () => {
  const large = manyOperations(QUALITY_LIMITS.maxFindingsPerRule + 100);

  it("stops one rule at its budget and reports the evaluation as incomplete", () => {
    const result = evaluateQuality(factsFor(large), { now: NOW });
    const emitted = result.findings.filter(
      (entry) => entry.rule === "operation-description",
    ).length;
    expect(emitted).toBe(QUALITY_LIMITS.maxFindingsPerRule);
    expect(result.summary.truncated).toBe(true);
  });

  it("fails the gate when a truncated rule could have changed the outcome", () => {
    // The truncated rule is a warning: it cannot affect a failOn:error gate…
    expect(
      evaluateQuality(factsFor(large), { now: NOW }).summary,
    ).toMatchObject({ gate: "passed" });
    // …but it can when the policy counts warnings.
    expect(
      evaluateQuality(factsFor(large), {
        now: NOW,
        policy: { ...DEFAULT_POLICY, failOn: "warning" },
      }).summary,
    ).toMatchObject({ gate: "failed" });
    const promoted = evaluateQuality(factsFor(large), {
      now: NOW,
      policy: {
        ...DEFAULT_POLICY,
        rules: { "operation-description": "error" },
      },
    });
    expect(promoted.summary).toMatchObject({ gate: "failed" });
  });

  it("clamps a hostile label and message to the documented bound", () => {
    const long = mutate((entry) => {
      const target = entry.operations[0];
      if (target === undefined) return;
      delete (target as { description?: string }).description;
      (target as { path: string }).path = `/${"a".repeat(4_000)}`;
    });
    const result = evaluateQuality(factsFor(long), { now: NOW });
    for (const finding of result.findings) {
      expect(finding.target.label.length).toBeLessThanOrEqual(
        QUALITY_LIMITS.maxMessageLength,
      );
      expect(finding.message.length).toBeLessThanOrEqual(
        QUALITY_LIMITS.maxMessageLength,
      );
    }
  });
});

describe("rule isolation", () => {
  it("fails loudly instead of reporting a clean run when a rule throws", () => {
    const spy = vi
      .spyOn(operationDescription, "evaluate")
      .mockImplementation(() => {
        throw new Error("boom");
      });
    try {
      expect(() => evaluateQuality(factsFor(testinbox), { now: NOW })).toThrow(
        /operation-description/,
      );
    } finally {
      spy.mockRestore();
    }
    // The registry is intact afterwards; one broken rule is never swallowed.
    expect(
      evaluateQuality(factsFor(testinbox), { now: NOW }).summary.gate,
    ).toBe("passed");
  });
});

describe("determinism", () => {
  it("orders findings by severity, rule, identity, then locator", () => {
    const result = evaluateQuality(factsFor(undocumented), {
      now: NOW,
      policy: parsePolicy({ rules: { "operation-description": "error" } })
        .policy,
    });
    const ranks = { error: 3, info: 1, warning: 2 } as const;
    for (let index = 1; index < result.findings.length; index += 1) {
      const previous = result.findings[index - 1];
      const current = result.findings[index];
      if (previous === undefined || current === undefined) continue;
      expect(
        ranks[previous.severity] >= ranks[current.severity],
        `${previous.id} before ${current.id}`,
      ).toBe(true);
      if (previous.severity !== current.severity) continue;
      if (previous.rule !== current.rule) {
        expect(previous.rule < current.rule).toBe(true);
      }
    }
  });

  it("serializes to identical bytes with sorted keys", () => {
    const first = serializeEvaluation(
      evaluateQuality(factsFor(undocumented), { now: NOW }),
    );
    const second = serializeEvaluation(
      evaluateQuality(factsFor(undocumented), { now: NOW }),
    );
    expect(second).toBe(first);
    expect(first.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(first) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(first).not.toMatch(/\u001b/);
  });
});
