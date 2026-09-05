import { createHash } from "node:crypto";

import type { SourceAcquisition } from "./acquisition.js";
import type { DiagnosticSink, SourceLocation } from "./diagnostics.js";
import type { IngestionLimits } from "./limits.js";
import {
  decodeSource,
  detectOpenApiVersion,
  dialectOf,
  isRecord,
  parseDocument,
  type OpenApiDialect,
} from "./parse.js";
import { joinPointer, parsePointer, resolvePointer } from "./pointer.js";
import {
  classifyReference,
  resolveDocumentId,
  splitReference,
} from "./references.js";

export interface ParsedDocument {
  readonly id: string;
  readonly document: Readonly<Record<string, unknown>>;
  readonly bytes: number;
  readonly sha256: string;
  readonly nodes: number;
}

export interface DocumentGraph {
  readonly root: ParsedDocument;
  readonly openapiVersion: string;
  readonly dialect: OpenApiDialect;
  readonly documents: ReadonlyMap<string, ParsedDocument>;
  /** Documents that could not be acquired or parsed, with the diagnostic already recorded. */
  readonly failures: ReadonlyMap<string, ReferenceFailureCode>;
  readonly referenceCount: number;
}

export type ReferenceFailureCode =
  | "SOURCE_LIMIT_EXCEEDED"
  | "SOURCE_PARSE_FAILED"
  | "SOURCE_REFERENCE_INVALID"
  | "SOURCE_REFERENCE_OUTSIDE_ROOT"
  | "SOURCE_REFERENCE_UNRESOLVED";

export interface LoadOptions {
  readonly signal?: AbortSignal;
}

/**
 * Acquires and parses the root document plus every document reachable through
 * document references, breadth-first and in deterministic (sorted) order.
 * Remote references are diagnosed, never fetched; escaping references are
 * diagnosed and skipped. Every acquisition goes through the single port.
 */
