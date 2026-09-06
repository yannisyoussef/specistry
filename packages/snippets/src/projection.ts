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
  encodePathLiteral,
  encodePathValue,
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

type Primitive = boolean | number | string | null;

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
  const path = renderPath(operation.path, pathValues);

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
      value: encodeQueryValue(joinDelimited(value, ",")),
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

function primitiveText(value: JsonValue): string {
  if (value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return sanitizeLine(String(value));
}

function isPrimitive(value: JsonValue): value is Primitive {
  return value === null || typeof value !== "object";
}

function entriesOf(value: JsonValue): readonly (readonly [string, string])[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), primitiveText(item)]);
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => [
      sanitizeLine(key, 120),
      primitiveText(item),
    ]);
  }
  return [["", primitiveText(value)]];
}

function joinDelimited(value: JsonValue, delimiter: string): string {
  if (isPrimitive(value)) return primitiveText(value);
  if (Array.isArray(value)) return value.map(primitiveText).join(delimiter);
  return entriesOf(value)
    .flatMap(([key, item]) => [key, item])
    .join(delimiter);
}

// --- path -----------------------------------------------------------------

function serializePath(
  parameter: Parameter,
  registry: ApiService["schemas"],
): string {
  const value = valueOf(parameter, registry);
  const style =
    parameter.valueKind === "schema" && parameter.location === "path"
      ? parameter.serialization.style
      : "simple";
  const explode =
    parameter.valueKind === "schema" && parameter.location === "path"
      ? parameter.serialization.explode
      : false;
  const name = parameter.name;
  if (isPrimitive(value)) {
    const encoded = encodePathValue(primitiveText(value));
    switch (style) {
      case "label":
        return `.${encoded}`;
      case "matrix":
        return `;${encodePathValue(name)}=${encoded}`;
      default:
        return encoded;
    }
  }
  const array = Array.isArray(value);
  const items = array
    ? value.map((item) => encodePathValue(primitiveText(item)))
    : entriesOf(value).map(
        ([key, item]) => [encodePathValue(key), encodePathValue(item)] as const,
      );
  const flat = array
    ? (items as string[])
    : (items as (readonly [string, string])[]).flatMap(([key, item]) => [
        key,
        item,
      ]);
  const pairs = array
    ? (items as string[])
    : (items as (readonly [string, string])[]).map(
        ([key, item]) => `${key}=${item}`,
      );
  switch (style) {
    case "label":
      return explode ? `.${pairs.join(".")}` : `.${flat.join(",")}`;
    case "matrix":
      if (!explode) return `;${encodePathValue(name)}=${flat.join(",")}`;
      return array
        ? pairs.map((item) => `;${encodePathValue(name)}=${item}`).join("")
        : pairs.map((pair) => `;${pair}`).join("");
    default:
      return explode && !array ? pairs.join(",") : flat.join(",");
  }
}

/** Substitutes `{name}` in the template; unknown names become placeholders. */
function renderPath(
  template: string,
  values: ReadonlyMap<string, string>,
): string {
  const clean = sanitizeLine(template, 2_048);
  let result = "";
  let rest = clean;
  for (;;) {
    const open = rest.indexOf("{");
    const close = open === -1 ? -1 : rest.indexOf("}", open);
    if (open === -1 || close === -1) {
      result += encodePathLiteral(rest);
      break;
    }
    result += encodePathLiteral(rest.slice(0, open));
    const name = rest.slice(open + 1, close);
    result += values.get(name) ?? placeholderFor(name);
    rest = rest.slice(close + 1);
  }
  return result.startsWith("/") ? result : `/${result}`;
}

// --- query ----------------------------------------------------------------

function serializeQuery(
  parameter: Parameter,
  registry: ApiService["schemas"],
): readonly Pair[] {
  const value = valueOf(parameter, registry);
  const serialization =
    parameter.valueKind === "schema" && parameter.location === "query"
      ? parameter.serialization
      : { allowReserved: false, explode: true, style: "form" as const };
  const { allowReserved, explode, style } = serialization;
  const name = encodeQueryValue(sanitizeLine(parameter.name, 120));
  const encode = (text: string) => encodeQueryValue(text, allowReserved);
  if (parameter.valueKind === "content") {
    // Content-typed parameters carry a serialized document (JSON) as the value.
    return [{ name, value: encode(JSON.stringify(value)) }];
  }
  if (isPrimitive(value))
    return [{ name, value: encode(primitiveText(value)) }];
  if (Array.isArray(value)) {
    const items = value.map((item) => encode(primitiveText(item)));
    if (items.length === 0) return [];
    if (explode) return items.map((item) => ({ name, value: item }));
    const delimiter =
      style === "spaceDelimited"
        ? "%20"
        : style === "pipeDelimited"
          ? "|"
          : ",";
    return [{ name, value: items.join(delimiter) }];
  }
  const entries = entriesOf(value);
  if (style === "deepObject") {
    return entries.map(([key, item]) => ({
      name: `${name}[${encodeQueryValue(key)}]`,
      value: encode(item),
    }));
  }
  if (explode) {
    return entries.map(([key, item]) => ({
      name: encodeQueryValue(key),
      value: encode(item),
    }));
  }
  return [
    {
      name,
      value: entries
        .flatMap(([key, item]) => [encodeQueryValue(key), encode(item)])
        .join(","),
    },
  ];
}

// --- headers --------------------------------------------------------------

function serializeSimple(
  parameter: Parameter,
  registry: ApiService["schemas"],
): string {
  const value = valueOf(parameter, registry);
  const explode =
    parameter.valueKind === "schema" && parameter.location === "header"
      ? parameter.serialization.explode
      : false;
  if (isPrimitive(value)) return primitiveText(value);
  if (Array.isArray(value)) return value.map(primitiveText).join(",");
  return explode
    ? entriesOf(value)
        .map(([key, item]) => `${key}=${item}`)
        .join(",")
    : joinDelimited(value, ",");
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
