/**
 * Compatibility rules (SPEC-011 §18–§21, §98–§106). These read the
 * SPEC-010 structured diff *and* both fact sets; they never mutate a diff
 * record and never add a diff aspect. Only semantics that can be defended
 * from canonical data are classified. Everything else stays "changed,
 * review required" rather than claiming a break, because a false breaking
 * label costs more trust than a missed one. Every rule walks the indexed
 * candidates once: no rule compares every operation with every candidate.
 */

import type { Operation, SecurityRequirement } from "@specra/model";
import type { ChangeAspect } from "@specra/release";

import type { QualityRule, RuleFinding } from "../contracts.js";
import type {
  ComparisonFacts,
  OperationFacts,
  QualityFacts,
} from "../facts.js";

function operationTarget(entry: OperationFacts) {
  return {
    identity: entry.identity,
    kind: "operation" as const,
    label: entry.label,
  };
}

/**
 * Walks each changed operation once and hands the rule the details of one
 * aspect together with the operation as it now stands.
 */
function forEachAspect(
  facts: QualityFacts,
  aspect: ChangeAspect,
  visit: (
    entry: OperationFacts,
    detail: string,
    comparison: ComparisonFacts,
  ) => void,
): void {
  const comparison = facts.comparison;
  if (comparison === undefined) return;
  for (const [identity, changed] of comparison.changed) {
    const details = changed.aspects.get(aspect);
    if (details === undefined) continue;
    const entry = facts.operationsByIdentity.get(identity);
    if (entry === undefined) continue;
    for (const detail of details) visit(entry, detail, comparison);
  }
}

export const apiOperationRemoved: QualityRule = {
  category: "compatibility",
  defaultSeverity: "error",
  evaluate(facts, emit) {
    const comparison = facts.comparison;
    if (comparison === undefined) return;
    for (const candidate of comparison.diff.candidates) {
      if (candidate.kind === "operation-removed") {
        emit({
          message:
            "The operation was documented in the comparison base and is absent here.",
          target: {
            identity: candidate.identity,
            kind: "operation",
            label: candidate.label,
          },
        });
        continue;
      }
      // A removed service reports no per-operation candidate, so expand it
      // through the base facts rather than letting the operations vanish
      // silently.
      if (candidate.kind !== "service-removed") continue;
      for (const entry of comparison.base.operations) {
        if (entry.serviceId !== candidate.identity) continue;
        emit({
          message:
            "The service was documented in the comparison base and is absent here, so the operation is gone with it.",
          target: operationTarget(entry),
        });
      }
    }
  },
  id: "api-operation-removed",
  requiresComparison: true,
  summary:
    "An operation a previous release documented is no longer documented; existing callers lose it.",
  title: "Operation removed since the comparison base",
};

export const apiRequiredParameterAdded: QualityRule = {
  category: "compatibility",
  defaultSeverity: "error",
  evaluate(facts, emit) {
    forEachAspect(facts, "parameter-added", (entry, key) => {
      // Requiredness is not a diff aspect; it is read from the target
      // facts, where the added parameter now lives.
      const parameter = entry.operation.parameters.find(
        (item) => `${item.location}:${item.name}` === key,
      );
      if (parameter?.required !== true) return;
      emit({
        locator: key,
        message:
          "A required parameter was added, so a call that was valid against the comparison base is now rejected.",
        target: operationTarget(entry),
      });
    });
  },
  id: "api-required-parameter-added",
  requiresComparison: true,
  summary:
    "A newly required parameter breaks callers written against the previous release.",
  title: "Required parameter added",
};

export const apiParameterRemoved: QualityRule = {
  category: "compatibility",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    forEachAspect(facts, "parameter-removed", (entry, key) => {
      emit({
        locator: key,
        message:
          "A documented parameter disappeared; callers still sending it have no documented behaviour.",
        target: operationTarget(entry),
      });
    });
  },
  id: "api-parameter-removed",
  requiresComparison: true,
  summary:
    "A parameter the previous release documented is gone from the contract.",
  title: "Parameter removed",
};