export async function loadDocumentGraph(
  acquisition: SourceAcquisition,
  limits: IngestionLimits,
  diagnostics: DiagnosticSink,
  options: LoadOptions = {},
): Promise<DocumentGraph | undefined> {
  const documents = new Map<string, ParsedDocument>();
  const failures = new Map<string, ReferenceFailureCode>();
  let totalBytes = 0;
  let referenceCount = 0;

  const root = await acquireAndParse(acquisition.entry, {
    document: acquisition.entry,
    pointer: "",
  });
  if (root === undefined) return undefined;
  const openapiVersion = detectOpenApiVersion(root.document);
  if (openapiVersion === undefined) {
    diagnostics.add("SOURCE_UNSUPPORTED_VERSION", {
      document: root.id,
      pointer: joinPointer("", "openapi"),
    });
    return undefined;
  }

  const queue: ParsedDocument[] = [root];
  while (queue.length > 0) {
    if (options.signal?.aborted === true) return undefined;
    const current = queue.shift();
    if (current === undefined) break;
    const targets = new Map<string, SourceLocation>();
    for (const [pointer, reference] of collectReferences(current.document)) {
      referenceCount += 1;
      if (referenceCount > limits.maxReferences) {
        diagnostics.add("SOURCE_LIMIT_EXCEEDED", {
          document: current.id,
          pointer,
        });
        return undefined;
      }
      const location = { document: current.id, pointer };
      const kind = classifyReference(reference);
      if (kind === "fragment") continue;
      if (kind === "remote") {
        diagnostics.add("SOURCE_REFERENCE_REMOTE_DISABLED", location);
        continue;
      }
      if (kind === "unsupported") {
        diagnostics.add("SOURCE_REFERENCE_UNSUPPORTED", location);
        continue;
      }
      const split = splitReference(reference);
      if (split === undefined) {
        diagnostics.add("SOURCE_REFERENCE_UNSUPPORTED", location);
        continue;
      }
      const resolved = resolveDocumentId(current.id, split.location);
      if (!resolved.ok) {
        diagnostics.add(
          resolved.reason === "outside"
            ? "SOURCE_REFERENCE_OUTSIDE_ROOT"
            : "SOURCE_REFERENCE_UNSUPPORTED",
          location,
        );
        continue;
      }
      if (
        documents.has(resolved.id) ||
        failures.has(resolved.id) ||
        resolved.id === current.id
      ) {
        continue;
      }
      if (!targets.has(resolved.id)) targets.set(resolved.id, location);
    }
    for (const [id, location] of [...targets.entries()].sort(
      ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
    )) {
      if (documents.has(id)) continue;
      if (documents.size >= limits.maxDocuments) {
        diagnostics.add("SOURCE_LIMIT_EXCEEDED", location);
        return undefined;
      }
      const parsed = await acquireAndParse(id, location);
      if (parsed !== undefined) queue.push(parsed);
    }
  }

  return {
    dialect: dialectOf(openapiVersion),
    documents,
    failures,
    openapiVersion,
    referenceCount,
    root,
  };

  async function acquireAndParse(
    id: string,
    referencedFrom: SourceLocation,
  ): Promise<ParsedDocument | undefined> {
    const acquired = await acquisition.acquire(id, limits.maxBytes);
    if (!acquired.ok) {
      const code: ReferenceFailureCode =
        acquired.reason === "missing"
          ? "SOURCE_REFERENCE_UNRESOLVED"
          : acquired.reason === "outside"
            ? "SOURCE_REFERENCE_OUTSIDE_ROOT"
            : acquired.reason === "too-large"
              ? "SOURCE_LIMIT_EXCEEDED"
              : "SOURCE_REFERENCE_INVALID";
      diagnostics.add(code, referencedFrom);
      failures.set(id, code);
      return undefined;
    }
    if (
      acquired.source.canonicalId !== undefined &&
      acquired.source.canonicalId !== id
    ) {
      // The filesystem resolved a differently spelled file (case folding,
      // normalization); behave as a case-sensitive host would.
      diagnostics.add("SOURCE_REFERENCE_UNRESOLVED", referencedFrom);
      failures.set(id, "SOURCE_REFERENCE_UNRESOLVED");
      return undefined;
    }
    const bytes = acquired.source.bytes;
    totalBytes += bytes.byteLength;
    if (
      bytes.byteLength > limits.maxBytes ||
      totalBytes > limits.maxTotalBytes
    ) {
      diagnostics.add("SOURCE_LIMIT_EXCEEDED", referencedFrom);
      failures.set(id, "SOURCE_LIMIT_EXCEEDED");
      return undefined;
    }
    const text = decodeSource(bytes);
    if (text === undefined) {
      diagnostics.add("SOURCE_PARSE_FAILED", { document: id, pointer: "" });
      failures.set(id, "SOURCE_PARSE_FAILED");
      return undefined;
    }
    const outcome = parseDocument(text, limits);
    if (!outcome.ok) {
      const code: ReferenceFailureCode =
        outcome.failure.kind === "limit"
          ? "SOURCE_LIMIT_EXCEEDED"
          : "SOURCE_PARSE_FAILED";
      diagnostics.add(code, { document: id, pointer: "" });
      failures.set(id, code);
      return undefined;
    }
    const parsed: ParsedDocument = {
      bytes: bytes.byteLength,
      document: outcome.value,
      id,
      nodes: outcome.nodes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    documents.set(id, parsed);
    return parsed;
  }
}

/** Keys whose values are user-named maps of OpenAPI objects. */
const MAP_KEYS = new Set([
  "$defs",
  "callbacks",
  "content",
  "definitions",
  "encoding",
  "headers",
  "links",
  "mapping",
  "parameters",
  "pathItems",
  "paths",
  "patternProperties",
  "properties",
  "requestBodies",
  "responses",
  "schemas",
  "securitySchemes",
  "variables",
]);
/** Keys whose values are opaque JSON data, never Reference Objects. */
const DATA_KEYS = new Set(["const", "default", "enum", "example"]);

type WalkMode = "example" | "map" | "structural";

/**
 * Every `$ref` string in Reference Object or Schema Object position, with its
 * pointer, in traversal order. Data-bearing values (examples, defaults, enum
 * and const values, extensions) are opaque and never treated as references.
 */
export function collectReferences(
  document: Readonly<Record<string, unknown>>,
): readonly (readonly [string, string])[] {
  const found: (readonly [string, string])[] = [];
  const stack: {
    readonly mode: WalkMode;
    readonly pointer: string;
    readonly value: unknown;
  }[] = [{ mode: "structural", pointer: "", value: document }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const { mode, pointer, value } = current;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({
          mode: "structural",
          pointer: `${pointer}/${index}`,
          value: value[index],
        });
      }
      continue;
    }
    if (!isRecord(value)) continue;
    if (typeof value.$ref === "string") {
      found.push([joinPointer(pointer, "$ref"), value.$ref]);
    }
    if (mode === "example") continue;
    const keys = Object.keys(value);
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index];
      if (key === undefined) continue;
      const child = value[key];
      const childPointer = joinPointer(pointer, key);
      if (mode === "map") {
        stack.push({ mode: "structural", pointer: childPointer, value: child });
        continue;
      }
      if (key.startsWith("x-") || DATA_KEYS.has(key)) continue;
      if (key === "examples") {
        // A schema `examples` list is data; a media/parameter `examples` map
        // holds Example Objects that may themselves be references.
        if (isRecord(child)) {
          for (const name of Object.keys(child)) {
            stack.push({
              mode: "example",
              pointer: joinPointer(childPointer, name),
              value: child[name],
            });
          }
        }
        continue;
      }
      stack.push({
        mode: MAP_KEYS.has(key) && isRecord(child) ? "map" : "structural",
        pointer: childPointer,
        value: child,
      });
    }
  }
  return found;
}

