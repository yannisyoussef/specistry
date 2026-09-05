import {
  isScalar,
  parseDocument as parseYamlDocument,
  visit,
  type Document,
} from "yaml";

import {
  DEFAULT_PARSE_LIMITS,
  areLimitsValid,
  type ParseLimits,
} from "./limits.js";

export type ParseFailure =
  | { readonly kind: "invalid-limits" }
  | {
      readonly kind: "limit";
      readonly budget: "bytes" | "depth" | "nodes" | "string";
    }
  | { readonly kind: "not-object" }
  | { readonly kind: "syntax" }
  | { readonly kind: "non-finite" };

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
  // Nesting is bounded before the recursive composer runs so pathological
  // depth is a diagnostic rather than a stack or heap exhaustion.
  if (exceedsNestingPrecheck(source, limits.maxDepth)) {
    return { failure: { budget: "depth", kind: "limit" }, ok: false };
  }
  let parsed: unknown;
  try {
    const document = parseYamlDocument(source, {
      logLevel: "silent",
      prettyErrors: false,
      strict: true,
      // The parser's own duplicate check scans every existing key per
      // insertion (quadratic in mapping width); `hasUniquePlainKeys` below is
      // the linear equivalent.
      uniqueKeys: false,
    });
    // Unknown or non-JSON tags (!!binary, !!timestamp, !!set, custom tags)
    // surface as warnings; the adapter accepts only plain JSON-compatible data.
    if (document.errors.length > 0 || document.warnings.length > 0) {
      return { failure: { kind: "syntax" }, ok: false };
    }
    if (!hasUniquePlainKeys(document)) {
      return { failure: { kind: "syntax" }, ok: false };
    }
    parsed = document.toJS({ maxAliasCount: 0 });
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

/**
 * Rejects duplicate or non-scalar mapping keys in one linear pass. Keys are
 * compared by their JavaScript property name, so `1` and `"1"` collide just as
 * they would in the parsed object.
 */
function hasUniquePlainKeys(document: Document): boolean {
  let unique = true;
  visit(document, {
    Map(_key, map) {
      const seen = new Set<string>();
      for (const pair of map.items) {
        if (!isScalar(pair.key)) {
          unique = false;
          return visit.BREAK;
        }
        const name = String(pair.key.value);
        if (seen.has(name)) {
          unique = false;
          return visit.BREAK;
        }
        seen.add(name);
      }
      return undefined;
    },
  });
  return unique;
}

/**
 * Cheap O(n) guard against pathological nesting: a run of flow-collection
 * openers longer than the depth budget, or a line indented more than eight
 * times the budget, cannot describe a document within the budget.
 */
function exceedsNestingPrecheck(source: string, maxDepth: number): boolean {
  let run = 0;
  let indent = 0;
  let atLineStart = true;
  const maxIndent = maxDepth * 8;
  for (let index = 0; index < source.length; index += 1) {
    const character = source.charCodeAt(index);
    if (character === 0x0a) {
      atLineStart = true;
      indent = 0;
      continue;
    }
    if (atLineStart) {
      if (character === 0x20 || character === 0x09) {
        indent += 1;
        if (indent > maxIndent) return true;
        continue;
      }
      atLineStart = false;
    }
    if (character === 0x5b || character === 0x7b) {
      run += 1;
      if (run > maxDepth) return true;
    } else if (character !== 0x20 && character !== 0x09 && character !== 0x0d) {
      run = 0;
    }
  }
  return false;
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
    // Only plain objects and arrays are JSON data; typed arrays, dates, sets,
    // and other instances cannot be represented and are rejected outright.
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (
      (Array.isArray(value) && prototype !== Array.prototype) ||
      (!Array.isArray(value) &&
        prototype !== Object.prototype &&
        prototype !== null)
    ) {
      return { failure: { kind: "syntax" }, ok: false };
    }
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
