import type {
  ApiService,
  JsonValue,
  MediaTypeContent,
  Operation,
  Parameter,
  SchemaNode,
  SecurityScheme,
} from "@specra/model";

import {
  createBudget,
  exampleFor,
  isBinarySchema,
  sanitizeExample,
} from "./example.js";
import {
  isSensitiveName,
  isToken,
  placeholderFor,
  sanitizeLine,
  sanitizeText,
  secretPlaceholderFor,
} from "./sanitize.js";
import {
  joinDelimited,
  renderPathTemplate,
  serializeCookieParameter,
  serializeHeaderParameter,
  serializePathParameter,
  serializeQueryParameter,
} from "./serialize.js";
import {
  PLACEHOLDERS,
  SNIPPET_LIMITS,
  type AuthAlternative,
  type AuthSchemeProjection,
  type BodyProjection,
  type FormField,
  type Pair,
  type RequestProjection,
} from "./types.js";
import {
  boundEnvironments,
  encodeQueryValue,
  serverEnvironment,
} from "./url.js";

/**
 * Canonical operation → protocol request projection. Pure and deterministic:
 * the same operation always yields the same projection, and nothing here
 * reads the environment, the clock, or the network. Parameter serialization
 * follows the canonical style/explode/allowReserved semantics; values follow
 * the example policy (explicit example → default → const → enum → schema
 * placeholder) and the sensitive-name redaction from `sanitize.ts`.
 * Parameter order is path, query, header, cookie, each in declaration order;
 * deprecated optional parameters are omitted.
 */

export interface ProjectionDiagnostic {
  readonly code:
    | "SNIPPET_BODY_TRUNCATED"
    | "SNIPPET_HEADER_SKIPPED"
    | "SNIPPET_SERVER_UNUSABLE";
  readonly operationId: string;
  /** Parameter name, media type, or server id for the message pointer. */
  readonly detail?: string;
}

export interface OperationProjection {
  readonly projection: RequestProjection;
  readonly diagnostics: readonly ProjectionDiagnostic[];
}

export function projectOperation(
  service: ApiService,
  operation: Operation,
): OperationProjection {
  const diagnostics: ProjectionDiagnostic[] = [];
  const registry = service.schemas;
  const included = operation.parameters.filter(
    (parameter) => parameter.required || !parameter.deprecated,
  );
  const byLocation = (location: Parameter["location"]) =>
    included
      .filter((parameter) => parameter.location === location)
      .slice(0, SNIPPET_LIMITS.maxParameters);

  const pathValues = new Map<string, string>();
  for (const parameter of byLocation("path")) {
    pathValues.set(parameter.name, serializePath(parameter, registry));
  }
  const path = renderPathTemplate(operation.path, pathValues);

  const query: Pair[] = [];
  for (const parameter of byLocation("query")) {
    query.push(...serializeQuery(parameter, registry));
  }

  const headers: Pair[] = [];
  for (const parameter of byLocation("header")) {
    if (!isToken(parameter.name)) {
      diagnostics.push({
        code: "SNIPPET_HEADER_SKIPPED",
        detail: sanitizeLine(parameter.name, 60),
        operationId: operation.id,
      });
      continue;
    }
    headers.push({
      name: parameter.name,
      value: serializeSimple(parameter, registry),
    });
  }

  const cookies: Pair[] = [];
  for (const parameter of byLocation("cookie")) {
    if (!isToken(parameter.name)) continue;
    const value = valueOf(parameter, registry);
    cookies.push({
      name: parameter.name,
      value: serializeCookieParameter(value),
    });
  }

  const bodies: BodyProjection[] = [];
  for (const content of operation.requestBody?.content ?? []) {
    const body = projectBody(content, registry);
    if (body.truncated) {
      diagnostics.push({
        code: "SNIPPET_BODY_TRUNCATED",
        detail: content.mediaType,
        operationId: operation.id,
      });
    }
    bodies.push(body);
  }

  const serverIds = new Set(operation.serverIds);
  const servers = boundEnvironments(
    service.servers
      .filter((server) => serverIds.size === 0 || serverIds.has(server.id))
      .flatMap((server) => {
        const environment = serverEnvironment(server);
        if (environment === undefined) {
          diagnostics.push({
            code: "SNIPPET_SERVER_UNUSABLE",
            detail: server.id,
            operationId: operation.id,
          });
          return [];
        }
        return [environment];
      }),
  );

  return {
    diagnostics,
    projection: {
      auth: projectAuth(operation, service.securitySchemes),
      bodies,
      cookies,
      headers,
      method: operation.method,
      path,
      pathTemplate: operation.path,
      query,
      responseKind: responseKindOf(operation),
      servers,
    },
  };
}