export type ReferenceResolution =
  | {
      readonly ok: true;
      readonly location: SourceLocation;
      readonly value: unknown;
    }
  | {
      readonly ok: false;
      readonly code:
        | ReferenceFailureCode
        | "SOURCE_REFERENCE_REMOTE_DISABLED"
        | "SOURCE_REFERENCE_UNSUPPORTED";
    };

/** Resolves one reference string against the loaded graph without I/O. */
export function resolveReference(
  graph: DocumentGraph,
  from: SourceLocation,
  reference: string,
): ReferenceResolution {
  const kind = classifyReference(reference);
  if (kind === "remote") {
    return { code: "SOURCE_REFERENCE_REMOTE_DISABLED", ok: false };
  }
  if (kind === "unsupported") {
    return { code: "SOURCE_REFERENCE_UNSUPPORTED", ok: false };
  }
  const split = splitReference(reference);
  if (split === undefined) {
    return { code: "SOURCE_REFERENCE_UNSUPPORTED", ok: false };
  }
  let documentId = from.document;
  if (split.location.length > 0) {
    const resolved = resolveDocumentId(from.document, split.location);
    if (!resolved.ok) {
      return {
        code:
          resolved.reason === "outside"
            ? "SOURCE_REFERENCE_OUTSIDE_ROOT"
            : "SOURCE_REFERENCE_UNSUPPORTED",
        ok: false,
      };
    }
    documentId = resolved.id;
  }
  const target = graph.documents.get(documentId);
  if (target === undefined) {
    return {
      code: graph.failures.get(documentId) ?? "SOURCE_REFERENCE_UNRESOLVED",
      ok: false,
    };
  }
  const fragment = split.fragment ?? "";
  const segments = parsePointer(fragment);
  if (segments === undefined) {
    return { code: "SOURCE_REFERENCE_UNSUPPORTED", ok: false };
  }
  const lookup = resolvePointer(target.document, segments);
  if (!lookup.found) {
    return { code: "SOURCE_REFERENCE_UNRESOLVED", ok: false };
  }
  return {
    location: { document: documentId, pointer: fragment },
    ok: true,
    value: lookup.value,
  };
}
