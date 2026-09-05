import { createDiagnostic } from "./diagnostics.js";
import type {
  ApiService,
  CanonicalDiagnostic,
  DocumentationArtifact,
  DocumentationModel,
  DocumentationVersion,
  JsonObject,
  JsonValue,
  MediaTypeContent,
  ModelLimits,
  Operation,
  Parameter,
  RequestBody,
  Response,
  ResponseHeader,
  SchemaNode,
  SecurityRequirement,
  SecurityScheme,
  ServerDefinition,
} from "./types.js";
import {
  DEFAULT_MODEL_LIMITS,
  hasModelErrors,
  validateDocumentationArtifact,
} from "./validation.js";

const METHOD_RANK = new Map(
  ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"].map(
    (method, index) => [method, index],
  ),
);
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const;

export class CanonicalModelError extends Error {
  public constructor(
    public readonly diagnostics: readonly CanonicalDiagnostic[],
  ) {
    super("Canonical documentation artifact validation failed.");
    this.name = "CanonicalModelError";
  }
}

export function canonicalizeDocumentationArtifact(
  artifact: DocumentationArtifact,
  limits: ModelLimits = DEFAULT_MODEL_LIMITS,
): DocumentationArtifact {
  const diagnostics = validateDocumentationArtifact(artifact, limits);
  if (hasModelErrors(diagnostics)) throw new CanonicalModelError(diagnostics);

  const semanticOrder = {
    diagnostics: artifact.diagnostics
      .map(canonicalDiagnostic)
      .sort(compareDiagnostics),
    model: canonicalModel(artifact.model),
  };
  return deepFreeze(
    sortJsonKeys(semanticOrder) as unknown as DocumentationArtifact,
  );
}

export function serializeDocumentationArtifact(
  artifact: DocumentationArtifact,
  limits: ModelLimits = DEFAULT_MODEL_LIMITS,
): string {
  return JSON.stringify(canonicalizeDocumentationArtifact(artifact, limits));
}

export function parseDocumentationArtifact(
  serialized: string,
  limits: ModelLimits = DEFAULT_MODEL_LIMITS,
): DocumentationArtifact {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new CanonicalModelError([
      createDiagnostic({ code: "INVALID_MODEL", location: { path: "/" } }),
    ]);
  }
  const diagnostics = validateDocumentationArtifact(value, limits);
  if (hasModelErrors(diagnostics)) throw new CanonicalModelError(diagnostics);
  return canonicalizeDocumentationArtifact(
    value as DocumentationArtifact,
    limits,
  );
}

function canonicalModel(model: DocumentationModel): DocumentationModel {
  return {
    modelVersion: model.modelVersion,
    project: {
      ...model.project,
    },
    versions: model.versions.map(canonicalVersion),
  };
}

function canonicalVersion(version: DocumentationVersion): DocumentationVersion {
  return {
    ...version,
    pages: version.pages.map((page) => ({
      ...page,
      headings: page.headings.map((heading) => ({ ...heading })),
    })),
    services: version.services.map(canonicalService),
  };
}

function canonicalService(service: ApiService): ApiService {
  return {
    ...service,
    extensions: canonicalJson(service.extensions) as JsonObject,
    operations: service.operations
      .map(canonicalOperation)
      .sort(
        (left, right) =>
          compareText(left.path, right.path) ||
          (METHOD_RANK.get(left.method) ?? 99) -
            (METHOD_RANK.get(right.method) ?? 99) ||
          compareText(left.id, right.id),
      ),
    schemas: sortRecord(service.schemas, canonicalSchema),
    securitySchemes: sortRecord(
      service.securitySchemes,
      canonicalSecurityScheme,
    ),
    servers: service.servers.map(canonicalServer),
  };
}

function canonicalServer(server: ServerDefinition): ServerDefinition {
  return {
    ...server,
    variables: sortRecord(server.variables, (variable) => ({
      ...variable,
      allowedValues: [...variable.allowedValues],
    })),
  };
}

function canonicalOperation(operation: Operation): Operation {
  return {
    ...operation,
    extensions: canonicalJson(operation.extensions) as JsonObject,
    parameters: operation.parameters.map(canonicalParameter),
    ...(operation.requestBody === undefined
      ? {}
      : { requestBody: canonicalRequestBody(operation.requestBody) }),
    responses: operation.responses
      .map(canonicalResponse)
      .sort(compareResponses),
    security: operation.security
      .map(canonicalSecurityRequirement)
      .sort((left, right) =>
        compareText(securityKey(left), securityKey(right)),
      ),
    serverIds: [...operation.serverIds].sort(compareText),
    tags: [...operation.tags].sort(compareNormalizedText),
  };
}

