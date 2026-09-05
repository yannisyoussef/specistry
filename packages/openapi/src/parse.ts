import { parse } from "yaml";

import {
  DEFAULT_PARSE_LIMITS,
  areLimitsValid,
  type ParseLimits,
} from "./limits.js";

export interface SourceOrigin {
  readonly id: string;
  readonly kind: "file" | "memory";
}

/**
 * Parser-layer value. It is deliberately opaque to downstream rendering code;
 * only the OpenAPI adapter may inspect `document` before normalization.
 */
export interface OpenApiSourceDocument {
  readonly format: "openapi";
  readonly openapiVersion: string;
  readonly origin: SourceOrigin;
  readonly document: Readonly<Record<string, unknown>>;
}

export class OpenApiIngestionError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_DOCUMENT"
      | "LIMIT_EXCEEDED"
      | "REMOTE_REFERENCE_DENIED"
      | "UNSUPPORTED_REFERENCE_SCHEME"
      | "UNSUPPORTED_VERSION",
    message: string,
  ) {
    super(message);
    this.name = "OpenApiIngestionError";
  }
}

export type ParseFailure =
  | { readonly kind: "invalid-limits" }
  | {
      readonly kind: "limit";
      readonly budget: "bytes" | "depth" | "nodes" | "string";
    }
  | { readonly kind: "not-object" }
  | { readonly kind: "syntax" }
  | { readonly kind: "non-finite" }
  | { readonly kind: "encoding" };

export type ParseOutcome =
  | {
      readonly ok: true;
      readonly value: Readonly<Record<string, unknown>>;
      readonly nodes: number;
    }
  | { readonly ok: false; readonly failure: ParseFailure };

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** Decodes UTF-8 strictly; a byte-order mark is accepted and stripped. */
export function decodeSource(bytes: Uint8Array): string | undefined {
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Bounded YAML/JSON parse of one document. YAML aliases are disabled, keys
 * must be unique, the byte ceiling is checked before parsing, and the single
 * structural walk enforces depth/node/string budgets while freezing the data.
 */
export function parseDocument(
  source: string,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS,
): ParseOutcome {
  if (!areLimitsValid(limits as unknown as Readonly<Record<string, unknown>>)) {
    return { failure: { kind: "invalid-limits" }, ok: false };
  }
  if (Buffer.byteLength(source, "utf8") > limits.maxBytes) {
    return { failure: { budget: "bytes", kind: "limit" }, ok: false };
  }
  let parsed: unknown;
  try {
    parsed = parse(source, {
      maxAliasCount: 0,
      prettyErrors: false,
      strict: true,
      uniqueKeys: true,
    });
  } catch {
    return { failure: { kind: "syntax" }, ok: false };
  }
  if (!isRecord(parsed)) {
    return { failure: { kind: "not-object" }, ok: false };
  }
  const walk = enforceStructuralLimits(parsed, limits);
  if (!walk.ok) return walk;
  return { nodes: walk.nodes, ok: true, value: parsed };
}

export function parseOpenApiSource(
  source: string,
  origin: SourceOrigin,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS,
): OpenApiSourceDocument {
  const outcome = parseDocument(source, limits);
  if (!outcome.ok) {
    switch (outcome.failure.kind) {
      case "invalid-limits":
        throw new OpenApiIngestionError(
          "LIMIT_EXCEEDED",
          "Ingestion limits must be positive safe integers.",
        );
      case "limit":
        throw new OpenApiIngestionError(
          "LIMIT_EXCEEDED",
          `Source exceeds the configured ${outcome.failure.budget} ingestion limit.`,
        );
      case "not-object":
        throw new OpenApiIngestionError(
          "INVALID_DOCUMENT",
          "OpenAPI source must be an object.",
        );
      case "non-finite":
        throw new OpenApiIngestionError(
          "INVALID_DOCUMENT",
          "Document contains a non-finite numeric value.",
        );
      case "syntax":
      case "encoding":
        throw new OpenApiIngestionError(
          "INVALID_DOCUMENT",
          "Source is not valid JSON or YAML.",
        );
    }
  }
  const openapiVersion = detectOpenApiVersion(outcome.value);
  if (openapiVersion === undefined) {
    throw new OpenApiIngestionError(
      "UNSUPPORTED_VERSION",
      "Only explicit OpenAPI 3.0.x and 3.1.x documents are accepted.",
    );
  }
  return Object.freeze({
    document: outcome.value,
    format: "openapi",
    openapiVersion,
    origin: Object.freeze({ ...origin }),
  });
}

export type OpenApiDialect = "oas30" | "oas31";

export function detectOpenApiVersion(
  document: Readonly<Record<string, unknown>>,
): string | undefined {
  const version = document.openapi;
  return typeof version === "string" && /^3\.(?:0|1)\.\d+$/.test(version)
    ? version
    : undefined;
}

export function dialectOf(openapiVersion: string): OpenApiDialect {
  return openapiVersion.startsWith("3.1.") ? "oas31" : "oas30";
}

function enforceStructuralLimits(
  root: Readonly<Record<string, unknown>>,
  limits: ParseLimits,
):
  | { readonly ok: true; readonly nodes: number }
  | { readonly ok: false; readonly failure: ParseFailure } {
  const stack: { readonly depth: number; readonly value: unknown }[] = [
    { depth: 0, value: root },
  ];
  const visited = new WeakSet<object>();
  let nodeCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const { depth, value } = current;
    if (depth > limits.maxDepth) {
      return { failure: { budget: "depth", kind: "limit" }, ok: false };
    }
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > limits.maxStringBytes) {
        return { failure: { budget: "string", kind: "limit" }, ok: false };
      }
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return { failure: { kind: "non-finite" }, ok: false };
      }
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    if (visited.has(value)) continue;
    visited.add(value);
    Object.freeze(value);
    const children = Array.isArray(value) ? value : Object.values(value);
    nodeCount += children.length;
    if (nodeCount > limits.maxNodes) {
      return { failure: { budget: "nodes", kind: "limit" }, ok: false };
    }
    for (const child of children)
      stack.push({ depth: depth + 1, value: child });
  }
  return { nodes: nodeCount, ok: true };
}

export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