/** The first `2XX`/`default` response decides what the example prints. */
function responseKindOf(operation: Operation): "json" | "none" | "text" {
  const success =
    operation.responses.find(
      (response) =>
        (response.status.kind === "code" &&
          response.status.code >= 200 &&
          response.status.code < 300) ||
        (response.status.kind === "range" && response.status.range === "2XX"),
    ) ??
    operation.responses.find((response) => response.status.kind === "default");
  const body = success?.bodies[0];
  if (body === undefined) return "none";
  return JSON_MEDIA.test(body.mediaType) ? "json" : "text";
}

// --- values ---------------------------------------------------------------

function schemaOf(parameter: Parameter): SchemaNode | undefined {
  return parameter.valueKind === "content"
    ? parameter.content.schema
    : parameter.schema;
}

/** The representative value of a parameter under the example policy. */
function valueOf(
  parameter: Parameter,
  registry: ApiService["schemas"],
): JsonValue {
  if (isSensitiveName(parameter.name)) {
    return secretPlaceholderFor(parameter.name);
  }
  const example = parameter.examples.find(
    (candidate) => candidate.value !== undefined,
  );
  if (example?.value !== undefined) {
    return sanitizeExample(example.value, parameter.name);
  }
  const schema = schemaOf(parameter);
  if (schema === undefined) return placeholderFor(parameter.name);
  const value = exampleFor(schema, parameter.name, registry, createBudget());
  // Schema-shaped strings without a better source become named placeholders
  // so `?status=<STATUS>` reads as a slot rather than the word "string".
  return replaceGenericStrings(value, parameter.name);
}

function replaceGenericStrings(value: JsonValue, name: string): JsonValue {
  if (value === "string") return placeholderFor(name);
  if (Array.isArray(value)) {
    return value.map((item) => replaceGenericStrings(item, name));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceGenericStrings(item, key),
      ]),
    );
  }
  return value;
}

// --- path -----------------------------------------------------------------

function serializePath(
  parameter: Parameter,
  registry: ApiService["schemas"],
): string {
  const serialization =
    parameter.valueKind === "schema" && parameter.location === "path"
      ? parameter.serialization
      : { explode: false, style: "simple" as const };
  return serializePathParameter(
    parameter.name,
    valueOf(parameter, registry),
    serialization,
  );
}

// --- query ----------------------------------------------------------------

function serializeQuery(
  parameter: Parameter,
  registry: ApiService["schemas"],
): readonly Pair[] {
  const serialization =
    parameter.valueKind === "schema" && parameter.location === "query"
      ? parameter.serialization
      : { allowReserved: false, explode: true, style: "form" as const };
  return serializeQueryParameter(
    parameter.name,
    valueOf(parameter, registry),
    serialization,
    parameter.valueKind === "content",
  );
}

// --- headers --------------------------------------------------------------

function serializeSimple(
  parameter: Parameter,
  registry: ApiService["schemas"],
): string {
  const explode =
    parameter.valueKind === "schema" && parameter.location === "header"
      ? parameter.serialization.explode
      : false;
  return serializeHeaderParameter(valueOf(parameter, registry), explode);
}

// --- bodies ---------------------------------------------------------------

const JSON_MEDIA = /^application\/(?:[\w.+-]+\+)?json(?:;|$)/i;
const FORM_MEDIA = /^application\/x-www-form-urlencoded(?:;|$)/i;
const MULTIPART_MEDIA = /^multipart\/(?:form-data|mixed)(?:;|$)/i;
const TEXT_MEDIA = /^text\/(?:;|$|[\w.+-]+)/i;
const BINARY_MEDIA =
  /^(?:application\/(?:octet-stream|pdf|zip|gzip|x-tar)|image\/|audio\/|video\/|font\/)/i;

/** The first example whose value is not empty, else the first, else none. */
function representativeExample(
  content: MediaTypeContent,
): JsonValue | undefined {
  const values = content.examples
    .map((example) => example.value)
    .filter((value): value is JsonValue => value !== undefined);
  const nonEmpty = values.find(
    (value) =>
      !(Array.isArray(value) && value.length === 0) &&
      !(
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 0
      ) &&
      value !== "",
  );
  return nonEmpty ?? values[0];
}

export function projectBody(
  content: MediaTypeContent,
  registry: ApiService["schemas"],
): BodyProjection {
  const mediaType = sanitizeLine(content.mediaType, 120);
  const example = representativeExample(content);
  const budget = createBudget();
  const value =
    example !== undefined
      ? sanitizeExample(example)
      : content.schema === undefined
        ? undefined
        : exampleFor(content.schema, "body", registry, budget);
  if (JSON_MEDIA.test(mediaType)) {
    return {
      json: value ?? {},
      kind: "json",
      mediaType,
      truncated: budget.truncated,
    };
  }
  if (FORM_MEDIA.test(mediaType) || MULTIPART_MEDIA.test(mediaType)) {
    const multipart = MULTIPART_MEDIA.test(mediaType);
    return {
      fields: formFields(value, content, registry, multipart),
      kind: multipart ? "multipart" : "form",
      mediaType,
      truncated: budget.truncated,
    };
  }
  if (
    BINARY_MEDIA.test(mediaType) ||
    isBinarySchema(content.schema, registry)
  ) {
    return { kind: "binary", mediaType, truncated: false };
  }
  if (TEXT_MEDIA.test(mediaType)) {
    return {
      kind: "text",
      mediaType,
      text: textOf(value),
      truncated: budget.truncated,
    };
  }
  // XML, YAML, and friends: an example is shown as given; otherwise a
  // placeholder marks the slot rather than inventing a document.
  return {
    kind: "opaque",
    mediaType,
    text: value === undefined ? "<REQUEST_BODY>" : textOf(value),
    truncated: budget.truncated,
  };
}

