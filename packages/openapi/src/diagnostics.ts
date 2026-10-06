import type { DiagnosticId } from "@specistry/model";

import { comparePointers } from "./pointer.js";
import { boundPointer } from "./pointer.js";

/** Where a source diagnostic points: a project-relative document plus pointer. */
export interface SourceLocation {
  /** Project-relative POSIX path of the source document (never absolute). */
  readonly document: string;
  /** RFC 6901 JSON pointer inside that document (`""` is the whole document). */
  readonly pointer: string;
}

export type SourceDiagnosticCode =
  | "SOURCE_DUPLICATE_OPERATION_ID"
  | "SOURCE_IDENTITY_COLLISION"
  | "SOURCE_INVALID"
  | "SOURCE_LIMIT_EXCEEDED"
  | "SOURCE_PARSE_FAILED"
  | "SOURCE_PARTIALLY_REPRESENTED"
  | "SOURCE_REFERENCE_INVALID"
  | "SOURCE_REFERENCE_OUTSIDE_ROOT"
  | "SOURCE_REFERENCE_REMOTE_DISABLED"
  | "SOURCE_REFERENCE_UNRESOLVED"
  | "SOURCE_REFERENCE_UNSUPPORTED"
  | "SOURCE_UNSUPPORTED_SEMANTIC"
  | "SOURCE_UNSUPPORTED_VERSION";

export type SourceDiagnosticSeverity = "error" | "warning";

export interface SourceDiagnostic {
  readonly code: SourceDiagnosticCode;
  readonly severity: SourceDiagnosticSeverity;
  /** Fixed, value-free catalog text. */
  readonly message: string;
  readonly location: SourceLocation;
  /** Canonical capability diagnostic this source diagnostic mirrors, if any. */
  readonly canonicalDiagnosticId?: DiagnosticId;
}

export const SOURCE_DIAGNOSTIC_MESSAGES: Readonly<
  Record<SourceDiagnosticCode, string>
> = Object.freeze({
  SOURCE_DUPLICATE_OPERATION_ID:
    "Two operations declare the same operationId; each must be unique.",
  SOURCE_IDENTITY_COLLISION:
    "Two distinct source entities normalize to the same canonical identity.",
  SOURCE_INVALID:
    "The OpenAPI construct at this location does not satisfy the supported specification shape.",
  SOURCE_LIMIT_EXCEEDED: "The source exceeds a configured ingestion budget.",
  SOURCE_PARSE_FAILED:
    "The source could not be parsed as a UTF-8 JSON or YAML object.",
  SOURCE_PARTIALLY_REPRESENTED:
    "The construct is represented by a faithful subset; some source semantics are not carried into the canonical model.",
  SOURCE_REFERENCE_INVALID:
    "The reference is malformed, cyclic where cycles are not allowed, or points at the wrong kind of value.",
  SOURCE_REFERENCE_OUTSIDE_ROOT:
    "The reference resolves outside the project root or through an escaping symlink.",
  SOURCE_REFERENCE_REMOTE_DISABLED:
    "Remote references are disabled; Specistry does not fetch referenced URLs.",
  SOURCE_REFERENCE_UNRESOLVED:
    "The reference target does not exist in the referenced document.",
  SOURCE_REFERENCE_UNSUPPORTED:
    "The reference uses an unsupported scheme, host form, or fragment syntax.",
  SOURCE_UNSUPPORTED_SEMANTIC:
    "The construct is not representable in canonical model v1 and was diagnosed instead of silently narrowed.",
  SOURCE_UNSUPPORTED_VERSION:
    "Only explicit OpenAPI 3.0.x and 3.1.x documents are supported.",
});

/** The single authority for which source codes are warnings. */
export const SOURCE_DIAGNOSTIC_SEVERITY: Readonly<
  Record<SourceDiagnosticCode, SourceDiagnosticSeverity>
> = Object.freeze({
  SOURCE_DUPLICATE_OPERATION_ID: "error",
  SOURCE_IDENTITY_COLLISION: "error",
  SOURCE_INVALID: "error",
  SOURCE_LIMIT_EXCEEDED: "error",
  SOURCE_PARSE_FAILED: "error",
  SOURCE_PARTIALLY_REPRESENTED: "warning",
  SOURCE_REFERENCE_INVALID: "error",
  SOURCE_REFERENCE_OUTSIDE_ROOT: "error",
  SOURCE_REFERENCE_REMOTE_DISABLED: "error",
  SOURCE_REFERENCE_UNRESOLVED: "error",
  SOURCE_REFERENCE_UNSUPPORTED: "error",
  SOURCE_UNSUPPORTED_SEMANTIC: "warning",
  SOURCE_UNSUPPORTED_VERSION: "error",
});

const SEVERITY_RANK: Readonly<Record<SourceDiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
};

export function createSourceDiagnostic(
  code: SourceDiagnosticCode,
  location: SourceLocation,
  canonicalDiagnosticId?: DiagnosticId,
): SourceDiagnostic {
  return {
    code,
    ...(canonicalDiagnosticId === undefined ? {} : { canonicalDiagnosticId }),
    location: { document: location.document, pointer: location.pointer },
    message: SOURCE_DIAGNOSTIC_MESSAGES[code],
    severity: SOURCE_DIAGNOSTIC_SEVERITY[code],
  };
}

export function compareSourceDiagnostics(
  left: SourceDiagnostic,
  right: SourceDiagnostic,
): number {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    compareText(left.code, right.code) ||
    compareText(left.location.document, right.location.document) ||
    comparePointers(left.location.pointer, right.location.pointer) ||
    compareText(
      left.canonicalDiagnosticId ?? "",
      right.canonicalDiagnosticId ?? "",
    )
  );
}

/**
 * Bounded, de-duplicated collector. Once the budget is reached one
 * `SOURCE_LIMIT_EXCEEDED` sentinel at the root document replaces further
 * entries so pathological input cannot amplify output.
 */
export class DiagnosticSink {
  readonly #entries = new Map<string, SourceDiagnostic>();
  readonly #limit: number;
  readonly #rootDocument: string;
  #truncated = false;
  #errors = 0;

  public constructor(limit: number, rootDocument: string) {
    this.#limit = limit;
    this.#rootDocument = rootDocument;
  }

  public add(
    code: SourceDiagnosticCode,
    source: SourceLocation,
    canonicalDiagnosticId?: DiagnosticId,
  ): void {
    const pointer = boundPointer(source.pointer);
    const location =
      pointer === source.pointer
        ? source
        : { document: source.document, pointer };
    const diagnostic = createSourceDiagnostic(
      code,
      location,
      canonicalDiagnosticId,
    );
    const key = [
      diagnostic.code,
      location.document,
      location.pointer,
      canonicalDiagnosticId ?? "",
    ].join("\u001f");
    if (this.#entries.has(key)) return;
    if (this.#entries.size >= this.#limit - 1) {
      if (!this.#truncated) {
        this.#truncated = true;
        const sentinel = createSourceDiagnostic("SOURCE_LIMIT_EXCEEDED", {
          document: this.#rootDocument,
          pointer: "",
        });
        this.#entries.set("\u0000truncated", sentinel);
        this.#errors += 1;
      }
      return;
    }
    this.#entries.set(key, diagnostic);
    if (diagnostic.severity === "error") this.#errors += 1;
  }

  public get errorCount(): number {
    return this.#errors;
  }

  public get hasErrors(): boolean {
    return this.#errors > 0;
  }

  public toSorted(): readonly SourceDiagnostic[] {
    return [...this.#entries.values()].sort(compareSourceDiagnostics);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
