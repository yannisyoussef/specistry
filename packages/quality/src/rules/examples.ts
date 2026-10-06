/**
 * Example rules (SPEC-011 §29). Examples are the fastest way to
 * understand a payload, and the easiest place to leak a real secret. The
 * credential rule reports *where* something credential-shaped appears and
 * never what it is.
 */

import type { MediaTypeContent, Operation } from "@specistry/model";

import type { QualityRule, RuleFinding } from "../contracts.js";
import type { OperationFacts } from "../facts.js";
import { findCredential, isSuccessStatus, statusLabel } from "./text.js";

function target(operation: OperationFacts) {
  return {
    identity: operation.identity,
    kind: "operation" as const,
    label: operation.label,
  };
}

/** True when neither the media type nor its schema carries an example. */
function hasExample(content: MediaTypeContent): boolean {
  return (
    content.examples.length > 0 ||
    (content.schema?.examples ?? []).length > 0 ||
    content.schema?.defaultValue !== undefined
  );
}

export const exampleRequestMissing: QualityRule = {
  category: "examples",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      for (const content of entry.operation.requestBody?.content ?? []) {
        if (hasExample(content)) continue;
        emit({
          locator: content.mediaType,
          message: "The request body has no example.",
          target: target(entry),
        });
      }
    }
  },
  id: "example-request-missing",
  summary: "A request payload shows a reader what a real call looks like.",
  title: "Request body has an example",
};

export const exampleResponseMissing: QualityRule = {
  category: "examples",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      for (const response of entry.operation.responses) {
        if (!isSuccessStatus(response.status)) continue;
        for (const content of response.bodies) {
          if (hasExample(content)) continue;
          emit({
            locator: `${statusLabel(response.status)} ${content.mediaType}`,
            message: "The successful response has no example.",
            target: target(entry),
          });
        }
      }
    }
  },
  id: "example-response-missing",
  summary: "A successful payload shows a reader what to expect back.",
  title: "Successful response has an example",
};

/** Every example an operation carries, with a locator naming where it sits. */
function* operationExamples(
  operation: Operation,
): Generator<{ locator: string; value: unknown }> {
  for (const parameter of operation.parameters) {
    for (const example of parameter.examples) {
      yield {
        locator: `${parameter.location}:${parameter.name}`,
        value: example.value,
      };
    }
  }
  for (const content of operation.requestBody?.content ?? []) {
    for (const example of content.examples) {
      yield { locator: `request ${content.mediaType}`, value: example.value };
    }
  }
  for (const response of operation.responses) {
    for (const header of response.headers) {
      for (const example of header.examples) {
        yield {
          locator: `${statusLabel(response.status)} header ${header.name}`,
          value: example.value,
        };
      }
    }
    for (const content of response.bodies) {
      for (const example of content.examples) {
        yield {
          locator: `${statusLabel(response.status)} ${content.mediaType}`,
          value: example.value,
        };
      }
    }
  }
}

export const exampleCredentialValue: QualityRule = {
  category: "examples",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      for (const example of operationExamples(entry.operation)) {
        const hit = findCredential(
          example.value as Parameters<typeof findCredential>[0],
        );
        if (hit === undefined) continue;
        const finding: RuleFinding = {
          locator: `${example.locator} → ${hit.path}`,
          message:
            "The example carries a credential-shaped value; replace it with an obvious placeholder.",
          target: target(entry),
        };
        emit(finding);
      }
    }
  },
  id: "example-credential-value",
  summary:
    "Published examples must not contain anything shaped like a real key, token, or private key.",
  title: "Example contains no credential-shaped value",
};

export const EXAMPLE_RULES: readonly QualityRule[] = [
  exampleRequestMissing,
  exampleResponseMissing,
  exampleCredentialValue,
];
