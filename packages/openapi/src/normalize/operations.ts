import {
  createOperationId,
  type HttpMethod,
  type Operation,
  type Parameter,
  type ParameterId,
  type RequestBody,
  type Response,
  type ResponseStatus,
  type SchemaNode,
  type ServerId,
} from "@specra/model";

import type { SourceLocation } from "../diagnostics.js";
import { compareText } from "../identity.js";
import { isRecord } from "../parse.js";
import {
  anchorChild,
  child,
  optionalBoolean,
  optionalString,
  withOverrides,
  type CanonicalAnchor,
  type NormalizeContext,
} from "./context.js";
import {
  normalizeContent,
  normalizeExamples,
  normalizeHeaders,
} from "./media.js";
import { normalizeSchema } from "./schema.js";
import {
  normalizeSecurityRequirements,
  type SecurityCatalog,
} from "./security.js";
import { normalizeServers } from "./servers.js";

const METHODS: readonly (readonly [string, HttpMethod])[] = [
  ["get", "GET"],
  ["put", "PUT"],
  ["post", "POST"],
  ["delete", "DELETE"],
  ["options", "OPTIONS"],
  ["head", "HEAD"],
  ["patch", "PATCH"],
  ["trace", "TRACE"],
];
const METHOD_KEYS = new Set(METHODS.map(([key]) => key));
/** Header parameters the specification ignores in favour of other fields. */
const RESERVED_HEADERS = new Set(["accept", "authorization", "content-type"]);
const PATH_ITEM_KEYS = new Set([
  "$ref",
  "description",
  "parameters",
  "servers",
  "summary",
  ...METHODS.map(([key]) => key),
]);

export interface PathContext {
  readonly rootSecurity: unknown;
  readonly rootSecuritySource: SourceLocation;
  readonly rootServerIds: readonly ServerId[];
  readonly catalog: SecurityCatalog;
}

/** Normalizes every operation under `paths` in deterministic path/method order. */
export function normalizePaths(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
  context: PathContext,
): readonly Operation[] {
  if (raw === undefined) return [];
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return [];
  }
  const operations: Operation[] = [];
  for (const path of Object.keys(raw).sort(compareText)) {
    const pathSource = child(source, path);
    if (!path.startsWith("/")) {
      ctx.invalid(pathSource);
      continue;
    }
    // Operations declared beside a Path Item `$ref` are undefined by the
    // specification and would otherwise be dropped silently.
    const dereferenced = ctx.dereference(raw[path], pathSource, (key) =>
      METHOD_KEYS.has(key) ? "invalid" : "partial",
    );
    if (dereferenced === undefined) continue;
    const item = dereferenced.value;
    if (!isRecord(item)) {
      ctx.invalid(pathSource);
      continue;
    }
    const itemSource = dereferenced.location;
    for (const key of Object.keys(item)) {
      if (!PATH_ITEM_KEYS.has(key) && !key.startsWith("x-"))
        ctx.partial(child(itemSource, key));
    }
    const pathServers =
      item.servers === undefined
        ? undefined
        : normalizeServers(ctx, item.servers, child(itemSource, "servers"));
    for (const [key, method] of METHODS) {
      const operationRaw = item[key];
      if (operationRaw === undefined) continue;
      ctx.operationCount += 1;
      if (ctx.operationCount > ctx.limits.maxOperations) {
        ctx.sink.add("SOURCE_LIMIT_EXCEEDED", child(itemSource, key));
        return operations;
      }
      const operation = normalizeOperation(
        ctx,
        operationRaw,
        child(itemSource, key),
        path,
        method,
        item.parameters,
        child(itemSource, "parameters"),
        pathServers ?? context.rootServerIds,
        context,
      );
      if (operation !== undefined) operations.push(operation);
    }
  }
  return operations;
}

