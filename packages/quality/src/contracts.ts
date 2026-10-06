/**
 * `@specistry/quality` contracts (SPEC-011 §8–§11). Three layers stay
 * separate: normalized **facts** describe the documentation, **rules**
 * turn facts into findings, and **policy** decides what a finding means
 * for a build. A rule never knows an exit code; a finding never carries a
 * configured severity; the CLI never implements a rule.
 */

import type { QualityFacts } from "./facts.js";

export type { QualityFacts };

/** Effective severity of a finding. `off` is a configuration value only. */
export type Severity = "error" | "info" | "warning";
export type SeveritySetting = Severity | "off";

export const SEVERITIES: readonly Severity[] = ["error", "warning", "info"];
export const SEVERITY_SETTINGS: readonly SeveritySetting[] = [
  "error",
  "warning",
  "info",
  "off",
];

/** Ascending order; a threshold of `warning` also fails on `error`. */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 3,
  info: 1,
  warning: 2,
};

export type RuleCategory =
  | "authentication"
  | "compatibility"
  | "content"
  | "examples"
  | "operations"
  | "policy"
  | "schemas"
  | "sdk";

export const RULE_CATEGORIES: readonly RuleCategory[] = [
  "operations",
  "schemas",
  "examples",
  "authentication",
  "sdk",
  "content",
  "compatibility",
  "policy",
];

/** What a finding is about. The identity is stable across source reordering. */
export type TargetKind =
  | "operation"
  | "page"
  | "schema"
  | "sdk"
  | "security-scheme"
  | "service"
  | "suppression";

export interface FindingTarget {
  readonly kind: TargetKind;
  /** Canonical identity: `service`, `service~operation`, `service~schema`, a route, an SDK id. */
  readonly identity: string;
  /** Short human label for output: `GET /inboxes`, a schema name, a page title. */
  readonly label: string;
}

/** What a rule emits: a fact about the documentation, with no policy. */
export interface RuleFinding {
  readonly target: FindingTarget;
  /** Fixed, value-free sentence. Never contains an example value or a secret. */
  readonly message: string;
  /** Narrows the finding inside its target: a property, parameter, status, media type. */
  readonly locator?: string;
  /** Project-relative authored source path, when the artifact preserves one. */
  readonly source?: string;
  /** 1-based line inside `source`, when known. */
  readonly line?: number;
}

/** A rule finding with its identity and rule attached, before policy. */
export interface QualityFinding extends RuleFinding {
  /** `<rule>:<identity>[:<locator>]`; deterministic, never a UUID or a line. */
  readonly id: string;
  readonly rule: RuleId;
  readonly category: RuleCategory;
}

/** A finding after policy: effective severity and suppression state. */
export interface EvaluatedFinding extends QualityFinding {
  readonly severity: Severity;
  readonly suppressed?: {
    readonly reason: string;
    readonly expires?: string;
  };
}

export type RuleId = string;

export interface QualityRule {
  /** Public, ASCII, kebab-case; a published rule id is API surface. */
  readonly id: RuleId;
  readonly category: RuleCategory;
  readonly defaultSeverity: Severity;
  readonly title: string;
  /** One sentence, mirrored in `docs/quality.md` and drift-tested. */
  readonly summary: string;
  /** Compatibility rules produce nothing without a comparison base. */
  readonly requiresComparison?: boolean;
  evaluate(facts: QualityFacts, emit: (finding: RuleFinding) => void): void;
}

/** Bounds shared by evaluation and reporting; nothing is unbounded. */
export const QUALITY_LIMITS = {
  maxFindings: 5_000,
  maxFindingsPerRule: 1_000,
  maxMessageLength: 200,
  maxSuppressionReasonLength: 200,
  maxSuppressions: 1_000,
} as const;

export const QUALITY_FORMAT_VERSION = 1 as const;

export type QualityDiagnosticCode =
  | "QUALITY_RULE_UNKNOWN"
  | "QUALITY_SEVERITY_INVALID"
  | "QUALITY_SUPPRESSION_INVALID"
  | "QUALITY_THRESHOLD_INVALID";

export interface QualityDiagnostic {
  readonly code: QualityDiagnosticCode;
  /** RFC 6901 pointer inside the `quality` configuration object. */
  readonly path: string;
}

export const QUALITY_MESSAGES: Readonly<Record<QualityDiagnosticCode, string>> =
  {
    QUALITY_RULE_UNKNOWN:
      "The configuration names a rule that does not exist; see the rule catalogue in docs/quality.md.",
    QUALITY_SEVERITY_INVALID:
      "A rule severity must be one of off, info, warning, or error.",
    QUALITY_SUPPRESSION_INVALID:
      "A suppression needs a known rule, an exact target identity, a plain-text reason of at most 200 characters, and an optional YYYY-MM-DD expiry.",
    QUALITY_THRESHOLD_INVALID:
      "failOn must be error, warning, info, or never, and maxWarnings a non-negative integer.",
  };

export class QualityContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "QualityContractError";
  }
}

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

export interface Suppression {
  readonly rule: RuleId;
  /** Exact entity identity. Wildcards are deliberately unsupported. */
  readonly target: string;
  readonly reason: string;
  /** Calendar date in UTC; from this date the suppression no longer applies. */
  readonly expires?: string;
}

export type FailOn = Severity | "never";

export interface QualityPolicy {
  readonly rules: Readonly<Record<RuleId, SeveritySetting>>;
  readonly failOn: FailOn;
  readonly maxWarnings?: number;
  readonly suppressions: readonly Suppression[];
}

export const DEFAULT_POLICY: QualityPolicy = {
  failOn: "error",
  rules: {},
  suppressions: [],
};

/* ------------------------------------------------------------------ */
/* Facts                                                               */
/* ------------------------------------------------------------------ */

export interface FactTarget {
  readonly kind: "candidate" | "release";
  /** The release id when checking a retained release. */
  readonly version?: string;
}

export interface QualitySummary {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
  readonly suppressed: number;
  readonly rules: number;
  /** True when the finding budget was reached; the evaluation is incomplete. */
  readonly truncated: boolean;
  readonly gate: "failed" | "passed";
  /** Why the gate failed, for output; absent when it passed. */
  readonly reason?: "error" | "info" | "maxWarnings" | "truncated" | "warning";
}

export interface QualityEvaluation {
  readonly qualityFormat: typeof QUALITY_FORMAT_VERSION;
  readonly target: FactTarget;
  readonly comparison?: { readonly from: string };
  readonly summary: QualitySummary;
  readonly findings: readonly EvaluatedFinding[];
}
