import { createDiagnosticId } from "./identity.js";
import type {
  CanonicalDiagnostic,
  DiagnosticCode,
  DiagnosticLocation,
} from "./types.js";

export const DIAGNOSTIC_MESSAGES: Readonly<Record<DiagnosticCode, string>> =
  Object.freeze({
    DUPLICATE_ID:
      "A canonical identity is duplicated within its uniqueness scope.",
    INVALID_CANONICAL_ID:
      "A canonical identity violates the stable ID contract.",
    INVALID_DIAGNOSTIC:
      "A diagnostic violates the canonical diagnostic contract.",
    INVALID_JSON_VALUE:
      "The artifact contains a number without portable JSON semantics.",
    INVALID_MODEL: "The value does not satisfy the canonical model contract.",
    INVALID_PATH_PARAMETER:
      "Path parameter semantics do not match the operation path template.",
    INVALID_SCHEMA: "A schema node violates the canonical schema contract.",
    MODEL_LIMIT_EXCEEDED:
      "The canonical model exceeds a configured resource budget.",
    MISSING_DIAGNOSTIC:
      "A schema refers to a diagnostic absent from the artifact.",
    MISSING_REFERENCE:
      "A schema reference is absent from its service registry.",
    MISSING_SECURITY_SCHEME:
      "A security requirement refers to an absent scheme.",
    MISSING_SERVER: "An operation refers to an absent contract server.",
    NON_SERIALIZABLE:
      "The artifact contains a value outside the serializable JSON contract.",
    SCHEMA_IGNORED_ANNOTATION:
      "A source annotation was intentionally omitted from the documentation projection.",
    SCHEMA_INVALID_SEMANTIC:
      "Source schema semantics are invalid and cannot be represented.",
    SCHEMA_PARTIALLY_REPRESENTED:
      "Source schema semantics are represented only partially.",
    SCHEMA_UNSUPPORTED_SEMANTIC:
      "Source schema semantics are unsupported by model v1.",
  });

const DEFAULT_SEVERITY: Readonly<
  Record<DiagnosticCode, CanonicalDiagnostic["severity"]>
> = Object.freeze({
  DUPLICATE_ID: "error",
  INVALID_CANONICAL_ID: "error",
  INVALID_DIAGNOSTIC: "error",
  INVALID_JSON_VALUE: "error",
  INVALID_MODEL: "error",
  INVALID_PATH_PARAMETER: "error",
  INVALID_SCHEMA: "error",
  MODEL_LIMIT_EXCEEDED: "error",
  MISSING_DIAGNOSTIC: "error",
  MISSING_REFERENCE: "error",
  MISSING_SECURITY_SCHEME: "error",
  MISSING_SERVER: "error",
  NON_SERIALIZABLE: "error",
  SCHEMA_IGNORED_ANNOTATION: "info",
  SCHEMA_INVALID_SEMANTIC: "error",
  SCHEMA_PARTIALLY_REPRESENTED: "warning",
  SCHEMA_UNSUPPORTED_SEMANTIC: "warning",
});

export interface DiagnosticInput {
  readonly code: DiagnosticCode;
  readonly location?: DiagnosticLocation;
  readonly severity?: CanonicalDiagnostic["severity"];
}

export function createDiagnostic(input: DiagnosticInput): CanonicalDiagnostic {
  const location =
    input.location === undefined ? undefined : { ...input.location };
  return {
    code: input.code,
    id: createDiagnosticId(input.code, location),
    ...(location === undefined ? {} : { location }),
    message: DIAGNOSTIC_MESSAGES[input.code],
    severity: input.severity ?? DEFAULT_SEVERITY[input.code],
  };
}
