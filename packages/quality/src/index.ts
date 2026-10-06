/**
 * `@specistry/quality`: the documentation-quality engine of SPEC-011. Pure
 * data logic over the canonical, authored, snippet, and release-diff
 * contracts. It reads no file, opens no socket, renders nothing, and loads
 * no rule at runtime: the registry is a static array composed from
 * explicit imports. The CLI orchestrates; this package decides nothing
 * about exit codes and nothing about presentation.
 */

export {
  DEFAULT_POLICY,
  QUALITY_FORMAT_VERSION,
  QUALITY_LIMITS,
  QUALITY_MESSAGES,
  QualityContractError,
  RULE_CATEGORIES,
  SEVERITIES,
  SEVERITY_RANK,
  SEVERITY_SETTINGS,
  type EvaluatedFinding,
  type FactTarget,
  type FailOn,
  type FindingTarget,
  type QualityDiagnostic,
  type QualityDiagnosticCode,
  type QualityEvaluation,
  type QualityFinding,
  type QualityPolicy,
  type QualityRule,
  type QualitySummary,
  type RuleCategory,
  type RuleFinding,
  type RuleId,
  type Severity,
  type SeveritySetting,
  type Suppression,
  type TargetKind,
} from "./contracts.js";

export {
  collectFacts,
  identityOf,
  operationLabel,
  type ChangedOperation,
  type ComparisonFacts,
  type FactIndex,
  type FactsInput,
  type OperationFacts,
  type PageFacts,
  type QualityFacts,
  type SchemaFacts,
  type SdkFacts,
  type SecuritySchemeFacts,
  type ServiceFacts,
} from "./facts.js";

export { evaluateQuality, utcDay, type EvaluateOptions } from "./engine.js";

export { parsePolicy, type PolicyInput, type PolicyResult } from "./policy.js";

export {
  findRule,
  isRuleId,
  POLICY_RULE_IDS,
  RULE_IDS,
  RULE_REGISTRY_VERSION,
  RULES,
} from "./registry.js";

export { serializeEvaluation } from "./serialize.js";
