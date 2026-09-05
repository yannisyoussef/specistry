import {
  createDiagnostic,
  createSchemaId,
  type CanonicalDiagnostic,
  type DiagnosticCode,
  type DiagnosticId,
  type DiagnosticLocation,
  type JsonObject,
  type JsonValue,
  type OperationId,
  type SchemaId,
  type SchemaNode,
  type ServerDefinition,
  type ServerId,
  type ServiceId,
} from "@specra/model";

import type { DiagnosticSink, SourceLocation } from "../diagnostics.js";
import { resolveReference, type DocumentGraph } from "../documents.js";
import { IdentityLedger, canonicalSlug } from "../identity.js";
import type { IngestionLimits } from "../limits.js";
import { isRecord, type OpenApiDialect } from "../parse.js";

/**
 * Where a capability diagnostic is anchored inside the canonical artifact.
 * Registry schemas anchor on their `schemaId`; operation-inline structures
 * anchor on the `operationId`. `path` is relative to that anchor and uses
 * stable keys (media types, parameter names, status keys) rather than array
 * indices, so identities survive canonical re-ordering.
 */
export interface CanonicalAnchor {
  readonly serviceId: ServiceId;
  readonly operationId?: OperationId;
  readonly schemaId?: SchemaId;
  readonly path: string;
}

export type CapabilityCode = Extract<
  DiagnosticCode,
  | "SCHEMA_IGNORED_ANNOTATION"
  | "SCHEMA_INVALID_SEMANTIC"
  | "SCHEMA_PARTIALLY_REPRESENTED"
  | "SCHEMA_UNRESOLVED_REFERENCE"
  | "SCHEMA_UNSUPPORTED_SEMANTIC"
>;

interface PendingSchema {
  readonly schemaId: SchemaId;
  readonly location: SourceLocation;
}

interface ServerRecord {
  readonly id: ServerId;
  readonly definition: ServerDefinition;
}

export class NormalizeContext {
  public readonly graph: DocumentGraph;
  public readonly dialect: OpenApiDialect;
  public readonly limits: IngestionLimits;
  public readonly sink: DiagnosticSink;
  public readonly serviceId: ServiceId;
  public readonly ledger = new IdentityLedger();
  public readonly canonicalDiagnostics = new Map<
    DiagnosticId,
    CanonicalDiagnostic
  >();
  public readonly registry = new Map<SchemaId, SchemaNode>();
  public readonly servers = new Map<string, ServerRecord>();
  public exampleBytes = 0;
  public operationCount = 0;
  #exampleBudgetReported = false;
  readonly #schemaIds = new Map<string, SchemaId>();
  readonly #pending: PendingSchema[] = [];

  public constructor(
    graph: DocumentGraph,
    limits: IngestionLimits,
    sink: DiagnosticSink,
    serviceId: ServiceId,
  ) {
    this.graph = graph;
    this.dialect = graph.dialect;
    this.limits = limits;
    this.sink = sink;
    this.serviceId = serviceId;
  }

  /** Records a capability diagnostic and its source mirror; returns its ID. */
  public capability(
    code: CapabilityCode,
    source: SourceLocation,
    anchor: CanonicalAnchor,
  ): DiagnosticId {
    const location: DiagnosticLocation = {
      serviceId: anchor.serviceId,
      ...(anchor.operationId === undefined
        ? {}
        : { operationId: anchor.operationId }),
      ...(anchor.schemaId === undefined ? {} : { schemaId: anchor.schemaId }),
      ...(anchor.path === "" ? {} : { path: anchor.path }),
    };
    const diagnostic = createDiagnostic({ code, location });
    this.canonicalDiagnostics.set(diagnostic.id, diagnostic);
    switch (code) {
      case "SCHEMA_UNSUPPORTED_SEMANTIC":
        this.sink.add("SOURCE_UNSUPPORTED_SEMANTIC", source, diagnostic.id);
        break;
      case "SCHEMA_PARTIALLY_REPRESENTED":
        this.sink.add("SOURCE_PARTIALLY_REPRESENTED", source, diagnostic.id);
        break;
      case "SCHEMA_INVALID_SEMANTIC":
        this.sink.add("SOURCE_INVALID", source, diagnostic.id);
        break;
      case "SCHEMA_IGNORED_ANNOTATION":
      case "SCHEMA_UNRESOLVED_REFERENCE":
        break;
    }
    return diagnostic.id;
  }

  public invalid(source: SourceLocation): void {
    this.sink.add("SOURCE_INVALID", source);
  }

  public unsupported(source: SourceLocation): void {
    this.sink.add("SOURCE_UNSUPPORTED_SEMANTIC", source);
  }

  public partial(source: SourceLocation): void {
    this.sink.add("SOURCE_PARTIALLY_REPRESENTED", source);
  }

  /** Ensures a registry identity for a source location; queues its projection. */
  public registerSchema(location: SourceLocation): SchemaId {
    const key = `${location.document}#${location.pointer}`;
    const existing = this.#schemaIds.get(key);
    if (existing !== undefined) return existing;
    const schemaId = createSchemaId(location.document, location.pointer);
    this.#schemaIds.set(key, schemaId);
    this.#pending.push({ location, schemaId });
    return schemaId;
  }