function normalizeOperation(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
  path: string,
  method: HttpMethod,
  pathParameters: unknown,
  pathParametersSource: SourceLocation,
  inheritedServerIds: readonly ServerId[],
  context: PathContext,
): Operation | undefined {
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return undefined;
  }
  const contractId = optionalString(raw, "operationId", source, ctx);
  if (contractId !== undefined && contractId.length === 0) {
    ctx.invalid(child(source, "operationId"));
    return undefined;
  }
  const id = createOperationId({
    ...(contractId === undefined ? {} : { contractId }),
    method,
    path,
  });
  const sourceIdentity = `${method} ${path.normalize("NFC")}${contractId === undefined ? "" : `#${contractId.normalize("NFC")}`}`;
  const claimLocation =
    contractId === undefined ? source : child(source, "operationId");
  const claim = ctx.ledger.claim(
    "operation",
    id,
    sourceIdentity,
    claimLocation,
  );
  if (!claim.ok) {
    const code =
      contractId !== undefined &&
      claim.existing.sourceIdentity.endsWith(`#${contractId.normalize("NFC")}`)
        ? "SOURCE_DUPLICATE_OPERATION_ID"
        : "SOURCE_IDENTITY_COLLISION";
    ctx.sink.add(code, claimLocation);
    ctx.sink.add(code, claim.existing.location);
    return undefined;
  }
  const anchor: CanonicalAnchor = {
    operationId: id,
    path: "",
    serviceId: ctx.serviceId,
  };
  const summary = optionalString(raw, "summary", source, ctx)?.trim();
  const description = optionalString(raw, "description", source, ctx);
  const deprecated = optionalBoolean(raw, "deprecated", source, ctx) ?? false;
  const title =
    summary !== undefined && summary.length > 0
      ? summary
      : (contractId ?? `${method} ${path}`);

  const tags = normalizeTags(ctx, raw.tags, child(source, "tags"));
  const parameters = normalizeParameters(
    ctx,
    pathParameters,
    pathParametersSource,
    raw.parameters,
    child(source, "parameters"),
    anchor,
    path,
  );
  if (parameters === undefined) return undefined;
  const requestBody =
    raw.requestBody === undefined
      ? undefined
      : normalizeRequestBody(
          ctx,
          raw.requestBody,
          child(source, "requestBody"),
          anchor,
        );
  const responses = normalizeResponses(
    ctx,
    raw.responses,
    child(source, "responses"),
    anchor,
  );
  if (responses.length === 0) {
    ctx.invalid(child(source, "responses"));
    return undefined;
  }
  const security =
    raw.security === undefined
      ? normalizeSecurityRequirements(
          ctx,
          context.rootSecurity,
          context.rootSecuritySource,
          context.catalog,
        )
      : normalizeSecurityRequirements(
          ctx,
          raw.security,
          child(source, "security"),
          context.catalog,
        );
  const serverIds =
    raw.servers === undefined
      ? inheritedServerIds
      : normalizeServers(ctx, raw.servers, child(source, "servers"));
  for (const key of ["callbacks", "externalDocs"] as const) {
    if (raw[key] !== undefined) ctx.unsupported(child(source, key));
  }
  return {
    ...(contractId === undefined ? {} : { contractId }),
    deprecated,
    ...(description === undefined ? {} : { description }),
    extensions: ctx.extensions(raw, source),
    id,
    method,
    parameters,
    path,
    ...(requestBody === undefined ? {} : { requestBody }),
    responses,
    security,
    serverIds,
    tags,
    title,
  };
}

function normalizeTags(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
): readonly string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    ctx.invalid(source);
    return [];
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  raw.forEach((tag, index) => {
    if (
      typeof tag !== "string" ||
      tag.length === 0 ||
      seen.has(tag.normalize("NFC"))
    ) {
      ctx.invalid(child(source, String(index)));
      return;
    }
    seen.add(tag.normalize("NFC"));
    tags.push(tag);
  });
  return tags;
}

interface RawParameter {
  readonly value: Readonly<Record<string, unknown>>;
  readonly location: SourceLocation;
}

