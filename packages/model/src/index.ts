export const DOCUMENT_MODEL_VERSION = 1 as const;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export type OperationId = string & { readonly __brand: "OperationId" };
export type SchemaId = string & { readonly __brand: "SchemaId" };
export type SecuritySchemeId = string & {
  readonly __brand: "SecuritySchemeId";
};

export type HttpMethod =
  "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE";

export interface DocumentationModel {
  readonly modelVersion: typeof DOCUMENT_MODEL_VERSION;
  readonly project: ProjectMetadata;
  readonly versions: readonly DocumentationVersion[];
}

export interface DocumentationArtifact {
  readonly model: DocumentationModel;
  readonly diagnostics: readonly NormalizationDiagnostic[];
}

export interface NormalizationDiagnostic {
  readonly id: string;
  readonly code: string;
  readonly message: string;
  readonly severity: "error" | "warning";
  readonly sourcePointer?: string;
  readonly modelPointer?: string;
}

export interface ProjectMetadata {
  readonly name: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
}

export interface DocumentationVersion {
  readonly id: string;
  readonly label: string;
  readonly status: "current" | "deprecated" | "preview";
  readonly services: readonly ApiService[];
  readonly pages: readonly AuthoredPageMetadata[];
}

export interface ApiService {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly servers: readonly ServerDefinition[];
  readonly securitySchemes: Readonly<Record<string, SecurityScheme>>;
  readonly operations: readonly Operation[];
  readonly schemas: Readonly<Record<string, SchemaNode>>;
  readonly extensions: JsonObject;
}

export interface ServerDefinition {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly description?: string;
  readonly variables: Readonly<Record<string, ServerVariable>>;
}

export interface ServerVariable {
  readonly defaultValue: string;
  readonly allowedValues: readonly string[];
  readonly description?: string;
}

export interface Operation {
  readonly id: OperationId;
  readonly method: HttpMethod;
  readonly path: string;
  readonly title: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly parameters: readonly Parameter[];
  readonly requestBody?: RequestBody;
  readonly responses: readonly Response[];
  readonly security: readonly SecurityRequirement[];
  readonly serverIds: readonly string[];
  readonly deprecated: boolean;
  readonly extensions: JsonObject;
}

interface ParameterMetadata {
  readonly id: string;
  readonly name: string;
  readonly location: "cookie" | "header" | "path" | "query";
  readonly description?: string;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly examples: readonly Example[];
}

export type Parameter = ParameterMetadata &
  (
    | {
        readonly valueKind: "schema";
        readonly schema: SchemaNode;
        readonly serialization: ParameterSerialization;
      }
    | {
        readonly valueKind: "content";
        readonly content: MediaTypeContent;
      }
  );

export interface ParameterSerialization {
  readonly style:
    | "deepObject"
    | "form"
    | "label"
    | "matrix"
    | "pipeDelimited"
    | "simple"
    | "spaceDelimited";
  readonly explode: boolean;
  readonly allowReserved: boolean;
}

export interface RequestBody {
  readonly description?: string;
  readonly required: boolean;
  readonly content: readonly MediaTypeContent[];
}

export interface MediaTypeContent {
  readonly mediaType: string;
  readonly schema?: SchemaNode;
  readonly examples: readonly Example[];
}

export interface Response {
  readonly status: string;
  readonly description: string;
  readonly headers: readonly ResponseHeader[];
  readonly bodies: readonly MediaTypeContent[];
}

interface ResponseHeaderMetadata {
  readonly name: string;
  readonly description?: string;
  readonly deprecated: boolean;
  readonly examples: readonly Example[];
}

export type ResponseHeader = ResponseHeaderMetadata &
  (
    | {
        readonly valueKind: "schema";
        readonly schema: SchemaNode;
        readonly serialization: Pick<
          ParameterSerialization,
          "explode" | "style"
        >;
      }
    | {
        readonly valueKind: "content";
        readonly content: MediaTypeContent;
      }
  );

export interface Example {
  readonly name: string;
  readonly summary?: string;
  readonly value?: JsonValue;
  readonly externalValue?: string;
}

export interface SecurityRequirement {
  /** Schemes in one requirement are ANDed; requirement array entries are OR alternatives. */
  readonly schemes: readonly SecuritySchemeUse[];
}

export interface SecuritySchemeUse {
  readonly schemeId: SecuritySchemeId;
  readonly scopes: readonly string[];
}

