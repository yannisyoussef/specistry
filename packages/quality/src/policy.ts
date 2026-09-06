/**
 * Policy parsing (SPEC-011 §35–§46, §153). The configuration layer checks
 * shape; this checks meaning: every rule id must exist in the registry,
 * every severity must be one of four words, and every suppression must
 * name a known rule, an exact entity identity, and a human reason. An
 * invalid policy is a configuration error, never a silently weaker gate.
 */

import {
  DEFAULT_POLICY,
  QUALITY_LIMITS,
  SEVERITY_SETTINGS,
  type FailOn,
  type QualityDiagnostic,
  type QualityPolicy,
  type SeveritySetting,
  type Suppression,
} from "./contracts.js";
import { isRuleId } from "./registry.js";

export interface PolicyInput {
  readonly rules?: Readonly<Record<string, unknown>>;
  readonly failOn?: unknown;
  readonly maxWarnings?: unknown;
  readonly suppressions?: readonly unknown[];
}

export interface PolicyResult {
  readonly policy: QualityPolicy;
  readonly diagnostics: readonly QualityDiagnostic[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Printable text without control characters, line breaks, or bidi marks. */
const REASON =
  /^[^\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]+$/;
const FAIL_ON: readonly string[] = ["error", "warning", "info", "never"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

/**
 * Validates raw quality configuration into a policy. Unknown rule ids are
 * reported rather than ignored, so a typo cannot quietly disable a gate.
 */
export function parsePolicy(input: PolicyInput | undefined): PolicyResult {
  if (input === undefined) return { diagnostics: [], policy: DEFAULT_POLICY };
  const diagnostics: QualityDiagnostic[] = [];
  const rules: Record<string, SeveritySetting> = Object.create(null) as Record<
    string,
    SeveritySetting
  >;

  // `Object.entries` on a null-prototype record: `__proto__` and friends are
  // ordinary keys here and are rejected as unknown rule ids like any typo.
  for (const [id, severity] of Object.entries(input.rules ?? {})) {
    if (!isRuleId(id)) {
      diagnostics.push({
        code: "QUALITY_RULE_UNKNOWN",
        path: `/rules/${escapePointer(id)}`,
      });
      continue;
    }
    if (
      typeof severity !== "string" ||
      !SEVERITY_SETTINGS.includes(severity as SeveritySetting)
    ) {
      diagnostics.push({
        code: "QUALITY_SEVERITY_INVALID",
        path: `/rules/${escapePointer(id)}`,
      });
      continue;
    }
    rules[id] = severity as SeveritySetting;
  }

  let failOn: FailOn = DEFAULT_POLICY.failOn;
  if (input.failOn !== undefined) {
    if (typeof input.failOn !== "string" || !FAIL_ON.includes(input.failOn)) {
      diagnostics.push({ code: "QUALITY_THRESHOLD_INVALID", path: "/failOn" });
    } else {
      failOn = input.failOn as FailOn;
    }
  }

  let maxWarnings: number | undefined;
  if (input.maxWarnings !== undefined) {
    if (
      typeof input.maxWarnings !== "number" ||
      !Number.isSafeInteger(input.maxWarnings) ||
      input.maxWarnings < 0
    ) {
      diagnostics.push({
        code: "QUALITY_THRESHOLD_INVALID",
        path: "/maxWarnings",
      });
    } else {
      maxWarnings = input.maxWarnings;
    }
  }

  const suppressions: Suppression[] = [];
  const entries = input.suppressions ?? [];
  if (entries.length > QUALITY_LIMITS.maxSuppressions) {
    diagnostics.push({
      code: "QUALITY_SUPPRESSION_INVALID",
      path: "/suppressions",
    });
  }
  entries.slice(0, QUALITY_LIMITS.maxSuppressions).forEach((entry, index) => {
    const path = `/suppressions/${index}`;
    const invalid = (): void => {
      diagnostics.push({ code: "QUALITY_SUPPRESSION_INVALID", path });
    };
    if (!isRecord(entry)) return invalid();
    const { expires, reason, rule, target } = entry;
    if (typeof rule !== "string" || !isRuleId(rule)) {
      diagnostics.push({
        code: "QUALITY_RULE_UNKNOWN",
        path: `${path}/rule`,
      });
      return;
    }
    if (typeof target !== "string" || target.trim().length === 0) {
      return invalid();
    }
    if (
      typeof reason !== "string" ||
      reason.trim().length === 0 ||
      reason.length > QUALITY_LIMITS.maxSuppressionReasonLength ||
      !REASON.test(reason)
    ) {
      return invalid();
    }
    if (
      expires !== undefined &&
      (typeof expires !== "string" || !isValidDate(expires))
    ) {
      return invalid();
    }
    suppressions.push({
      reason: reason.trim(),
      rule,
      target: target.trim(),
      ...(expires === undefined ? {} : { expires: expires as string }),
    });
  });

  return {
    diagnostics,
    policy: {
      failOn,
      rules,
      suppressions,
      ...(maxWarnings === undefined ? {} : { maxWarnings }),
    },
  };
}

/** RFC 6901 escaping for a configuration key that may contain `/` or `~`. */
function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}