  public nextPendingSchema(): PendingSchema | undefined {
    return this.#pending.shift();
  }

  /** Registered `document#pointer` keys with their schema identities. */
  public schemaLocations(): Iterable<readonly [string, SchemaId]> {
    return this.#schemaIds.entries();
  }

  /** Follows a `$ref` string from `source` to its target value and location. */
  public resolve(
    source: SourceLocation,
    reference: string,
  ):
    { readonly location: SourceLocation; readonly value: unknown } | undefined {
    const resolution = resolveReference(this.graph, source, reference);
    if (!resolution.ok) {
      this.sink.add(resolution.code, source);
      return undefined;
    }
    return { location: resolution.location, value: resolution.value };
  }

  /**
   * Dereferences a Reference Object (`{ $ref }`) chain. Non-reference values
   * are returned unchanged. Cycles and over-long chains are invalid.
   */
  public dereference(
    value: unknown,
    source: SourceLocation,
  ):
    { readonly location: SourceLocation; readonly value: unknown } | undefined {
    let current = value;
    let location = source;
    const visited = new Set<string>();
    for (let hop = 0; hop < 32; hop += 1) {
      if (!isRecord(current) || typeof current.$ref !== "string") {
        return { location, value: current };
      }
      const key = `${location.document}#${location.pointer}`;
      if (visited.has(key)) {
        this.sink.add("SOURCE_REFERENCE_INVALID", location);
        return undefined;
      }
      visited.add(key);
      const refLocation = {
        document: location.document,
        pointer: `${location.pointer}/$ref`,
      };
      const resolved = this.resolve(refLocation, current.$ref);
      if (resolved === undefined) return undefined;
      current = resolved.value;
      location = resolved.location;
    }
    this.sink.add("SOURCE_REFERENCE_INVALID", source);
    return undefined;
  }

  /**
   * Converts parsed data to a canonical JSON value, rejecting negative zero
   * and non-finite numbers, and charging serialized bytes to the example
   * budget when requested.
   */
  public toJsonValue(
    value: unknown,
    source: SourceLocation,
    budgeted = false,
  ): JsonValue | undefined {
    const converted = convertJson(value);
    if (converted === undefined) {
      this.invalid(source);
      return undefined;
    }
    if (budgeted) {
      this.exampleBytes += JSON.stringify(converted).length;
      if (this.exampleBytes > this.limits.maxExampleBytes) {
        if (!this.#exampleBudgetReported) {
          this.#exampleBudgetReported = true;
          this.sink.add("SOURCE_LIMIT_EXCEEDED", source);
        }
        return undefined;
      }
    }
    return converted;
  }

  public extensions(
    record: Readonly<Record<string, unknown>>,
    source: SourceLocation,
  ): JsonObject {
    const extensions: Record<string, JsonValue> = {};
    for (const key of Object.keys(record)) {
      if (!key.startsWith("x-")) continue;
      const converted = this.toJsonValue(record[key], {
        document: source.document,
        pointer: `${source.pointer}/${escapeKey(key)}`,
      });
      if (converted !== undefined) extensions[key] = converted;
    }
    return extensions;
  }

  public serverIdsFor(records: readonly ServerRecord[]): readonly ServerId[] {
    return records.map((record) => record.id);
  }

  public serverList(): readonly ServerDefinition[] {
    return [...this.servers.values()].map((record) => record.definition);
  }

  public slug(kind: string, value: string): string {
    return canonicalSlug(kind, value);
  }
}

export function convertJson(value: unknown): JsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0) ? value : undefined;
  }
  if (Array.isArray(value)) {
    const items: JsonValue[] = [];
    for (const item of value) {
      const converted = convertJson(item);
      if (converted === undefined) return undefined;
      items.push(converted);
    }
    return items;
  }
  if (isRecord(value)) {
    const record: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const converted = convertJson(item);
      if (converted === undefined) return undefined;
      record[key] = converted;
    }
    return record;
  }
  return undefined;
}

export function escapeKey(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function child(
  source: SourceLocation,
  ...keys: readonly string[]
): SourceLocation {
  return {
    document: source.document,
    pointer: keys.reduce(
      (pointer, key) => `${pointer}/${escapeKey(key)}`,
      source.pointer,
    ),
  };
}

export function anchorChild(
  anchor: CanonicalAnchor,
  ...keys: readonly string[]
): CanonicalAnchor {
  return {
    ...anchor,
    path: keys.reduce(
      (pointer, key) => `${pointer}/${escapeKey(key)}`,
      anchor.path,
    ),
  };
}

export function optionalString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  source: SourceLocation,
  ctx: NormalizeContext,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    ctx.invalid(child(source, key));
    return undefined;
  }
  return value;
}

export function optionalBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
  source: SourceLocation,
  ctx: NormalizeContext,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    ctx.invalid(child(source, key));
    return undefined;
  }
  return value;
}