export type SecurityScheme =
  | {
      readonly kind: "apiKey";
      readonly name: string;
      readonly location: "cookie" | "header" | "query";
      readonly description?: string;
    }
  | {
      readonly kind: "http";
      readonly scheme: string;
      readonly bearerFormat?: string;
    }
  | {
      readonly kind: "oauth2";
      readonly flows: readonly OAuthFlow[];
    }
  | { readonly kind: "openIdConnect"; readonly openIdConnectUrl: string }
  | { readonly kind: "mutualTLS" };

interface OAuthFlowBase {
  readonly refreshUrl?: string;
  readonly scopes: Readonly<Record<string, string>>;
}

export type OAuthFlow =
  | (OAuthFlowBase & {
      readonly kind: "implicit";
      readonly authorizationUrl: string;
    })
  | (OAuthFlowBase & { readonly kind: "password"; readonly tokenUrl: string })
  | (OAuthFlowBase & {
      readonly kind: "clientCredentials";
      readonly tokenUrl: string;
    })
  | (OAuthFlowBase & {
      readonly kind: "authorizationCode";
      readonly authorizationUrl: string;
      readonly tokenUrl: string;
    });

export type SchemaNode =
  | BooleanSchema
  | ScalarSchema
  | ObjectSchema
  | ArraySchema
  | TupleSchema
  | CompositionSchema
  | ReferenceSchema
  | UnknownSchema;

interface SchemaMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly defaultValue?: JsonValue;
  readonly examples?: readonly JsonValue[];
  readonly extensions?: JsonObject;
}

export interface BooleanSchema extends SchemaMetadata {
  readonly kind: "boolean-schema";
  readonly accepts: boolean;
}

export interface ScalarSchema extends SchemaMetadata {
  readonly kind: "scalar";
  readonly type: "boolean" | "integer" | "null" | "number" | "string";
  readonly format?: string;
  readonly constValue?: JsonValue;
  readonly enumValues?: readonly JsonValue[];
  readonly constraints?: ScalarConstraints;
}

export interface ScalarConstraints {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

export interface ObjectSchema extends SchemaMetadata {
  readonly kind: "object";
  readonly properties: Readonly<Record<string, SchemaNode>>;
  readonly required: readonly string[];
  readonly additionalProperties: boolean | SchemaNode;
}

export interface ArraySchema extends SchemaMetadata {
  readonly kind: "array";
  readonly items: SchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
}

export interface TupleSchema extends SchemaMetadata {
  readonly kind: "tuple";
  readonly prefixItems: readonly SchemaNode[];
  readonly additionalItems: boolean | SchemaNode;
}

export interface CompositionSchema extends SchemaMetadata {
  readonly kind: "composition";
  readonly mode: "allOf" | "anyOf" | "oneOf";
  readonly variants: readonly SchemaNode[];
  readonly discriminator?: {
    readonly propertyName: string;
    readonly mapping: Readonly<Record<string, SchemaId>>;
  };
}

export interface ReferenceSchema extends SchemaMetadata {
  readonly kind: "ref";
  readonly schemaId: SchemaId;
}

export interface UnknownSchema extends SchemaMetadata {
  readonly kind: "unknown";
  readonly reason: "unsupported" | "unresolved" | "invalid";
  readonly diagnosticIds: readonly string[];
}

export interface AuthoredPageMetadata {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description?: string;
  readonly headings: readonly {
    readonly depth: number;
    readonly id: string;
    readonly text: string;
  }[];
  readonly sourcePath: string;
}

export interface ModelDiagnostic {
  readonly code:
    | "DUPLICATE_ID"
    | "INVALID_JSON_VALUE"
    | "INVALID_PATH_PARAMETER"
    | "MODEL_LIMIT_EXCEEDED"
    | "MISSING_REFERENCE"
    | "MISSING_SECURITY_SCHEME"
    | "MISSING_SERVER"
    | "NON_SERIALIZABLE";
  readonly message: string;
  readonly pointer: string;
  readonly severity: "error" | "warning";
}

export function validateDocumentationModel(
  model: DocumentationModel,
): readonly ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = [];
  validateSerializableStructure(model, diagnostics);