export const apiResponseRemoved: QualityRule = {
  category: "compatibility",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    forEachAspect(facts, "response-removed", (entry, status) => {
      emit({
        locator: status,
        message:
          "A documented response status disappeared; callers handling it have no documented contract.",
        target: operationTarget(entry),
      });
    });
  },
  id: "api-response-removed",
  requiresComparison: true,
  summary: "A response status the previous release documented is gone.",
  title: "Response status removed",
};

/**
 * OR-of-AND set semantics (SPEC-011 §101, §170). A caller who holds
 * exactly the schemes of one accepted alternative could call before; they
 * can still call afterwards only if some alternative is a subset of what
 * they hold. Anonymous access is the empty alternative, so removing it is
 * caught by the same rule. Nothing is inferred from descriptions.
 */
function alternatives(operation: Operation): readonly ReadonlySet<string>[] {
  return operation.security.map(
    (requirement: SecurityRequirement) =>
      new Set(requirement.schemes.map((use) => use.schemeId)),
  );
}

function isSubset(
  candidate: ReadonlySet<string>,
  held: ReadonlySet<string>,
): boolean {
  for (const scheme of candidate) if (!held.has(scheme)) return false;
  return true;
}

export const apiSecurityRestricted: QualityRule = {
  category: "compatibility",
  defaultSeverity: "error",
  evaluate(facts, emit) {
    const seen = new Set<string>();
    forEachAspect(facts, "security", (entry, _detail, comparison) => {
      if (seen.has(entry.identity)) return;
      seen.add(entry.identity);
      const previous = comparison.base.operationsByIdentity.get(entry.identity);
      if (previous === undefined) return;
      const before = alternatives(previous.operation);
      const after = alternatives(entry.operation);
      // An unconstrained contract accepts everything; treat an empty list
      // as "no documented requirement" rather than as anonymous access.
      if (before.length === 0 || after.length === 0) return;
      const lost = before.some(
        (held) => !after.some((accepted) => isSubset(accepted, held)),
      );
      if (!lost) return;
      const finding: RuleFinding = {
        message:
          "Authentication became more restrictive: a credential set the comparison base accepted no longer satisfies any alternative.",
        target: operationTarget(entry),
      };
      emit(finding);
    });
  },
  id: "api-security-restricted",
  requiresComparison: true,
  summary:
    "A caller authenticated under the previous release can no longer satisfy the operation.",
  title: "Authentication became more restrictive",
};

export const apiSchemaChanged: QualityRule = {
  category: "compatibility",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    const comparison = facts.comparison;
    if (comparison === undefined) return;
    for (const candidate of comparison.diff.candidates) {
      if (candidate.kind !== "schema-changed") continue;
      emit({
        message:
          "The reusable schema changed; Specra does not classify the change, so review it against your compatibility policy.",
        target: {
          identity: candidate.identity,
          kind: "schema",
          label: candidate.label,
        },
      });
    }
    for (const aspect of ["request-schema", "response-schema"] as const) {
      forEachAspect(facts, aspect, (entry, detail) => {
        const where = aspect === "request-schema" ? "request" : "response";
        emit({
          locator: `${where} ${detail}`.trim(),
          message:
            "A payload schema changed; Specra does not classify the change, so review it against your compatibility policy.",
          target: operationTarget(entry),
        });
      });
    }
  },
  id: "api-schema-changed",
  requiresComparison: true,
  summary:
    "A schema changed in a way Specra deliberately does not classify; a human decides whether it breaks callers.",
  title: "Schema changed, review required",
};

export const COMPATIBILITY_RULES: readonly QualityRule[] = [
  apiOperationRemoved,
  apiRequiredParameterAdded,
  apiParameterRemoved,
  apiResponseRemoved,
  apiSecurityRestricted,
  apiSchemaChanged,
];
