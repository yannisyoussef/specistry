/**
 * Authentication rules (SPEC-011 §30). Specra documents contracts: these
 * rules ask whether a reader can tell how to authenticate, never whether
 * the authentication is strong. Nothing here judges security posture.
 */

import type { QualityRule } from "../contracts.js";
import { hasText } from "./text.js";

export const authSchemeDescription: QualityRule = {
  category: "authentication",
  defaultSeverity: "warning",
  evaluate(facts, emit) {
    for (const entry of facts.securitySchemes) {
      if (entry.usedBy === 0 || hasText(entry.scheme.description)) continue;
      emit({
        message:
          "The security scheme protects operations but has no description telling a reader how to obtain a credential.",
        target: {
          identity: entry.identity,
          kind: "security-scheme",
          label: entry.label,
        },
      });
    }
  },
  id: "auth-scheme-description",
  summary:
    "A scheme that operations require explains how a caller gets and sends a credential.",
  title: "Security scheme has a description",
};

export const authAnonymousAlternative: QualityRule = {
  category: "authentication",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.operations) {
      const alternatives = entry.operation.security;
      if (alternatives.length < 2) continue;
      const anonymous = alternatives.some(
        (requirement) => requirement.schemes.length === 0,
      );
      const authenticated = alternatives.some(
        (requirement) => requirement.schemes.length > 0,
      );
      if (!anonymous || !authenticated) continue;
      emit({
        message:
          "The operation can be called anonymously as well as with a credential; make the difference explicit in its description.",
        target: {
          identity: entry.identity,
          kind: "operation",
          label: entry.label,
        },
      });
    }
  },
  id: "auth-anonymous-alternative",
  summary:
    "An operation that accepts both anonymous and authenticated calls says what changes between them.",
  title: "Anonymous alternative is explained",
};

export const AUTHENTICATION_RULES: readonly QualityRule[] = [
  authSchemeDescription,
  authAnonymousAlternative,
];