  for (const [versionIndex, version] of model.versions.entries()) {
    for (const [serviceIndex, service] of version.services.entries()) {
      const basePointer = `/versions/${versionIndex}/services/${serviceIndex}`;
      const schemaIds = new Set(Object.keys(service.schemas));
      const securitySchemeIds = new Set(Object.keys(service.securitySchemes));
      const serverIds = new Set(service.servers.map((server) => server.id));
      const operationIds = new Set<string>();

      for (const [schemaIndex, schema] of Object.values(
        service.schemas,
      ).entries()) {
        collectMissingReferences(
          schema,
          schemaIds,
          `${basePointer}/schemas/${schemaIndex}`,
          diagnostics,
        );
      }

      for (const [operationIndex, operation] of service.operations.entries()) {
        const pointer = `${basePointer}/operations/${operationIndex}`;
        if (operationIds.has(operation.id)) {
          diagnostics.push({
            code: "DUPLICATE_ID",
            message: "Operation id is not unique within its versioned service.",
            pointer: `${pointer}/id`,
            severity: "error",
          });
        }
        operationIds.add(operation.id);

        for (const [
          parameterIndex,
          parameter,
        ] of operation.parameters.entries()) {
          if (parameter.location === "path" && !parameter.required) {
            diagnostics.push({
              code: "INVALID_PATH_PARAMETER",
              message: "A path parameter must be required.",
              pointer: `${pointer}/parameters/${parameterIndex}/required`,
              severity: "error",
            });
          }
          if (
            parameter.location === "path" &&
            !operation.path.includes(`{${parameter.name}}`)
          ) {
            diagnostics.push({
              code: "INVALID_PATH_PARAMETER",
              message:
                "A documented path parameter is absent from the path template.",
              pointer: `${pointer}/parameters/${parameterIndex}/name`,
              severity: "error",
            });
          }
          const parameterSchema =
            parameter.valueKind === "schema"
              ? parameter.schema
              : parameter.content.schema;
          if (parameterSchema !== undefined) {
            collectMissingReferences(
              parameterSchema,
              schemaIds,
              `${pointer}/parameters/${parameterIndex}/schema`,
              diagnostics,
            );
          }
        }

        for (const match of operation.path.matchAll(/\{([^{}]+)\}/g)) {
          const name = match[1];
          if (
            name !== undefined &&
            !operation.parameters.some(
              (parameter) =>
                parameter.location === "path" && parameter.name === name,
            )
          ) {
            diagnostics.push({
              code: "INVALID_PATH_PARAMETER",
              message: "A path template parameter is not documented.",
              pointer: `${pointer}/parameters`,
              severity: "error",
            });
          }
        }

        operation.requestBody?.content.forEach((body, bodyIndex) => {
          if (body.schema !== undefined) {
            collectMissingReferences(
              body.schema,
              schemaIds,
              `${pointer}/requestBody/content/${bodyIndex}/schema`,
              diagnostics,
            );
          }
        });

        operation.responses.forEach((response, responseIndex) => {
          response.headers.forEach((header, headerIndex) => {
            const headerSchema =
              header.valueKind === "schema"
                ? header.schema
                : header.content.schema;
            if (headerSchema !== undefined) {
              collectMissingReferences(
                headerSchema,
                schemaIds,
                `${pointer}/responses/${responseIndex}/headers/${headerIndex}/schema`,
                diagnostics,
              );
            }
          });
          response.bodies.forEach((body, bodyIndex) => {
            if (body.schema !== undefined) {
              collectMissingReferences(
                body.schema,
                schemaIds,
                `${pointer}/responses/${responseIndex}/bodies/${bodyIndex}/schema`,
                diagnostics,
              );
            }
          });
        });

        operation.security.forEach((requirement, requirementIndex) => {
          requirement.schemes.forEach((scheme, schemeIndex) => {
            if (!securitySchemeIds.has(scheme.schemeId)) {
              diagnostics.push({
                code: "MISSING_SECURITY_SCHEME",
                message: "A security requirement refers to an unknown scheme.",
                pointer: `${pointer}/security/${requirementIndex}/schemes/${schemeIndex}/schemeId`,
                severity: "error",
              });
            }
          });
        });

        operation.serverIds.forEach((serverId, serverIndex) => {
          if (!serverIds.has(serverId)) {
            diagnostics.push({
              code: "MISSING_SERVER",
              message: "An operation refers to an unknown server.",
              pointer: `${pointer}/serverIds/${serverIndex}`,
              severity: "error",
            });
          }
        });
      }
    }
  }

  return diagnostics;
}