function canonicalParameter(parameter: Parameter): Parameter {
  const base = {
    ...parameter,
    examples: parameter.examples.map(canonicalExample),
  };
  return parameter.valueKind === "schema"
    ? ({ ...base, schema: canonicalSchema(parameter.schema) } as Parameter)
    : ({ ...base, content: canonicalMedia(parameter.content) } as Parameter);
}

function canonicalRequestBody(requestBody: RequestBody): RequestBody {
  return {
    ...requestBody,
    content: requestBody.content.map(canonicalMedia).sort(compareMedia),
  };
}

function canonicalMedia(media: MediaTypeContent): MediaTypeContent {
  return {
    ...media,
    examples: media.examples.map(canonicalExample),
    ...(media.schema === undefined
      ? {}
      : { schema: canonicalSchema(media.schema) }),
  };
}

function canonicalExample<T extends { readonly value?: JsonValue }>(
  example: T,
): T {
  return {
    ...example,
    ...(example.value === undefined
      ? {}
      : { value: canonicalJson(example.value) }),
  };
}

function canonicalResponse(response: Response): Response {
  return {
    ...response,
    bodies: response.bodies.map(canonicalMedia).sort(compareMedia),
    headers: response.headers
      .map(canonicalHeader)
      .sort((left, right) =>
        compareText(left.name.toLowerCase(), right.name.toLowerCase()),
      ),
  };
}

function canonicalHeader(header: ResponseHeader): ResponseHeader {
  const base = { ...header, examples: header.examples.map(canonicalExample) };
  return header.valueKind === "schema"
    ? ({ ...base, schema: canonicalSchema(header.schema) } as ResponseHeader)
    : ({ ...base, content: canonicalMedia(header.content) } as ResponseHeader);
}

function canonicalSecurityRequirement(
  requirement: SecurityRequirement,
): SecurityRequirement {
  return {
    schemes: requirement.schemes
      .map((use) => ({ ...use, scopes: [...use.scopes].sort(compareText) }))
      .sort((left, right) => compareText(left.schemeId, right.schemeId)),
  };
}

function canonicalSecurityScheme(scheme: SecurityScheme): SecurityScheme {
  if (scheme.kind !== "oauth2") return { ...scheme };
  return {
    ...scheme,
    flows: scheme.flows
      .map((flow) => ({
        ...flow,
        scopes: sortRecord(flow.scopes, (description) => description),
      }))
      .sort((left, right) => compareText(left.kind, right.kind)),
  };
}

