/**
 * Parse-time limits applied to one source document before and during parsing.
 * They bound allocation as close to the parser as the YAML/JSON boundary
 * allows: bytes are checked before parsing, and depth/node/string budgets are
 * enforced during the single post-parse structural walk that also freezes the
 * parsed data.
 */
export interface ParseLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  /** Aggregate object properties plus array entries after parsing. */
  readonly maxNodes: number;
  readonly maxStringBytes: number;
}

/**
 * Whole-ingestion budgets. Every ceiling is a positive safe integer; the
 * pipeline rejects an invalid configuration before touching any source.
 */
export interface IngestionLimits extends ParseLimits {
  /** Sum of source bytes across every acquired document. */
  readonly maxTotalBytes: number;
  /** Distinct documents (root plus referenced files). */
  readonly maxDocuments: number;
  /** `$ref` occurrences discovered across all documents. */
  readonly maxReferences: number;
  /** Operations across all paths of one document. */
  readonly maxOperations: number;
  /** Aggregate serialized bytes of example and default values. */
  readonly maxExampleBytes: number;
  /** Source diagnostics retained before a sentinel replaces the rest. */
  readonly maxDiagnostics: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxDepth: 100,
  maxNodes: 500_000,
  maxStringBytes: 1 * 1024 * 1024,
});

export const DEFAULT_INGESTION_LIMITS: IngestionLimits = Object.freeze({
  ...DEFAULT_PARSE_LIMITS,
  maxDiagnostics: 10_000,
  maxDocuments: 64,
  maxExampleBytes: 4 * 1024 * 1024,
  maxOperations: 10_000,
  maxReferences: 100_000,
  maxTotalBytes: 20 * 1024 * 1024,
});

export function areLimitsValid(
  limits: Readonly<Record<string, unknown>>,
): boolean {
  return Object.values(limits).every(
    (value) => Number.isSafeInteger(value) && Number(value) >= 1,
  );
}

export function snapshotIngestionLimits(
  value: unknown,
): IngestionLimits | undefined {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(DEFAULT_INGESTION_LIMITS);
  const provided = Object.keys(record);
  if (
    provided.length !== keys.length ||
    provided.some((key) => !keys.includes(key))
  ) {
    return undefined;
  }
  if (!areLimitsValid(record)) return undefined;
  return Object.freeze({
    maxBytes: record.maxBytes as number,
    maxDepth: record.maxDepth as number,
    maxDiagnostics: record.maxDiagnostics as number,
    maxDocuments: record.maxDocuments as number,
    maxExampleBytes: record.maxExampleBytes as number,
    maxNodes: record.maxNodes as number,
    maxOperations: record.maxOperations as number,
    maxReferences: record.maxReferences as number,
    maxStringBytes: record.maxStringBytes as number,
    maxTotalBytes: record.maxTotalBytes as number,
  });
}
