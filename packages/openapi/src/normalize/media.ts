import type {
  Example,
  ExampleId,
  MediaTypeContent,
  MediaTypeEncoding,
  ResponseHeader,
  SchemaNode,
} from "@specra/model";

import type { SourceLocation } from "../diagnostics.js";
import { compareText } from "../identity.js";
import { isRecord } from "../parse.js";
import {
  anchorChild,
  child,
  optionalBoolean,
  optionalString,
  type CanonicalAnchor,
  type NormalizeContext,
} from "./context.js";
import { normalizeSchema } from "./schema.js";

const MEDIA_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export interface ContentOptions {
  readonly allowEncodings: boolean;
}

/** Normalizes a Content map (media type → Media Type Object). */
export function normalizeContent(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  options: ContentOptions,
): readonly MediaTypeContent[] {
  if (raw === undefined) return [];
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return [];
  }
  const content: MediaTypeContent[] = [];
  const seen = new Set<string>();
  for (const mediaType of Object.keys(raw).sort(compareText)) {
    const entrySource = child(source, mediaType);
    const canonical = canonicalMediaKey(mediaType);
    if (canonical === undefined) {
      ctx.invalid(entrySource);
      continue;
    }
    if (seen.has(canonical)) {
      ctx.invalid(entrySource);
      continue;
    }
    seen.add(canonical);
    const media = normalizeMediaType(
      ctx,
      mediaType,
      raw[mediaType],
      entrySource,
      anchorChild(anchor, mediaType),
      options,
    );
    if (media !== undefined) content.push(media);
  }
  return content;
}

function normalizeMediaType(
  ctx: NormalizeContext,
  mediaType: string,
  raw: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  options: ContentOptions,
): MediaTypeContent | undefined {
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return undefined;
  }
  const schema =
    raw.schema === undefined
      ? undefined
      : normalizeSchema(
          ctx,
          raw.schema,
          child(source, "schema"),
          anchorChild(anchor, "schema"),
        );
  const examples = normalizeExamples(ctx, raw, source);
  const encodings =
    raw.encoding === undefined
      ? []
      : options.allowEncodings && isFormLike(mediaType)
        ? normalizeEncodings(
            ctx,
            raw.encoding,
            raw.schema,
            mediaType,
            child(source, "encoding"),
            anchorChild(anchor, "encoding"),
            child(source, "schema"),
          )
        : (ctx.partial(child(source, "encoding")), []);
  return {
    encodings,
    examples,
    mediaType,
    ...(schema === undefined ? {} : { schema }),
  };
}

function isFormLike(mediaType: string): boolean {
  const essence = mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    essence === "application/x-www-form-urlencoded" ||
    essence.startsWith("multipart/")
  );
}

/** Media essence for duplicate detection; parameter values keep their case. */
function canonicalMediaKey(mediaType: string): string | undefined {
  const [essence, ...parameters] = mediaType.split(";");
  const trimmed = essence?.trim() ?? "";
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash !== trimmed.lastIndexOf("/")) return undefined;
  if (
    !MEDIA_TOKEN.test(trimmed.slice(0, slash)) ||
    !MEDIA_TOKEN.test(trimmed.slice(slash + 1))
  ) {
    return undefined;
  }
  const normalizedParameters = parameters
    .map((parameter) => {
      const equals = parameter.indexOf("=");
      if (equals === -1) return undefined;
      return `${parameter.slice(0, equals).trim().toLowerCase()}=${parameter.slice(equals + 1).trim()}`;
    })
    .sort();
  if (normalizedParameters.some((parameter) => parameter === undefined))
    return undefined;
  return `${trimmed.toLowerCase()}${normalizedParameters.map((parameter) => `;${parameter}`).join("")}`;
}

/**
 * Reads `example` and `examples` from a Parameter, Header, or Media Type
 * Object. Example objects may be references into `components/examples`.
 */