function normalizeParameters(
  ctx: NormalizeContext,
  pathLevel: unknown,
  pathSource: SourceLocation,
  operationLevel: unknown,
  operationSource: SourceLocation,
  anchor: CanonicalAnchor,
  path: string,
): readonly Parameter[] | undefined {
  const merged = new Map<string, RawParameter>();
  const order: string[] = [];
  for (const [raw, source] of [
    [pathLevel, pathSource],
    [operationLevel, operationSource],
  ] as const) {
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) {
      ctx.invalid(source);
      continue;
    }
    // A list MUST NOT repeat a name/location pair; an operation may override
    // a path-level parameter, which is the only permitted repetition.
    const seenInList = new Set<string>();
    raw.forEach((entry, index) => {
      const entrySource = child(source, String(index));
      const dereferenced = ctx.dereference(entry, entrySource);
      if (dereferenced === undefined) return;
      const value = withOverrides(dereferenced);
      if (
        !isRecord(value) ||
        typeof value.name !== "string" ||
        typeof value.in !== "string"
      ) {
        ctx.invalid(entrySource);
        return;
      }
      const location = value.in;
      const name =
        location === "header" ? value.name.toLowerCase() : value.name;
      const key = `${location}\u001f${name}`;
      if (seenInList.has(key)) {
        ctx.invalid(entrySource);
        return;
      }
      seenInList.add(key);
      if (!merged.has(key)) order.push(key);
      merged.set(key, { location: dereferenced.location, value });
    });
  }
  const parameters: Parameter[] = [];
  const claimed = new Map<string, SourceLocation>();
  for (const key of order) {
    const raw = merged.get(key);
    if (raw === undefined) continue;
    const parameter = normalizeParameter(
      ctx,
      raw.value,
      raw.location,
      anchor,
      claimed,
    );
    if (parameter !== undefined) parameters.push(parameter);
  }
  const documented = new Set(
    parameters
      .filter((parameter) => parameter.location === "path")
      .map((parameter) => parameter.name),
  );
  let valid = true;
  for (const match of path.matchAll(/\{([^{}]+)\}/g)) {
    if (match[1] !== undefined && !documented.has(match[1])) valid = false;
  }
  for (const parameter of parameters) {
    if (parameter.location === "path" && !path.includes(`{${parameter.name}}`))
      valid = false;
  }
  if (!valid) {
    ctx.invalid(operationSource);
    return undefined;
  }
  return parameters;
}

function normalizeParameter(
  ctx: NormalizeContext,
  raw: Readonly<Record<string, unknown>>,
  source: SourceLocation,
  anchor: CanonicalAnchor,
  claimed: Map<string, SourceLocation>,
): Parameter | undefined {
  const name = raw.name as string;
  const location = raw.in;
  if (
    location !== "query" &&
    location !== "path" &&
    location !== "header" &&
    location !== "cookie"
  ) {
    ctx.invalid(child(source, "in"));
    return undefined;
  }
  if (name.length === 0) {
    ctx.invalid(child(source, "name"));
    return undefined;
  }
  if (location === "header" && RESERVED_HEADERS.has(name.toLowerCase())) {
    // The specification ignores these as parameters; they are described by
    // `content`, `requestBody`, and `security` instead.
    ctx.partial(source);
    return undefined;
  }
  if (raw.schema === undefined && raw.content === undefined) {
    ctx.invalid(source);
    return undefined;
  }
  const description = optionalString(raw, "description", source, ctx);
  const deprecated = optionalBoolean(raw, "deprecated", source, ctx) ?? false;
  let required = optionalBoolean(raw, "required", source, ctx) ?? false;
  if (location === "path" && !required) {
    ctx.invalid(child(source, "required"));
    required = true;
  }
  const id = ctx.slug(
    "parameter",
    `${location}.${location === "header" ? name.toLowerCase() : name}`,
  ) as ParameterId;
  const existing = claimed.get(id);
  if (existing !== undefined) {
    ctx.sink.add("SOURCE_IDENTITY_COLLISION", source);
    ctx.sink.add("SOURCE_IDENTITY_COLLISION", existing);
    return undefined;
  }
  claimed.set(id, source);
  const examples = normalizeExamples(ctx, raw, source);
  const parameterAnchor = anchorChild(
    anchor,
    "parameters",
    `${location}.${name}`,
  );
  const metadata = {
    deprecated,
    ...(description === undefined ? {} : { description }),
    examples,
    id,
    name,
    required,
  };
  if (raw.allowEmptyValue !== undefined)
    ctx.partial(child(source, "allowEmptyValue"));
  if (raw.schema !== undefined && raw.content !== undefined) {
    ctx.invalid(source);
    return undefined;
  }
  if (raw.content !== undefined) {
    const content = normalizeContent(
      ctx,
      raw.content,
      child(source, "content"),
      anchorChild(parameterAnchor, "content"),
      { allowEncodings: false },
    );
    if (content.length !== 1 || content[0] === undefined) {
      ctx.invalid(child(source, "content"));
      return undefined;
    }
    return { ...metadata, content: content[0], location, valueKind: "content" };
  }
  const schema: SchemaNode =
    raw.schema === undefined
      ? { kind: "any" }
      : normalizeSchema(
          ctx,
          raw.schema,
          child(source, "schema"),
          anchorChild(parameterAnchor, "schema"),
        );
  const style = optionalString(raw, "style", source, ctx);
  const explodeRaw = optionalBoolean(raw, "explode", source, ctx);
  const allowReserved =
    optionalBoolean(raw, "allowReserved", source, ctx) ?? false;
  if (location !== "query" && raw.allowReserved !== undefined)
    ctx.partial(child(source, "allowReserved"));
  switch (location) {
    case "query": {
      const resolved = style ?? "form";
      if (
        resolved !== "form" &&
        resolved !== "spaceDelimited" &&
        resolved !== "pipeDelimited" &&
        resolved !== "deepObject"
      ) {
        ctx.invalid(child(source, "style"));
        return undefined;
      }
      return {
        ...metadata,
        location,
        schema,
        serialization: {
          allowReserved,
          explode: explodeRaw ?? resolved === "form",
          style: resolved,
        },
        valueKind: "schema",
      };
    }
    case "path": {
      const resolved = style ?? "simple";
      if (
        resolved !== "simple" &&
        resolved !== "label" &&
        resolved !== "matrix"
      ) {
        ctx.invalid(child(source, "style"));
        return undefined;
      }
      return {
        ...metadata,
        location,
        schema,
        serialization: { explode: explodeRaw ?? false, style: resolved },
        valueKind: "schema",
      };
    }
    case "header": {
      if (style !== undefined && style !== "simple") {
        ctx.invalid(child(source, "style"));
        return undefined;
      }
      return {
        ...metadata,
        location,
        schema,
        serialization: { explode: explodeRaw ?? false, style: "simple" },
        valueKind: "schema",
      };
    }
    case "cookie": {
      if (style !== undefined && style !== "form") {
        ctx.invalid(child(source, "style"));
        return undefined;
      }
      return {
        ...metadata,
        location,
        schema,
        serialization: { explode: explodeRaw ?? true, style: "form" },
        valueKind: "schema",
      };
    }
  }
}