function textOf(value: JsonValue | undefined): string {
  if (value === undefined) return "<REQUEST_BODY>";
  if (typeof value === "string") return sanitizeText(value);
  return sanitizeText(JSON.stringify(value, null, 2));
}

function formFields(
  value: JsonValue | undefined,
  content: MediaTypeContent,
  registry: ApiService["schemas"],
  multipart: boolean,
): readonly FormField[] {
  const object =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const schemaProperties =
    content.schema?.kind === "object" ? content.schema.properties : {};
  const fields: FormField[] = [];
  for (const [name, item] of Object.entries(object)) {
    if (!isToken(name) || item === undefined) continue;
    const encoding = content.encodings.find(
      (candidate) => candidate.propertyName === name,
    );
    const property = Object.hasOwn(schemaProperties, name)
      ? schemaProperties[name]
      : undefined;
    const file =
      multipart &&
      (isBinarySchema(property, registry) ||
        item === "<FILE_CONTENTS>" ||
        encoding?.encodingKind === "content");
    const contentType =
      encoding?.encodingKind === "content"
        ? sanitizeLine(encoding.contentType.split(",")[0] ?? "", 120).trim()
        : undefined;
    fields.push({
      file,
      name,
      value: file
        ? PLACEHOLDERS.filePath
        : multipart
          ? sanitizeLine(joinDelimited(item, ","))
          : encodeQueryValue(joinDelimited(item, ",")),
      ...(contentType === undefined || contentType === ""
        ? {}
        : { contentType }),
    });
    if (fields.length >= SNIPPET_LIMITS.maxParameters) break;
  }
  return fields;
}

// --- auth -----------------------------------------------------------------

function projectAuth(
  operation: Operation,
  schemes: ApiService["securitySchemes"],
): readonly AuthAlternative[] {
  const alternatives: AuthAlternative[] = [];
  for (const requirement of operation.security) {
    const projected: AuthSchemeProjection[] = [];
    for (const use of requirement.schemes) {
      const scheme = Object.hasOwn(schemes, use.schemeId)
        ? schemes[use.schemeId]
        : undefined;
      if (scheme === undefined) continue;
      projected.push({
        ...schemeProjection(scheme),
        scopes: use.scopes.map((scope) => sanitizeLine(scope, 80)),
      });
    }
    alternatives.push({ label: labelFor(projected), schemes: projected });
  }
  return alternatives;
}

function schemeProjection(
  scheme: SecurityScheme,
): Omit<AuthSchemeProjection, "scopes"> {
  switch (scheme.kind) {
    case "apiKey": {
      const name = sanitizeLine(scheme.name, 120);
      const kind =
        scheme.location === "header"
          ? "apiKeyHeader"
          : scheme.location === "query"
            ? "apiKeyQuery"
            : "apiKeyCookie";
      return { kind, name: isToken(name) ? name : "X-API-Key" };
    }
    case "http": {
      const token = scheme.scheme.toLowerCase();
      if (token === "bearer") return { kind: "bearer" };
      if (token === "basic") return { kind: "basic" };
      return {
        kind: "httpOther",
        name: isToken(token) ? token : "Custom",
      };
    }
    case "oauth2":
      return { kind: "oauth2" };
    case "openIdConnect":
      return { kind: "openIdConnect" };
    case "mutualTLS":
      return { kind: "mutualTls" };
  }
}

function labelFor(schemes: readonly AuthSchemeProjection[]): string {
  if (schemes.length === 0) return "No authentication";
  return schemes
    .map((scheme) => {
      switch (scheme.kind) {
        case "apiKeyHeader":
          return `${scheme.name} header`;
        case "apiKeyQuery":
          return `${scheme.name} query parameter`;
        case "apiKeyCookie":
          return `${scheme.name} cookie`;
        case "basic":
          return "Basic authentication";
        case "bearer":
          return "Bearer token";
        case "httpOther":
          return `${scheme.name} authorization`;
        case "oauth2":
          return scheme.scopes.length === 0
            ? "OAuth 2.0"
            : `OAuth 2.0 (${scheme.scopes.join(", ")})`;
        case "openIdConnect":
          return "OpenID Connect";
        case "mutualTls":
          return "Client certificate (mTLS)";
      }
    })
    .join(" + ");
}
