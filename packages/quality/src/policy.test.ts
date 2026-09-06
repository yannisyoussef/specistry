import { describe, expect, it } from "vitest";

import { QUALITY_LIMITS } from "./contracts.js";
import { parsePolicy } from "./policy.js";
import { RULE_IDS } from "./registry.js";

/**
 * SPEC-011 §36, §40–§46, §151–§154, §180: a typo must never quietly
 * disable a gate, a suppression must be governed, and hostile configuration
 * must fail closed with a value-free diagnostic.
 */

const known = RULE_IDS[0] ?? "operation-description";

describe("rule severities", () => {
  it("accepts every published rule id and every severity word", () => {
    const rules = Object.fromEntries(RULE_IDS.map((id) => [id, "warning"]));
    const result = parsePolicy({ rules });
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.policy.rules)).toHaveLength(RULE_IDS.length);
    for (const severity of ["off", "info", "warning", "error"] as const) {
      expect(parsePolicy({ rules: { [known]: severity } }).diagnostics).toEqual(
        [],
      );
    }
  });

  it("reports a misspelled rule instead of ignoring it", () => {
    const result = parsePolicy({ rules: { "operation-descriptin": "error" } });
    expect(result.diagnostics).toEqual([
      { code: "QUALITY_RULE_UNKNOWN", path: "/rules/operation-descriptin" },
    ]);
    expect(result.policy.rules).toEqual({});
  });

  it("reports an unknown severity", () => {
    expect(parsePolicy({ rules: { [known]: "fatal" } }).diagnostics).toEqual([
      { code: "QUALITY_SEVERITY_INVALID", path: `/rules/${known}` },
    ]);
  });

  it("treats prototype-shaped keys as ordinary unknown rules", () => {
    const result = parsePolicy({
      rules: {
        __proto__: "off",
        constructor: "off",
        prototype: "error",
      } as Record<string, unknown>,
    });
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.code).toBe("QUALITY_RULE_UNKNOWN");
    }
    expect(result.policy.rules).toEqual({});
    expect(Object.getPrototypeOf(result.policy.rules)).toBe(null);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });
});

describe("thresholds", () => {
  it("accepts the four failure modes and a non-negative maxWarnings", () => {
    for (const failOn of ["error", "warning", "info", "never"] as const) {
      expect(parsePolicy({ failOn }).policy.failOn).toBe(failOn);
    }
    expect(parsePolicy({ maxWarnings: 0 }).policy.maxWarnings).toBe(0);
    expect(parsePolicy({ maxWarnings: 25 }).policy.maxWarnings).toBe(25);
  });

  it("rejects an unknown mode and a nonsensical count", () => {
    expect(parsePolicy({ failOn: "always" }).diagnostics).toEqual([
      { code: "QUALITY_THRESHOLD_INVALID", path: "/failOn" },
    ]);
    for (const maxWarnings of [-1, 1.5, Number.NaN, "3"]) {
      expect(
        parsePolicy({ maxWarnings }).diagnostics,
        String(maxWarnings),
      ).toEqual([{ code: "QUALITY_THRESHOLD_INVALID", path: "/maxWarnings" }]);
    }
  });
});

describe("suppressions", () => {
  const valid = {
    reason: "Tracked in DOC-14; the endpoint is being retired.",
    rule: known,
    target: "openapi.yaml~listInboxes",
  };

  it("accepts a governed suppression and normalizes its text", () => {
    const result = parsePolicy({
      suppressions: [{ ...valid, expires: "2026-12-31", reason: "  ok  " }],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.policy.suppressions).toEqual([
      {
        expires: "2026-12-31",
        reason: "ok",
        rule: known,
        target: valid.target,
      },
    ]);
  });

  it("requires a known rule, an exact target, and a human reason", () => {
    expect(
      parsePolicy({ suppressions: [{ ...valid, rule: "nope" }] }).diagnostics,
    ).toEqual([{ code: "QUALITY_RULE_UNKNOWN", path: "/suppressions/0/rule" }]);
    for (const broken of [
      { ...valid, target: "" },
      { ...valid, target: "   " },
      { ...valid, reason: "" },
      {
        ...valid,
        reason: "x".repeat(QUALITY_LIMITS.maxSuppressionReasonLength + 1),
      },
      { ...valid, expires: "31-12-2026" },
      { ...valid, expires: "2026-02-31" },
      { ...valid, expires: 20261231 },
      "not an object",
    ]) {
      expect(
        parsePolicy({ suppressions: [broken] }).diagnostics,
        JSON.stringify(broken),
      ).toEqual([
        { code: "QUALITY_SUPPRESSION_INVALID", path: "/suppressions/0" },
      ]);
    }
  });

  it("rejects control characters and bidi marks in a reason", () => {
    for (const reason of [
      "before\u001b[31mafter",
      "line\u000abreak",
      "quiet\u202ereversed",
      "zero\u200bwidth",
    ]) {
      expect(
        parsePolicy({ suppressions: [{ ...valid, reason }] }).diagnostics,
      ).toEqual([
        { code: "QUALITY_SUPPRESSION_INVALID", path: "/suppressions/0" },
      ]);
    }
  });

  it("bounds the number of suppressions", () => {
    const many = Array.from(
      { length: QUALITY_LIMITS.maxSuppressions + 5 },
      (_, index) => ({ ...valid, target: `openapi.yaml~operation${index}` }),
    );
    const result = parsePolicy({ suppressions: many });
    expect(result.diagnostics).toContainEqual({
      code: "QUALITY_SUPPRESSION_INVALID",
      path: "/suppressions",
    });
    expect(result.policy.suppressions).toHaveLength(
      QUALITY_LIMITS.maxSuppressions,
    );
  });

  it("has no wildcard: turning a rule off is a severity, not a suppression", () => {
    // A `*` target is simply an identity that matches no entity, so it can
    // never silence a rule wholesale (SPEC-011 §44).
    const result = parsePolicy({ suppressions: [{ ...valid, target: "*" }] });
    expect(result.diagnostics).toEqual([]);
    expect(result.policy.suppressions[0]?.target).toBe("*");
  });
});

describe("defaults", () => {
  it("returns the documented defaults when the project configures nothing", () => {
    const result = parsePolicy(undefined);
    expect(result.diagnostics).toEqual([]);
    expect(result.policy).toEqual({
      failOn: "error",
      rules: {},
      suppressions: [],
    });
  });
});
