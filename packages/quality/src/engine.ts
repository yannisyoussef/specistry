/**
 * Rule execution and policy evaluation (SPEC-011 §57, §71–§74, §177).
 * Rules run in registry order over the facts and emit findings; policy
 * then assigns the effective severity, applies governed suppressions,
 * counts, and decides the gate. The order is frozen:
 *
 *   rule default severity
 *   → configured override (`off` removes the rule from the run)
 *   → suppression match (an expired suppression does not apply)
 *   → counts by effective severity
 *   → failOn / maxWarnings
 *   → gate outcome
 *
 * Everything is bounded: a rule may emit at most `maxFindingsPerRule`
 * findings and an evaluation at most `maxFindings`. Truncation is reported,
 * and a truncated rule whose severity could affect the gate fails it,
 * because an incomplete evaluation cannot prove that nothing was missed.
 */

import {
  DEFAULT_POLICY,
  QUALITY_FORMAT_VERSION,
  QUALITY_LIMITS,
  QualityContractError,
  SEVERITY_RANK,
  type EvaluatedFinding,
  type QualityEvaluation,
  type QualityFinding,
  type QualityPolicy,
  type QualitySummary,
  type RuleFinding,
  type RuleId,
  type Severity,
  type Suppression,
} from "./contracts.js";
import type { QualityFacts } from "./facts.js";
import { POLICY_RULE_IDS, RULES } from "./registry.js";

export interface EvaluateOptions {
  readonly policy?: QualityPolicy;
  /**
   * Evaluation date for suppression expiry, as a UTC calendar day. Results
   * are deterministic for a given date; tests pass one explicitly.
   */
  readonly now?: Date;
}

function clamp(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function findingId(rule: RuleId, finding: RuleFinding): string {
  const base = `${rule}:${finding.target.identity}`;
  return finding.locator === undefined ? base : `${base}:${finding.locator}`;
}

/** UTC calendar day as `YYYY-MM-DD`, independent of the host timezone. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

interface RunResult {
  readonly findings: readonly QualityFinding[];
  /** Rules that hit a budget; their findings are incomplete. */
  readonly truncated: ReadonlySet<RuleId>;
  readonly ran: number;
}

function run(facts: QualityFacts, policy: QualityPolicy): RunResult {
  const findings: QualityFinding[] = [];
  const truncated = new Set<RuleId>();
  const policyOwned = new Set<RuleId>(POLICY_RULE_IDS);
  let ran = 0;
  for (const rule of RULES) {
    if (policyOwned.has(rule.id)) continue;
    if (policy.rules[rule.id] === "off") continue;
    if (rule.requiresComparison === true && facts.comparison === undefined) {
      continue;
    }
    ran += 1;
    let emitted = 0;
    const emit = (finding: RuleFinding): void => {
      if (
        emitted >= QUALITY_LIMITS.maxFindingsPerRule ||
        findings.length >= QUALITY_LIMITS.maxFindings
      ) {
        truncated.add(rule.id);
        return;
      }
      emitted += 1;
      findings.push({
        category: rule.category,
        id: findingId(rule.id, finding),
        message: clamp(finding.message, QUALITY_LIMITS.maxMessageLength),
        rule: rule.id,
        target: {
          ...finding.target,
          label: clamp(finding.target.label, QUALITY_LIMITS.maxMessageLength),
        },
        ...(finding.locator === undefined
          ? {}
          : {
              locator: clamp(finding.locator, QUALITY_LIMITS.maxMessageLength),
            }),
        ...(finding.source === undefined ? {} : { source: finding.source }),
        ...(finding.line === undefined ? {} : { line: finding.line }),
      });
    };
    try {
      rule.evaluate(facts, emit);
    } catch (error) {
      // A broken rule must never look like a clean report (SPEC-011 §74).
      throw new QualityContractError(
        `The quality rule ${rule.id} failed: ${error instanceof Error ? error.message : "unknown error"}.`,
      );
    }
  }
  return { findings, ran, truncated };
}