function canonicalSchema(schema: SchemaNode): SchemaNode {
  const metadata = {
    ...schema,
    ...(schema.defaultValue === undefined
      ? {}
      : { defaultValue: canonicalJson(schema.defaultValue) }),
    ...(schema.examples === undefined
      ? {}
      : { examples: schema.examples.map(canonicalJson) }),
    ...(schema.diagnosticIds === undefined
      ? {}
      : { diagnosticIds: [...schema.diagnosticIds].sort(compareText) }),
    ...(schema.extensions === undefined
      ? {}
      : { extensions: canonicalJson(schema.extensions) as JsonObject }),
  };
  switch (schema.kind) {
    case "any":
    case "boolean-schema":
    case "ref":
    case "unknown":
      return metadata as SchemaNode;
    case "scalar":
      return {
        ...metadata,
        ...(schema.constValue === undefined
          ? {}
          : { constValue: canonicalJson(schema.constValue) }),
        ...(schema.enumValues === undefined
          ? {}
          : { enumValues: schema.enumValues.map(canonicalJson) }),
      } as SchemaNode;
    case "object":
      return {
        ...metadata,
        additionalProperties:
          typeof schema.additionalProperties === "boolean"
            ? schema.additionalProperties
            : canonicalSchema(schema.additionalProperties),
        properties: sortRecord(schema.properties, canonicalSchema),
        propertyOrder: [...schema.propertyOrder],
        required: [...schema.required],
      } as SchemaNode;
    case "array":
      return {
        ...metadata,
        ...(schema.contains === undefined
          ? {}
          : { contains: canonicalSchema(schema.contains) }),
        items: canonicalSchema(schema.items),
      } as SchemaNode;
    case "tuple":
      return {
        ...metadata,
        additionalItems:
          typeof schema.additionalItems === "boolean"
            ? schema.additionalItems
            : canonicalSchema(schema.additionalItems),
        prefixItems: schema.prefixItems.map(canonicalSchema),
      } as SchemaNode;
    case "composition":
      if (schema.mode === "not") {
        return {
          ...metadata,
          mode: "not",
          variants: [canonicalSchema(schema.variants[0])],
        } as SchemaNode;
      }
      return {
        ...metadata,
        ...(schema.discriminator === undefined
          ? {}
          : {
              discriminator: {
                ...schema.discriminator,
                mapping: sortRecord(
                  schema.discriminator.mapping,
                  (value) => value,
                ),
              },
            }),
        variants: schema.variants.map(canonicalSchema),
      } as SchemaNode;
    case "type-less":
      return {
        ...metadata,
        applicableTypes: [...schema.applicableTypes].sort(compareText),
        ...(schema.array === undefined
          ? {}
          : {
              array: {
                ...schema.array,
                ...(schema.array.contains === undefined
                  ? {}
                  : { contains: canonicalSchema(schema.array.contains) }),
                items: canonicalSchema(schema.array.items),
              },
            }),
        ...(schema.constValue === undefined
          ? {}
          : { constValue: canonicalJson(schema.constValue) }),
        ...(schema.enumValues === undefined
          ? {}
          : { enumValues: schema.enumValues.map(canonicalJson) }),
        ...(schema.object === undefined
          ? {}
          : {
              object: {
                ...schema.object,
                additionalProperties:
                  typeof schema.object.additionalProperties === "boolean"
                    ? schema.object.additionalProperties
                    : canonicalSchema(schema.object.additionalProperties),
                properties: sortRecord(
                  schema.object.properties,
                  canonicalSchema,
                ),
                propertyOrder: [...schema.object.propertyOrder],
                required: [...schema.object.required],
              },
            }),
      } as SchemaNode;
  }
}

function canonicalDiagnostic(
  diagnostic: CanonicalDiagnostic,
): CanonicalDiagnostic {
  return {
    ...diagnostic,
    ...(diagnostic.location === undefined
      ? {}
      : { location: { ...diagnostic.location } }),
  };
}

function canonicalJson(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return sortRecord(value, canonicalJson);
  }
  return value;
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, item]) => [key, sortJsonKeys(item)]),
    );
  }
  return value;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function sortRecord<T, U>(
  value: Readonly<Record<string, T>>,
  map: (item: T) => U,
): Readonly<Record<string, U>> {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, item]) => [key, map(item)]),
  );
}

function compareMedia(left: MediaTypeContent, right: MediaTypeContent): number {
  return compareText(
    left.mediaType.toLowerCase(),
    right.mediaType.toLowerCase(),
  );
}

function compareResponses(left: Response, right: Response): number {
  return (
    responseRank(left) - responseRank(right) ||
    compareText(responseKey(left), responseKey(right))
  );
}

function responseRank(response: Response): number {
  if (response.status.kind === "code") return response.status.code;
  if (response.status.kind === "range")
    return Number(response.status.range[0]) * 100 + 99.5;
  return 1_000;
}

function responseKey(response: Response): string {
  if (response.status.kind === "code") return `code:${response.status.code}`;
  if (response.status.kind === "range") return `range:${response.status.range}`;
  return "default";
}

function securityKey(requirement: SecurityRequirement): string {
  return requirement.schemes
    .map((use) => `${use.schemeId}:${use.scopes.join(",")}`)
    .join("|");
}

function compareDiagnostics(
  left: CanonicalDiagnostic,
  right: CanonicalDiagnostic,
): number {
  return (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
    compareText(left.code, right.code) ||
    compareText(left.location?.path ?? "", right.location?.path ?? "") ||
    compareText(left.id, right.id)
  );
}

function compareNormalizedText(left: string, right: string): number {
  return (
    compareText(
      left.normalize("NFC").toLowerCase(),
      right.normalize("NFC").toLowerCase(),
    ) || compareText(left, right)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  const stack: object[] = [];
  if (value !== null && typeof value === "object") stack.push(value);
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || Object.isFrozen(current)) continue;
    Object.values(current).forEach((child) => {
      if (child !== null && typeof child === "object") stack.push(child);
    });
    Object.freeze(current);
  }
  return value;
}