export function normalizeExamples(
  ctx: NormalizeContext,
  record: Readonly<Record<string, unknown>>,
  source: SourceLocation,
): readonly Example[] {
  const examples: Example[] = [];
  const claimed = new Set<string>();
  if (record.example !== undefined) {
    const value = ctx.toJsonValue(
      record.example,
      child(source, "example"),
      true,
    );
    if (value !== undefined) {
      examples.push({ id: "example" as ExampleId, name: "example", value });
      claimed.add("example");
    }
  }
  if (record.examples === undefined) return examples;
  if (!isRecord(record.examples)) {
    ctx.invalid(child(source, "examples"));
    return examples;
  }
  for (const name of Object.keys(record.examples).sort(compareText)) {
    const exampleSource = child(source, "examples", name);
    const dereferenced = ctx.dereference(record.examples[name], exampleSource);
    if (dereferenced === undefined) continue;
    const example = dereferenced.value;
    if (!isRecord(example)) {
      ctx.invalid(exampleSource);
      continue;
    }
    if (example.value !== undefined && example.externalValue !== undefined) {
      ctx.invalid(exampleSource);
      continue;
    }
    const id = ctx.slug("example", name);
    if (claimed.has(id)) {
      ctx.sink.add("SOURCE_IDENTITY_COLLISION", exampleSource);
      continue;
    }
    claimed.add(id);
    const summary = optionalString(
      example,
      "summary",
      dereferenced.location,
      ctx,
    );
    const externalValue = optionalString(
      example,
      "externalValue",
      dereferenced.location,
      ctx,
    );
    const value =
      example.value === undefined
        ? undefined
        : ctx.toJsonValue(
            example.value,
            child(dereferenced.location, "value"),
            true,
          );
    examples.push({
      id: id as ExampleId,
      name,
      ...(summary === undefined ? {} : { summary }),
      ...(value === undefined ? {} : { value }),
      ...(externalValue === undefined ? {} : { externalValue }),
    });
  }
  return examples;
}

function normalizeEncodings(
  ctx: NormalizeContext,
  raw: unknown,
  rawSchema: unknown,
  mediaType: string,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  schemaSource: SourceLocation,
): readonly MediaTypeEncoding[] {
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return [];
  }
  const essence = mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const multipart = essence.startsWith("multipart/");
  const encodings: MediaTypeEncoding[] = [];
  for (const propertyName of Object.keys(raw).sort(compareText)) {
    const entrySource = child(source, propertyName);
    const entry = raw[propertyName];
    if (!isRecord(entry)) {
      ctx.invalid(entrySource);
      continue;
    }
    if (!sourceSchemaHasProperty(ctx, rawSchema, schemaSource, propertyName)) {
      ctx.invalid(entrySource);
      continue;
    }
    const headers = multipart
      ? normalizeHeaders(
          ctx,
          entry.headers,
          child(entrySource, "headers"),
          anchorChild(anchor, propertyName, "headers"),
        )
      : entry.headers === undefined
        ? []
        : (ctx.partial(child(entrySource, "headers")), []);
    const contentType = optionalString(entry, "contentType", entrySource, ctx);
    if (contentType !== undefined) {
      if (
        entry.style !== undefined ||
        entry.explode !== undefined ||
        entry.allowReserved !== undefined
      ) {
        ctx.partial(entrySource);
      }
      encodings.push({
        contentType,
        encodingKind: "content",
        headers,
        propertyName,
      });
      continue;
    }
    if (multipart && essence !== "multipart/form-data") {
      ctx.partial(entrySource);
      continue;
    }
    const style = optionalString(entry, "style", entrySource, ctx) ?? "form";
    if (
      style !== "form" &&
      style !== "spaceDelimited" &&
      style !== "pipeDelimited" &&
      style !== "deepObject"
    ) {
      ctx.invalid(child(entrySource, "style"));
      continue;
    }
    const explode =
      optionalBoolean(entry, "explode", entrySource, ctx) ?? style === "form";
    const allowReserved =
      optionalBoolean(entry, "allowReserved", entrySource, ctx) ?? false;
    encodings.push({
      encodingKind: "serialization",
      headers,
      propertyName,
      serialization: { allowReserved, explode, style },
    });
  }
  return encodings;
}

