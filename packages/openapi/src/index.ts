import { parse } from "yaml";

export const DEFAULT_INGESTION_LIMITS: IngestionLimits = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxDepth: 100,
  maxNodes: 200_000,
  maxStringBytes: 1 * 1024 * 1024,
});

export interface IngestionLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  /** Aggregate object properties plus array entries after parsing. */
  readonly maxNodes: number;
  readonly maxStringBytes: number;
}

export interface SourceOrigin {
  readonly id: string;
  readonly kind: "file" | "memory";
}

export interface RemoteReferencePolicy {
  /** Exact HTTPS origins, including a non-default port when applicable. */
  readonly allowedOrigins: readonly string[];
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

export function parseOpenApiSource(
  source: string,
  origin: SourceOrigin,
  limits: IngestionLimits = DEFAULT_INGESTION_LIMITS,
): OpenApiSourceDocument {
  assertValidLimits(limits);
  if (Buffer.byteLength(source, "utf8") > limits.maxBytes) {
    throw new OpenApiIngestionError(
      "LIMIT_EXCEEDED",
      `Source exceeds the ${limits.maxBytes} byte ingestion limit.`,
    );
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
    throw new OpenApiIngestionError(
      "INVALID_DOCUMENT",
      "Source is not valid JSON or YAML.",
    );
  }

  if (!isRecord(parsed)) {
    throw new OpenApiIngestionError(
      "INVALID_DOCUMENT",
      "OpenAPI source must be an object.",
    );
  }

  enforceStructuralLimits(parsed, limits);
  const openapiVersion = parsed.openapi;
  if (
    typeof openapiVersion !== "string" ||
    !/^3\.(?:0|1)\.\d+$/.test(openapiVersion)
  ) {
    throw new OpenApiIngestionError(
      "UNSUPPORTED_VERSION",
      "Only explicit OpenAPI 3.0.x and 3.1.x documents are accepted.",
    );
  }

  return Object.freeze({
    document: parsed,
    format: "openapi",
    openapiVersion,
    origin: Object.freeze({ ...origin }),
  });
}

export type ReferenceKind = "document" | "fragment" | "remote" | "unsupported";

export function classifyReference(reference: string): ReferenceKind {
  if (reference.startsWith("#")) return "fragment";
  if (reference.startsWith("//")) return "unsupported";
  try {
    const url = new URL(reference);
    if (url.protocol === "http:" || url.protocol === "https:") return "remote";
    return "unsupported";
  } catch {
    // A relative path is a document reference, not a remotely fetchable URL.
  }
  return "document";
}

export function assertReferenceAllowed(
  reference: string,
  policy?: RemoteReferencePolicy,
): void {
  const kind = classifyReference(reference);
  if (kind === "unsupported") {
    throw new OpenApiIngestionError(
      "UNSUPPORTED_REFERENCE_SCHEME",
      "OpenAPI reference uses an unsupported URL scheme.",
    );
  }
  if (kind === "remote") {
    const url = new URL(reference);
    const allowed =
      policy !== undefined &&
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      policy.allowedOrigins.some((candidate) =>
        isExactHttpsOrigin(candidate, url.origin),
      );
    if (!allowed) {
      throw new OpenApiIngestionError(
        "REMOTE_REFERENCE_DENIED",
        "Remote OpenAPI reference is not permitted by the exact HTTPS origin policy.",
      );
    }
  }
}

function enforceStructuralLimits(
  root: Readonly<Record<string, unknown>>,
  limits: IngestionLimits,
): void {
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
      throw new OpenApiIngestionError(
        "LIMIT_EXCEEDED",
        "Document nesting depth limit exceeded.",
      );
    }
    if (
      typeof value === "string" &&
      Buffer.byteLength(value, "utf8") > limits.maxStringBytes
    ) {
      throw new OpenApiIngestionError(
        "LIMIT_EXCEEDED",
        "Document contains an oversized string.",
      );
    }
    if (value === null || typeof value !== "object") continue;
    if (visited.has(value)) continue;
    visited.add(value);
    Object.freeze(value);

    const children = Array.isArray(value) ? value : Object.values(value);
    nodeCount += children.length;
    if (nodeCount > limits.maxNodes) {
      throw new OpenApiIngestionError(
        "LIMIT_EXCEEDED",
        "Document node count limit exceeded.",
      );
    }
    for (const child of children) {
      if (typeof child === "number" && !Number.isFinite(child)) {
        throw new OpenApiIngestionError(
          "INVALID_DOCUMENT",
          "Document contains a non-finite numeric value.",
        );
      }
      stack.push({ depth: depth + 1, value: child });
    }
  }
}

function assertValidLimits(limits: IngestionLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new OpenApiIngestionError(
        "LIMIT_EXCEEDED",
        "Ingestion limits must be positive safe integers.",
      );
    }
  }
}

function isExactHttpsOrigin(candidate: string, expected: string): boolean {
  try {
    const parsed = new URL(candidate);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === expected &&
      parsed.href === `${parsed.origin}/`
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
