/**
 * Policy rules (SPEC-011 §45, §43). These two are emitted by the policy
 * engine rather than by walking facts, because they are about the
 * configuration itself. They live in the registry so that they are
 * documented, configurable, and drift-tested like every other rule.
 */

import type { QualityRule } from "../contracts.js";

export const suppressionUnused: QualityRule = {
  category: "policy",
  defaultSeverity: "warning",
  // Emitted by the policy engine, which alone knows which suppressions matched.
  evaluate() {},
  id: "suppression-unused",
  summary:
    "A suppression that matches nothing is stale debt; remove it so the policy keeps describing reality.",
  title: "Suppression matched no finding",
};

export const suppressionExpired: QualityRule = {
  category: "policy",
  defaultSeverity: "warning",
  evaluate() {},
  id: "suppression-expired",
  summary:
    "An expired suppression stops hiding its finding and asks for a decision.",
  title: "Suppression expired",
};

export const POLICY_RULES: readonly QualityRule[] = [
  suppressionUnused,
  suppressionExpired,
];