function normalizeRequestBody(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
): RequestBody | undefined {
  const dereferenced = ctx.dereference(raw, source);
  if (dereferenced === undefined) return undefined;
  const body = withOverrides(dereferenced);
  if (!isRecord(body)) {
    ctx.invalid(source);
    return undefined;
  }
  if (body.content === undefined) {
    ctx.invalid(child(dereferenced.location, "content"));
    return undefined;
  }
  const description = optionalString(
    body,
    "description",
    dereferenced.location,
    ctx,
  );
  const required =
    optionalBoolean(body, "required", dereferenced.location, ctx) ?? false;
  const content = normalizeContent(
    ctx,
    body.content,
    child(dereferenced.location, "content"),
    anchorChild(anchor, "requestBody", "content"),
    { allowEncodings: true },
  );
  return {
    content,
    ...(description === undefined ? {} : { description }),
    required,
  };
}

function normalizeResponses(
  ctx: NormalizeContext,
  raw: unknown,
  source: SourceLocation,
  anchor: CanonicalAnchor,
): readonly Response[] {
  if (raw === undefined) return [];
  if (!isRecord(raw)) {
    ctx.invalid(source);
    return [];
  }
  const responses: Response[] = [];
  const seen = new Set<string>();
  for (const key of Object.keys(raw).sort(compareText)) {
    const responseSource = child(source, key);
    const status = parseStatus(key);
    if (status === undefined) {
      ctx.invalid(responseSource);
      continue;
    }
    const statusKey = JSON.stringify(status);
    if (seen.has(statusKey)) {
      ctx.invalid(responseSource);
      continue;
    }
    seen.add(statusKey);
    const dereferenced = ctx.dereference(raw[key], responseSource);
    if (dereferenced === undefined) continue;
    const response = withOverrides(dereferenced);
    if (
      !isRecord(response) ||
      typeof response.description !== "string" ||
      response.description.length === 0
    ) {
      ctx.invalid(responseSource);
      continue;
    }
    const responseAnchor = anchorChild(anchor, "responses", key);
    if (response.links !== undefined)
      ctx.unsupported(child(dereferenced.location, "links"));
    responses.push({
      bodies: normalizeContent(
        ctx,
        response.content,
        child(dereferenced.location, "content"),
        anchorChild(responseAnchor, "bodies"),
        { allowEncodings: false },
      ),
      description: response.description,
      headers: normalizeHeaders(
        ctx,
        response.headers,
        child(dereferenced.location, "headers"),
        anchorChild(responseAnchor, "headers"),
      ),
      status,
    });
  }
  return responses;
}

function parseStatus(key: string): ResponseStatus | undefined {
  if (key === "default") return { kind: "default" };
  if (/^[1-5]XX$/.test(key))
    return {
      kind: "range",
      range: key as "1XX" | "2XX" | "3XX" | "4XX" | "5XX",
    };
  if (/^[1-5]\d\d$/.test(key)) return { code: Number(key), kind: "code" };
  return undefined;
}
