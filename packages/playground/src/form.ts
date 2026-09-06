import type {
  ApiService,
  JsonValue,
  MediaTypeContent,
  Operation,
  Parameter,
  SchemaNode,
} from "@specra/model";
import {
  exampleFor,
  isSensitiveName,
  projectBody,
  sanitizeExample,
  sanitizeLine,
  type AuthSchemeKind,
  type BodyProjection,
  type RequestProjection,
} from "@specra/snippets";

import {
  isForbiddenRequestHeader,
  type AuthSchemeForm,
  type BodyFieldForm,
  type BodyForm,
  type CapabilityReason,
  type FieldKind,
  type OperationCapability,
  type OperationForm,
  type ParameterField,
} from "./types.js";

/**
 * Build-time form projection (SPEC-009 §53): a bounded, browser-friendly
 * description of what a request needs, derived from the canonical operation
 * and the SPEC-008 request projection. Initial values are the same
 * representative values the code examples show (minus credential
 * placeholders), so Try it starts where Code left off. The capability
 * analysis (§32) is decided here, once, and never rediscovered on Send.
 */

const MAX_PARAMETERS = 24;
const MAX_OPTIONS = 64;
const MAX_INITIAL = 2_048;
const MAX_BODY_INITIAL = 16_384;

export function projectOperationForm(
  service: ApiService,
  operation: Operation,
  projection: RequestProjection,
): OperationForm {
  const registry = service.schemas;
  const parameters: ParameterField[] = [];
  const reasons = new Set<CapabilityReason>();
  const included = operation.parameters
    .filter((parameter) => parameter.required || !parameter.deprecated)
    .slice(0, MAX_PARAMETERS * 4);
  for (const location of ["path", "query", "header", "cookie"] as const) {
    for (const parameter of included
      .filter((candidate) => candidate.location === location)
      .slice(0, MAX_PARAMETERS)) {
      const field = parameterField(parameter, registry);
      parameters.push(field);
      if (
        field.capability === "unsupported" &&
        field.required &&
        field.reason !== undefined
      ) {
        reasons.add(field.reason);
      }
    }
  }
  const auth = projection.auth.map((alternative) => ({
    label: alternative.label,
    schemes: alternative.schemes.map(schemeForm),
    supported: alternative.schemes.every(
      (scheme) => schemeForm(scheme).supported,
    ),
  }));
  if (auth.length > 0 && !auth.some((alternative) => alternative.supported)) {
    for (const alternative of auth) {
      for (const scheme of alternative.schemes) {
        if (!scheme.supported && scheme.reason !== undefined)
          reasons.add(scheme.reason);
      }
    }
  }
  const bodies = (operation.requestBody?.content ?? []).map((content, index) =>
    bodyForm(content, projection.bodies[index], registry),
  );
  const partial =
    auth.some((alternative) => !alternative.supported) ||
    parameters.some(
      (field) => field.capability === "unsupported" && !field.required,
    );
  const capability: OperationCapability = {
    reasons: [...reasons].sort(),
    state:
      reasons.size > 0 ? "unsupported" : partial ? "partial" : "executable",
  };
  return {
    auth,
    bodies,
    bodyRequired: operation.requestBody?.required ?? false,
    capability,
    method: operation.method,
    parameters,
    pathTemplate: sanitizeLine(operation.path, 2_048),
    responseKind: projection.responseKind,
  };
}

function schemeForm(scheme: {
  readonly kind: AuthSchemeKind;
  readonly name?: string;
  readonly scopes: readonly string[];
}): AuthSchemeForm {
  const base = {
    kind: scheme.kind,
    scopes: scheme.scopes,
    ...(scheme.name === undefined ? {} : { name: scheme.name }),
  };
  switch (scheme.kind) {
    case "bearer":
      return { ...base, label: "Bearer token", supported: true };
    case "oauth2":
      return { ...base, label: "OAuth 2.0 access token", supported: true };
    case "openIdConnect":
      return { ...base, label: "OpenID Connect access token", supported: true };
    case "basic":
      return { ...base, label: "Basic authentication", supported: true };
    case "apiKeyHeader": {
      const name = scheme.name ?? "X-API-Key";
      return isForbiddenRequestHeader(name)
        ? {
            ...base,
            label: `${name} header`,
            reason: "forbidden-header",
            supported: false,
          }
        : { ...base, label: `${name} header`, supported: true };
    }
    case "apiKeyQuery":
      return {
        ...base,
        label: `${scheme.name ?? "api_key"} query parameter`,
        reason: "auth-query-api-key",
        supported: false,
      };
    case "apiKeyCookie":
      return {
        ...base,
        label: `${scheme.name ?? "session"} cookie`,
        reason: "auth-cookie-api-key",
        supported: false,
      };
    case "mutualTls":
      return {
        ...base,
        label: "Client certificate (mTLS)",
        reason: "auth-mutual-tls",
        supported: false,
      };
    case "httpOther":
      return {
        ...base,
        label: `${scheme.name ?? "Custom"} authorization`,
        reason: "auth-unsupported-scheme",
        supported: false,
      };
  }
}

function schemaOf(parameter: Parameter): SchemaNode | undefined {
  return parameter.valueKind === "content"
    ? parameter.content.schema
    : parameter.schema;
}

