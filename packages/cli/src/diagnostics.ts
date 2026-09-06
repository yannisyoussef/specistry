import {
  CONTENT_DIAGNOSTIC_MESSAGES,
  contentSeverity,
  type ContentDiagnostic,
  type ContentDiagnosticCode,
} from "@specra/content";
import {
  SOURCE_DIAGNOSTIC_MESSAGES,
  SOURCE_DIAGNOSTIC_SEVERITY,
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
  ...CONTENT_DIAGNOSTIC_MESSAGES,
  ARTIFACT_INVALID:
    "The canonical artifact did not satisfy the model contract; report this reproducible failure without secrets.",
  ARTIFACT_WRITE_FAILED:
    "The artifact directory could not be written or replaced atomically.",
  SEARCH_BUILD_FAILED:
    "The search index could not be generated from the build artifacts.",
  SNIPPETS_BUILD_FAILED:
    "The code samples could not be generated from the build artifacts.",
  SNIPPET_BODY_TRUNCATED:
    "The generated request body example was bounded; the schema is larger than the example budget.",
  SNIPPET_HEADER_SKIPPED:
    "A header parameter name is not a valid HTTP header token and is omitted from code samples.",
  SNIPPET_SERVER_UNUSABLE:
    "A contract server URL is relative, uses plain HTTP off loopback, or carries credentials, query, or fragment; it is not offered as an environment.",
  SDK_ID_DUPLICATE: "Two SDK declarations share the same id.",
  SDK_EXAMPLE_CODE_EMPTY: "The SDK example code is empty.",
  SDK_EXAMPLE_CODE_TOO_LARGE:
    "The SDK example code exceeds the maximum size (16 KiB).",
  SDK_EXAMPLE_DUPLICATE: "The operation already has an example for this SDK.",
  SDK_EXAMPLE_FILE_INVALID:
    "The SDK example file is missing, outside the project root, not a file, or not the expected shape.",
  SDK_EXAMPLE_MISSING:
    "The SDK is declared complete but this operation has no example for it.",
  SDK_EXAMPLE_TARGET_AMBIGUOUS:
    "The SDK example target matches more than one operation; add the service to the target.",
  SDK_EXAMPLE_TARGET_NOT_FOUND:
    "The SDK example target matches no operation in the canonical model.",
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

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
};

const CLI_WARNINGS: ReadonlySet<DiagnosticCode> = new Set([
  "SDK_EXAMPLE_MISSING",
  "SNIPPET_BODY_TRUNCATED",
  "SNIPPET_HEADER_SKIPPED",
  "SNIPPET_SERVER_UNUSABLE",
]);

/** Severity is a property of the code; source codes defer to the adapter table. */
export function severityOf(code: DiagnosticCode): DiagnosticSeverity {
  if (CLI_WARNINGS.has(code)) return "warning";
  if (Object.hasOwn(SOURCE_DIAGNOSTIC_SEVERITY, code)) {
    return SOURCE_DIAGNOSTIC_SEVERITY[
      code as keyof typeof SOURCE_DIAGNOSTIC_SEVERITY
    ];
  }
  if (Object.hasOwn(CONTENT_DIAGNOSTIC_MESSAGES, code)) {
    return contentSeverity(code as ContentDiagnosticCode);
  }
  return "error";
}

export function createDiagnostic(
  code: DiagnosticCode,
  path?: string,
  location?: { readonly line: number; readonly column: number },
): Diagnostic {
  const severity = severityOf(code);
  return {
    code,
    message: messages[code],
    ...(path === undefined ? {} : { path }),
    severity,
    ...(location === undefined
      ? {}
      : { column: location.column, line: location.line }),
  };
}

/**
 * Projects a content diagnostic onto the CLI grammar: authored files become
 * `source/<path>` scopes with line and column; navigation entries already
 * carry `config#/…` pointers.
 */
export function fromContentDiagnostic(
  diagnostic: ContentDiagnostic,
): Diagnostic {
  const path = diagnostic.path.startsWith("config")
    ? diagnostic.path
    : `source/${diagnostic.path}`;
  return createDiagnostic(
    diagnostic.code,
    path,
    diagnostic.line === undefined || diagnostic.column === undefined
      ? undefined
      : { column: diagnostic.column, line: diagnostic.line },
  );
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
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
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