function compare(left: EvaluatedFinding, right: EvaluatedFinding): number {
  const bySeverity =
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
  if (bySeverity !== 0) return bySeverity;
  if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1;
  if (left.target.identity !== right.target.identity) {
    return left.target.identity < right.target.identity ? -1 : 1;
  }
  const leftLocator = left.locator ?? "";
  const rightLocator = right.locator ?? "";
  if (leftLocator !== rightLocator) return leftLocator < rightLocator ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function severityOf(rule: RuleId, policy: QualityPolicy): Severity {
  const configured = policy.rules[rule];
  if (configured !== undefined && configured !== "off") return configured;
  const definition = RULES.find((entry) => entry.id === rule);
  return definition?.defaultSeverity ?? "warning";
}

function suppressionKey(suppression: Suppression): string {
  return `${suppression.rule}\u0000${suppression.target}`;
}

/**
 * Runs the registry over the facts and applies the policy. Pure apart from
 * the evaluation date used for suppression expiry.
 */
export function evaluateQuality(
  facts: QualityFacts,
  options: EvaluateOptions = {},
): QualityEvaluation {
  const policy = options.policy ?? DEFAULT_POLICY;
  const today = utcDay(options.now ?? new Date());
  const { findings, ran, truncated } = run(facts, policy);

  const suppressions = new Map<string, Suppression>();
  for (const suppression of policy.suppressions) {
    suppressions.set(suppressionKey(suppression), suppression);
  }
  const matched = new Set<string>();
  const expired = new Set<string>();

  const evaluated: EvaluatedFinding[] = findings.map((finding) => {
    const severity = severityOf(finding.rule, policy);
    const key = `${finding.rule}\u0000${finding.target.identity}`;
    const suppression = suppressions.get(key);
    if (suppression === undefined) return { ...finding, severity };
    matched.add(key);
    // Expiry is an inclusive last day in UTC: on the day itself the
    // suppression still applies, the day after it does not.
    if (suppression.expires !== undefined && today > suppression.expires) {
      expired.add(key);
      return { ...finding, severity };
    }
    return {
      ...finding,
      severity,
      suppressed: {
        reason: clamp(
          suppression.reason,
          QUALITY_LIMITS.maxSuppressionReasonLength,
        ),
        ...(suppression.expires === undefined
          ? {}
          : { expires: suppression.expires }),
      },
    };
  });

  // Governance findings: a suppression that hid nothing, and one that ran out.
  for (const [key, suppression] of suppressions) {
    const rule = expired.has(key)
      ? "suppression-expired"
      : "suppression-unused";
    if (rule === "suppression-unused" && matched.has(key)) continue;
    evaluated.push({
      category: "policy",
      id: `${rule}:${suppression.rule}@${suppression.target}`,
      message:
        rule === "suppression-expired"
          ? "The suppression expired and no longer hides its finding."
          : "The suppression matched no finding; the rule or the entity it names produces nothing here.",
      rule,
      severity: severityOf(rule, policy),
      target: {
        identity: `${suppression.rule}@${suppression.target}`,
        kind: "suppression",
        label: `${suppression.rule} on ${clamp(suppression.target, 120)}`,
      },
    });
  }

  evaluated.sort(compare);

  const counts = { error: 0, info: 0, warning: 0 };
  let suppressed = 0;
  for (const finding of evaluated) {
    if (finding.suppressed !== undefined) {
      suppressed += 1;
      continue;
    }
    counts[finding.severity] += 1;
  }

  const summary = gate(counts, suppressed, ran, truncated, policy);
  return {
    findings: evaluated,
    qualityFormat: QUALITY_FORMAT_VERSION,
    summary,
    target: facts.target,
    ...(facts.comparison === undefined
      ? {}
      : { comparison: { from: facts.comparison.from } }),
  };
}

function gate(
  counts: Record<Severity, number>,
  suppressed: number,
  ran: number,
  truncated: ReadonlySet<RuleId>,
  policy: QualityPolicy,
): QualitySummary {
  const base = {
    error: counts.error,
    info: counts.info,
    rules: ran,
    suppressed,
    truncated: truncated.size > 0,
    warning: counts.warning,
  };
  if (policy.failOn === "never") {
    return { ...base, gate: "passed" };
  }
  const threshold = SEVERITY_RANK[policy.failOn];
  for (const severity of ["error", "warning", "info"] as const) {
    if (SEVERITY_RANK[severity] >= threshold && counts[severity] > 0) {
      return { ...base, gate: "failed", reason: severity };
    }
  }
  if (policy.maxWarnings !== undefined && counts.warning > policy.maxWarnings) {
    return { ...base, gate: "failed", reason: "maxWarnings" };
  }
  // An incomplete rule can only be trusted to pass when its severity could
  // not have influenced the decision (SPEC-011 §72).
  for (const rule of truncated) {
    const severity = severityOf(rule, policy);
    const counted =
      SEVERITY_RANK[severity] >= threshold ||
      (policy.maxWarnings !== undefined && severity === "warning");
    if (counted) return { ...base, gate: "failed", reason: "truncated" };
  }
  return { ...base, gate: "passed" };
}
