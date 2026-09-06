/**
 * The rule registry (SPEC-011 §75). A single static array, composed at
 * module load from explicit imports: no filesystem discovery, no dynamic
 * import, no plugin hook, no way for configuration to add a rule. Order is
 * the order rules run, and it never depends on how the modules happened to
 * be loaded.
 */

import type { QualityRule, RuleId } from "./contracts.js";
import { AUTHENTICATION_RULES } from "./rules/authentication.js";
import { COMPATIBILITY_RULES } from "./rules/compatibility.js";
import { CONTENT_RULES } from "./rules/content.js";
import { EXAMPLE_RULES } from "./rules/examples.js";
import { OPERATION_RULES } from "./rules/operations.js";
import { POLICY_RULES } from "./rules/policy.js";
import { SCHEMA_RULES } from "./rules/schemas.js";
import { SDK_RULES } from "./rules/sdk.js";

/** Bumped when a rule is added, removed, or its default severity changes. */
export const RULE_REGISTRY_VERSION = 1 as const;

export const RULES: readonly QualityRule[] = [
  ...OPERATION_RULES,
  ...SCHEMA_RULES,
  ...EXAMPLE_RULES,
  ...AUTHENTICATION_RULES,
  ...SDK_RULES,
  ...CONTENT_RULES,
  ...COMPATIBILITY_RULES,
  ...POLICY_RULES,
];

const BY_ID: ReadonlyMap<RuleId, QualityRule> = new Map(
  RULES.map((rule) => [rule.id, rule]),
);

export function findRule(id: string): QualityRule | undefined {
  // A plain Map, so `__proto__` and `constructor` are ordinary missing keys.
  return BY_ID.get(id);
}

export function isRuleId(id: string): boolean {
  return BY_ID.has(id);
}

/** Every published rule id, in registry order. */
export const RULE_IDS: readonly RuleId[] = RULES.map((rule) => rule.id);

/** Rules the policy engine emits itself rather than evaluating over facts. */
export const POLICY_RULE_IDS: readonly RuleId[] = POLICY_RULES.map(
  (rule) => rule.id,
);