/**
 * Checks, on the raw source, whether the media schema declares a property,
 * following references and composition variants without I/O.
 */
export function sourceSchemaHasProperty(
  ctx: NormalizeContext,
  rawSchema: unknown,
  source: SourceLocation,
  propertyName: string,
  depth = 0,
  visited = new Set<string>(),
): boolean {
  if (depth > 32) return false;
  if (!isRecord(rawSchema)) return false;
  if (typeof rawSchema.$ref === "string") {
    const key = `${source.document}#${source.pointer}`;
    if (visited.has(key)) return false;
    visited.add(key);
    const resolved = ctx.resolve(child(source, "$ref"), rawSchema.$ref);
    if (resolved === undefined) return false;
    return sourceSchemaHasProperty(
      ctx,
      resolved.value,
      resolved.location,
      propertyName,
      depth + 1,
      visited,
    );
  }
  if (
    isRecord(rawSchema.properties) &&
    Object.hasOwn(rawSchema.properties, propertyName)
  ) {
    return true;
  }
  for (const mode of ["allOf", "anyOf", "oneOf"] as const) {
    const variants = rawSchema[mode];
    if (!Array.isArray(variants)) continue;
    if (
      variants.some((variant, index) =>
        sourceSchemaHasProperty(
          ctx,
          variant,
          child(source, mode, String(index)),
          propertyName,
          depth + 1,
          new Set(visited),
        ),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Normalizes a Headers map into canonical response/encoding headers. */
export function normalizeHeaders(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
): readonly ResponseHeader[] {
  if (raw === undefined) return [];
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return [];
  }
  const headers: ResponseHeader[] = [];
  const seen = new Set<string>();
  for (const name of Object.keys(raw).sort(compareText)) {
    const headerSource = child(source, name);
    if (name.toLowerCase() === "content-type") {
      ctx.partial(headerSource);
      continue;
    }
    if (seen.has(name.toLowerCase())) {
      ctx.invalid(headerSource);
      continue;
    }
    seen.add(name.toLowerCase());
    const dereferenced = ctx.dereference(raw[name], headerSource);
    if (dereferenced === undefined) continue;
    const header = normalizeHeader(
      ctx,
      name,
      dereferenced.value,
      dereferenced.location,
      anchorChild(anchor, name),
    );
    if (header !== undefined) headers.push(header);
  }
  return headers;
}

function normalizeHeader(
  ctx: NormalizeContext,
  name: string,
  raw: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
): ResponseHeader | undefined {
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return undefined;
  }
  const description = optionalString(raw, "description", source, ctx);
  const deprecated = optionalBoolean(raw, "deprecated", source, ctx) ?? false;
  const examples = normalizeExamples(ctx, raw, source);
  const metadata = {
    deprecated,
    ...(description === undefined ? {} : { description }),
    examples,
    name,
  };
  for (const key of ["in", "name"] as const) {
    if (raw[key] !== undefined) ctx.partial(child(source, key));
  }
  if (raw.schema !== undefined && raw.content !== undefined) {
    ctx.invalid(source);
    return undefined;
  }
  if (raw.content !== undefined) {
    const content = normalizeContent(
      ctx,
      raw.content,
      child(source, "content"),
      anchorChild(anchor, "content"),
      { allowEncodings: false },
    );
    if (content.length !== 1 || content[0] === undefined) {
      ctx.invalid(child(source, "content"));
      return undefined;
    }
    return { ...metadata, content: content[0], valueKind: "content" };
  }
  const style = optionalString(raw, "style", source, ctx) ?? "simple";
  if (style !== "simple") {
    ctx.invalid(child(source, "style"));
    return undefined;
  }
  const explode = optionalBoolean(raw, "explode", source, ctx) ?? false;
  const schema: SchemaNode =
    raw.schema === undefined
      ? { kind: "any" }
      : normalizeSchema(
          ctx,
          raw.schema,
          child(source, "schema"),
          anchorChild(anchor, "schema"),
        );
  return {
    ...metadata,
    schema,
    serialization: { explode, style: "simple" },
    valueKind: "schema",
  };
}
