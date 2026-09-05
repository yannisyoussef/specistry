import {
  SOURCE_DIAGNOSTIC_MESSAGES,
  comparePointers,
  escapeSegment,
} from "@specra/openapi";

import type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticSeverity,
} from "./contracts.js";

const messages: Readonly<Record<DiagnosticCode, string>> = {
  ...SOURCE_DIAGNOSTIC_MESSAGES,
  ARTIFACT_INVALID:
    "The canonical artifact did not satisfy the model contract; report this reproducible failure without secrets.",
  ARTIFACT_WRITE_FAILED:
    "The artifact directory could not be written or replaced atomically.",
  CANCELLED: "The command was cancelled.",
  CONFIG_INVALID: "The configuration does not match schema version 1.",
  CONFIG_LOAD_FAILED: "The trusted configuration could not be evaluated.",
  CONFIG_NOT_FOUND: "No specra.config.ts file was found at the project root.",
  CONFIG_NOT_SERIALIZABLE:
    "The configuration must contain only bounded JSON-serializable data.",
  CONFIG_PATH_INVALID:
    "The configured path does not have the required file or directory type.",
  CONFIG_PATH_NOT_FOUND: "The configured project path does not exist.",
  CONFIG_PATH_OUTSIDE_ROOT:
    "The configured path resolves outside the project root.",
  CONFIG_TIMEOUT: "Configuration evaluation exceeded the allowed time.",
  CONFIG_UNSUPPORTED: "The configuration schema version is not supported.",
  INGESTION_FAILED:
    "The OpenAPI ingestion process failed, crashed, or returned an unusable result.",
  INGESTION_TIMEOUT: "OpenAPI ingestion exceeded the allowed time.",
  INTERNAL_ERROR:
    "Specra could not complete the command due to an internal error.",
  PROJECT_ROOT_INVALID:
    "The project root must resolve to an accessible directory.",
};

const WARNING_CODES = new Set<DiagnosticCode>([
  "SOURCE_PARTIALLY_REPRESENTED",
  "SOURCE_UNSUPPORTED_SEMANTIC",
]);

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
};

export function createDiagnostic(
  code: DiagnosticCode,
  path?: string,
  severity: DiagnosticSeverity = WARNING_CODES.has(code) ? "warning" : "error",
): Diagnostic {
  return path === undefined
    ? { code, message: messages[code], severity }
    : { code, message: messages[code], path, severity };
}

/** Converts the schema authority's dotted label (with `*` for user keys) to `config#/...`. */
export function configPath(label: string): string {
  if (label === "config") return "config";
  return `config#${label
    .split(".")
    .map((segment) => `/${escapeSegment(segment)}`)
    .join("")}`;
}

/** `source/<project-relative path>[#pointer]`. */
export function sourcePath(document: string, pointer: string): string {
  return pointer === ""
    ? `source/${document}`
    : `source/${document}#${pointer}`;
}

export function artifactPath(pointer: string): string {
  return pointer === "" || pointer === "/" ? "artifact" : `artifact#${pointer}`;
}

export function cliPath(pointer: string): string {
  return `cli#${pointer}`;
}

/**
 * Deterministic order: errors before warnings, then code, then path by scope
 * and segment-aware pointer comparison, then message.
 */
export function sortDiagnostics(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      compareCodeUnits(left.code, right.code) ||
      comparePaths(left.path ?? "", right.path ?? "") ||
      compareCodeUnits(left.message, right.message),
  );
}

function comparePaths(left: string, right: string): number {
  const leftHash = left.indexOf("#");
  const rightHash = right.indexOf("#");
  const leftScope = leftHash === -1 ? left : left.slice(0, leftHash);
  const rightScope = rightHash === -1 ? right : right.slice(0, rightHash);
  return (
    compareCodeUnits(leftScope, rightScope) ||
    comparePointers(
      leftHash === -1 ? "" : left.slice(leftHash + 1),
      rightHash === -1 ? "" : right.slice(rightHash + 1),
    )
  );
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