function collectMissingReferences(
  schema: SchemaNode,
  knownIds: ReadonlySet<string>,
  pointer: string,
  diagnostics: ModelDiagnostic[],
): void {
  const stack: { readonly pointer: string; readonly schema: SchemaNode }[] = [
    { pointer, schema },
  ];
  const visited = new WeakSet<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (visited.has(current.schema)) continue;
    visited.add(current.schema);

    if (current.schema.kind === "ref") {
      if (!knownIds.has(current.schema.schemaId)) {
        diagnostics.push({
          code: "MISSING_REFERENCE",
          message: "A schema reference does not exist in the service registry.",
          pointer: current.pointer,
          severity: "error",
        });
      }
      continue;
    }
    if (current.schema.kind === "array") {
      stack.push({
        pointer: `${current.pointer}/items`,
        schema: current.schema.items,
      });
      continue;
    }
    if (current.schema.kind === "tuple") {
      current.schema.prefixItems.forEach((item, index) => {
        stack.push({
          pointer: `${current.pointer}/prefixItems/${index}`,
          schema: item,
        });
      });
      if (typeof current.schema.additionalItems !== "boolean") {
        stack.push({
          pointer: `${current.pointer}/additionalItems`,
          schema: current.schema.additionalItems,
        });
      }
      continue;
    }
    if (current.schema.kind === "composition") {
      current.schema.variants.forEach((variant, index) => {
        stack.push({
          pointer: `${current.pointer}/variants/${index}`,
          schema: variant,
        });
      });
      if (current.schema.discriminator !== undefined) {
        for (const [mappingIndex, schemaId] of Object.values(
          current.schema.discriminator.mapping,
        ).entries()) {
          if (!knownIds.has(schemaId)) {
            diagnostics.push({
              code: "MISSING_REFERENCE",
              message: "A discriminator mapping refers to an unknown schema.",
              pointer: `${current.pointer}/discriminator/mapping/${mappingIndex}`,
              severity: "error",
            });
          }
        }
      }
      continue;
    }
    if (current.schema.kind === "object") {
      for (const [propertyIndex, property] of Object.values(
        current.schema.properties,
      ).entries()) {
        stack.push({
          pointer: `${current.pointer}/properties/${propertyIndex}`,
          schema: property,
        });
      }
      if (typeof current.schema.additionalProperties !== "boolean") {
        stack.push({
          pointer: `${current.pointer}/additionalProperties`,
          schema: current.schema.additionalProperties,
        });
      }
    }
  }
}

function validateSerializableStructure(
  model: DocumentationModel,
  diagnostics: ModelDiagnostic[],
): void {
  const active = new WeakSet<object>();
  const stack: { readonly leaving: boolean; readonly value: unknown }[] = [
    { leaving: false, value: model },
  ];
  let nodeCount = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const value = current.value;

    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || Object.is(value, -0))
    ) {
      addOnce(diagnostics, {
        code: "INVALID_JSON_VALUE",
        message:
          "The model contains a numeric value without stable JSON semantics.",
        pointer: "/",
        severity: "error",
      });
      continue;
    }
    if (typeof value === "string" && value.length > 1_000_000) {
      addOnce(diagnostics, {
        code: "MODEL_LIMIT_EXCEEDED",
        message: "The model contains a string beyond the serialization budget.",
        pointer: "/",
        severity: "error",
      });
      continue;
    }
    if (
      value === undefined ||
      typeof value === "bigint" ||
      typeof value === "function" ||
      typeof value === "symbol"
    ) {
      addOnce(diagnostics, {
        code: "NON_SERIALIZABLE",
        message: "The model contains a value that JSON cannot serialize.",
        pointer: "/",
        severity: "error",
      });
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    if (current.leaving) {
      active.delete(value);
      continue;
    }
    if (active.has(value)) {
      addOnce(diagnostics, {
        code: "NON_SERIALIZABLE",
        message:
          "The model contains an inline object cycle; use registry references.",
        pointer: "/",
        severity: "error",
      });
      continue;
    }
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype
    ) {
      addOnce(diagnostics, {
        code: "NON_SERIALIZABLE",
        message: "The model contains a non-plain object.",
        pointer: "/",
        severity: "error",
      });
      continue;
    }

    nodeCount += 1;
    if (nodeCount > 500_000) {
      addOnce(diagnostics, {
        code: "MODEL_LIMIT_EXCEEDED",
        message: "The model exceeds the serialization node budget.",
        pointer: "/",
        severity: "error",
      });
      return;
    }
    active.add(value);
    stack.push({ leaving: true, value });
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      stack.push({ leaving: false, value: child });
    }
  }
}

function addOnce(
  diagnostics: ModelDiagnostic[],
  diagnostic: ModelDiagnostic,
): void {
  if (!diagnostics.some((existing) => existing.code === diagnostic.code)) {
    diagnostics.push(diagnostic);
  }
}
