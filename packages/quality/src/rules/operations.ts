/**
 * Operation rules (SPEC-011 §26). Every rule here asks whether a reader
 * can understand a valid operation, never whether the contract is valid:
 * ingestion already owns correctness, and a condition that cannot occur in
 * a valid artifact is not a quality rule.
 */

import type { QualityRule } from "../contracts.js";
import type { OperationFacts } from "../facts.js";
import { hasText, isSuccessStatus } from "./text.js";

function target(operation: OperationFacts) {
  return {
    identity: operation.identity,
    kind: "operation" as const,
    label: operation.label,
  };
}

export const operationDescription: QualityRule = {
  category: "operations",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      if (hasText(entry.operation.description)) continue;
      emit({
        message: "The operation has no description.",
        target: target(entry),
      });
    }
  },
  id: "operation-description",
  summary:
    "An operation explains what it does; a title alone rarely tells a reader when to call it.",
  title: "Operation has a description",
};

export const operationSummary: QualityRule = {
  category: "operations",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      const { contractId, method, path, title } = entry.operation;
      const derived = contractId ?? `${method} ${path}`;
      if (title !== derived) continue;
      emit({
        message:
          "The contract declares no summary, so the title falls back to the operation id or the method and path.",
        target: target(entry),
      });
    }
  },
  id: "operation-summary",
  summary:
    "An operation carries a human summary rather than an identifier as its heading.",
  title: "Operation has a summary",
};

export const operationSuccessResponse: QualityRule = {
  category: "operations",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      const documented = entry.operation.responses.some(
        (response) =>
          isSuccessStatus(response.status) ||
          response.status.kind === "default",
      );
      if (documented) continue;
      emit({
        message:
          "The operation documents no successful response and no default response.",
        target: target(entry),
      });
    }
  },
  id: "operation-success-response",
  summary:
    "A caller can see what a successful call returns, not only its failures.",
  title: "Operation documents a successful response",
};

export const operationParameterDescription: QualityRule = {
  category: "operations",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      for (const parameter of entry.operation.parameters) {
        if (hasText(parameter.description)) continue;
        emit({
          locator: `${parameter.location}:${parameter.name}`,
          message: "The parameter has no description.",
          target: target(entry),
        });
      }
    }
  },
  id: "operation-parameter-description",
  summary: "A caller can tell what each parameter controls.",
  title: "Parameter has a description",
};

export const operationRequestDescription: QualityRule = {
  category: "operations",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      const body = entry.operation.requestBody;
      if (body === undefined || hasText(body.description)) continue;
      emit({
        message: "The request body has no description.",
        target: target(entry),
      });
    }
  },
  id: "operation-request-description",
  summary:
    "An operation that accepts a body explains what the caller should send.",
  title: "Request body has a description",
};

export const OPERATION_RULES: readonly QualityRule[] = [
  operationDescription,
  operationSummary,
  operationSuccessResponse,
  operationParameterDescription,
  operationRequestDescription,
];
