import type {
  ApiService,
  SchemaNode,
  ServiceId,
  TagDefinition,
} from "@specistry/model";

import type { DiagnosticSink, SourceLocation } from "../diagnostics.js";
import type { DocumentGraph } from "../documents.js";
import { compareText } from "../identity.js";
import type { IngestionLimits } from "../limits.js";
import { isRecord } from "../parse.js";
import { joinPointer, parsePointer, resolvePointer } from "../pointer.js";
import { NormalizeContext, child, optionalString } from "./context.js";
import { normalizePaths } from "./operations.js";
import { definitionName, normalizeSchema } from "./schema.js";
import { normalizeSecuritySchemes } from "./security.js";
import { normalizeServers } from "./servers.js";

const DEFAULT_DIALECT_URI = "https://json-schema.org/draft/2020-12/schema";
const ROOT_KEYS = new Set([
  "components",
  "externalDocs",
  "info",
  "jsonSchemaDialect",
  "openapi",
  "paths",
  "security",
  "servers",
  "tags",
  "webhooks",
]);

export interface ServiceNormalization {
  readonly service: ApiService;
  readonly context: NormalizeContext;
}

/** Normalizes one loaded OpenAPI document graph into a canonical service. */
export function normalizeService(
  graph: DocumentGraph,
  limits: IngestionLimits,
  sink: DiagnosticSink,
  serviceId: ServiceId,
): ServiceNormalization {
  const ctx = new NormalizeContext(graph, limits, sink, serviceId);
  const root = graph.root.document;
  const source: SourceLocation = { document: graph.root.id, pointer: "" };

  for (const key of Object.keys(root)) {
    if (!ROOT_KEYS.has(key) && !key.startsWith("x-"))
      ctx.partial(child(source, key));
  }
  const info = isRecord(root.info) ? root.info : undefined;
  const infoSource = child(source, "info");
  let name = "";
  if (
    info === undefined ||
    typeof info.title !== "string" ||
    info.title.trim().length === 0
  ) {
    ctx.invalid(infoSource);
  } else {
    name = info.title;
  }
  const description =
    info === undefined
      ? undefined
      : optionalString(info, "description", infoSource, ctx);
  if (
    ctx.dialect === "oas31" &&
    root.jsonSchemaDialect !== undefined &&
    root.jsonSchemaDialect !== DEFAULT_DIALECT_URI
  ) {
    ctx.unsupported(child(source, "jsonSchemaDialect"));
  }
  if (root.webhooks !== undefined) ctx.unsupported(child(source, "webhooks"));

  const rootServerIds =
    root.servers === undefined
      ? []
      : normalizeServers(ctx, root.servers, child(source, "servers"));
  const components = isRecord(root.components) ? root.components : undefined;
  if (root.components !== undefined && components === undefined)
    ctx.invalid(child(source, "components"));
  const catalog = normalizeSecuritySchemes(
    ctx,
    components?.securitySchemes,
    child(source, "components", "securitySchemes"),
  );

  if (components?.schemas !== undefined) {
    if (!isRecord(components.schemas)) {
      ctx.invalid(child(source, "components", "schemas"));
    } else {
      for (const key of Object.keys(components.schemas).sort(compareText)) {
        ctx.registerSchema({
          document: graph.root.id,
          pointer: joinPointer("", "components", "schemas", key),
        });
      }
    }
  }
  if (components !== undefined) {
    for (const key of ["callbacks", "links", "pathItems"] as const) {
      if (components[key] !== undefined)
        ctx.unsupported(child(source, "components", key));
    }
  }

  const tags = normalizeTagDefinitions(ctx, root.tags, child(source, "tags"));
  const operations = normalizePaths(ctx, root.paths, child(source, "paths"), {
    catalog,
    rootSecurity: root.security,
    rootSecuritySource: child(source, "security"),
    rootServerIds,
  });
  if (root.paths === undefined && ctx.dialect === "oas30")
    ctx.invalid(child(source, "paths"));

  drainSchemaQueue(ctx);

  const schemas: Record<string, SchemaNode> = {};
  for (const [id, node] of ctx.registry) schemas[id] = node;
  const service: ApiService = {
    ...(description === undefined ? {} : { description }),
    extensions: ctx.extensions(root, source),
    id: serviceId,
    name,
    operations,
    schemas,
    securitySchemes: catalog.schemes,
    servers: ctx.serverList(),
    ...(tags.length === 0 ? {} : { tags }),
  };
  return { context: ctx, service };
}

/**
 * Root `tags`: declaration order and descriptions become the service's tag
 * definitions. Entries without a valid name are invalid; a repeated name is
 * partially represented (the first declaration wins) so grouping stays stable.
 */
function normalizeTagDefinitions(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
): readonly TagDefinition[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    ctx.invalid(source);
    return [];
  }
  const tags: TagDefinition[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    const entrySource = child(source, String(index));
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      entry.name.length === 0
    ) {
      ctx.invalid(entrySource);
      return;
    }
    if (seen.has(entry.name)) {
      ctx.partial(entrySource);
      return;
    }
    seen.add(entry.name);
    const description =
      typeof entry.description === "string" && entry.description.length > 0
        ? entry.description
        : undefined;
    if (
      entry.description !== undefined &&
      typeof entry.description !== "string"
    ) {
      ctx.invalid(child(entrySource, "description"));
    }
    tags.push({
      name: entry.name,
      ...(description === undefined ? {} : { description }),
    });
  });
  return tags;
}

/** Projects every registered schema location exactly once, iteratively. */
function drainSchemaQueue(ctx: NormalizeContext): void {
  for (;;) {
    const pending = ctx.nextPendingSchema();
    if (pending === undefined) return;
    const document = ctx.graph.documents.get(pending.location.document);
    const segments = parsePointer(pending.location.pointer);
    const lookup =
      document === undefined || segments === undefined
        ? { found: false as const }
        : resolvePointer(document.document, segments);
    const node = lookup.found
      ? normalizeSchema(ctx, lookup.value, pending.location, {
          path: "",
          schemaId: pending.schemaId,
          serviceId: ctx.serviceId,
        })
      : normalizeSchema(ctx, undefined, pending.location, {
          path: "",
          schemaId: pending.schemaId,
          serviceId: ctx.serviceId,
        });
    const name = definitionName(pending.location);
    ctx.registry.set(
      pending.schemaId,
      name === undefined || node.name !== undefined ? node : { ...node, name },
    );
  }
}