function resolveRef(
  node: SchemaNode | undefined,
  registry: ApiService["schemas"],
  depth = 0,
): SchemaNode | undefined {
  if (node?.kind === "ref" && depth < 8) {
    const target = Object.hasOwn(registry, node.schemaId)
      ? registry[node.schemaId]
      : undefined;
    return resolveRef(target, registry, depth + 1);
  }
  return node;
}

function fieldKind(node: SchemaNode | undefined): {
  kind: FieldKind;
  array: boolean;
  options?: readonly string[];
} {
  if (node === undefined) return { array: false, kind: "string" };
  switch (node.kind) {
    case "scalar":
      if (node.enumValues !== undefined && node.enumValues.length > 0) {
        return {
          array: false,
          kind: "enum",
          options: node.enumValues
            .slice(0, MAX_OPTIONS)
            .map((value) =>
              typeof value === "string" ? value : JSON.stringify(value),
            ),
        };
      }
      return {
        array: false,
        kind: node.type === "null" ? "string" : node.type,
      };
    case "array":
      return { array: true, kind: "json" };
    case "object":
    case "tuple":
      return { array: false, kind: "json" };
    default:
      return { array: false, kind: "string" };
  }
}

function initialValue(
  parameter: Parameter,
  registry: ApiService["schemas"],
): string {
  if (isSensitiveName(parameter.name)) return "";
  const example = parameter.examples.find(
    (candidate) => candidate.value !== undefined,
  );
  let value: JsonValue | undefined;
  if (example?.value !== undefined)
    value = sanitizeExample(example.value, parameter.name);
  else {
    const schema = resolveRef(schemaOf(parameter), registry);
    if (
      schema !== undefined &&
      (schema.defaultValue !== undefined ||
        schema.examples?.[0] !== undefined ||
        (schema.kind === "scalar" &&
          (schema.constValue !== undefined ||
            schema.enumValues?.[0] !== undefined)))
    ) {
      value = exampleFor(schema, parameter.name, registry);
    }
  }
  if (value === undefined || value === null) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  return text === "string" ? "" : text.slice(0, MAX_INITIAL);
}

function parameterField(
  parameter: Parameter,
  registry: ApiService["schemas"],
): ParameterField {
  const schema = resolveRef(schemaOf(parameter), registry);
  const { array, kind, options } =
    parameter.valueKind === "content"
      ? { array: false, kind: "json" as const, options: undefined }
      : fieldKind(schema);
  const serialization =
    parameter.valueKind === "schema"
      ? parameter.location === "query"
        ? parameter.serialization
        : parameter.location === "path"
          ? parameter.serialization
          : parameter.location === "header"
            ? { explode: parameter.serialization.explode }
            : { explode: parameter.serialization.explode }
      : parameter.location === "query"
        ? { allowReserved: false, explode: true, style: "form" as const }
        : parameter.location === "path"
          ? { explode: false, style: "simple" as const }
          : { explode: false };
  const unsupported: CapabilityReason | undefined =
    parameter.location === "cookie"
      ? "cookie-parameter"
      : parameter.location === "header" &&
          isForbiddenRequestHeader(parameter.name)
        ? "forbidden-header"
        : undefined;
  return {
    array,
    capability: unsupported === undefined ? "supported" : "unsupported",
    contentTyped: parameter.valueKind === "content",
    deprecated: parameter.deprecated,
    ...(parameter.description === undefined
      ? {}
      : { description: sanitizeLine(parameter.description, 1_000) }),
    initial: initialValue(parameter, registry),
    kind,
    label: sanitizeLine(parameter.name, 120),
    location: parameter.location,
    name: sanitizeLine(parameter.name, 120),
    ...(options === undefined ? {} : { options }),
    ...(unsupported === undefined ? {} : { reason: unsupported }),
    required: parameter.required,
    serialization,
  };
}

function bodyForm(
  content: MediaTypeContent,
  projected: BodyProjection | undefined,
  registry: ApiService["schemas"],
): BodyForm {
  const body = projected ?? projectBody(content, registry);
  const fields: BodyFieldForm[] = [];
  if (body.kind === "form" || body.kind === "multipart") {
    const schema = resolveRef(content.schema, registry);
    const required = new Set(schema?.kind === "object" ? schema.required : []);
    for (const field of body.fields ?? []) {
      fields.push({
        ...(field.contentType === undefined
          ? {}
          : { contentType: field.contentType }),
        file: field.file,
        initial:
          field.file || isSensitiveName(field.name)
            ? ""
            : decodeFormValue(field.value, body.kind),
        name: field.name,
        required: required.has(field.name),
      });
    }
  }
  const initial =
    body.kind === "json"
      ? redactInitial(JSON.stringify(body.json ?? {}, null, 2))
      : body.kind === "text" || body.kind === "opaque"
        ? (body.text ?? "")
        : "";
  return {
    fields,
    initial: initial.slice(0, MAX_BODY_INITIAL),
    kind: body.kind,
    mediaType: body.mediaType,
  };
}

function decodeFormValue(value: string, kind: "form" | "multipart"): string {
  if (kind === "multipart") return value === "string" ? "" : value;
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, " "));
    return decoded === "string" ? "" : decoded;
  } catch {
    return "";
  }
}

/** Placeholders that stand for credentials are cleared so the editor never suggests typing one. */
function redactInitial(text: string): string {
  return text.replace(/"<YOUR_[A-Z0-9_]+>"/g, '""');
}
