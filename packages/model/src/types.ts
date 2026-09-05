export const DOCUMENT_MODEL_VERSION = 1 as const;

type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type ProjectId = Brand<string, "ProjectId">;
export type DocumentationVersionId = Brand<string, "DocumentationVersionId">;
export type ServiceId = Brand<string, "ServiceId">;
export type OperationId = Brand<string, "OperationId">;
export type ParameterId = Brand<string, "ParameterId">;
export type SchemaId = Brand<string, "SchemaId">;
export type SecuritySchemeId = Brand<string, "SecuritySchemeId">;
export type ServerId = Brand<string, "ServerId">;
export type PageId = Brand<string, "PageId">;
export type ExampleId = Brand<string, "ExampleId">;
export type DiagnosticId = Brand<string, "DiagnosticId">;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = Readonly<{ [key: string]: JsonValue }>;

export type HttpMethod =
  "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE";

export interface DocumentationModel {
  readonly modelVersion: typeof DOCUMENT_MODEL_VERSION;
  readonly project: ProjectMetadata;
  /** Explicit release order is presentation-significant and is preserved. */
  readonly versions: readonly DocumentationVersion[];
}

export interface DocumentationArtifact {
  readonly model: DocumentationModel;
  readonly diagnostics: readonly CanonicalDiagnostic[];
}

export type DiagnosticCode =
  | "DUPLICATE_ID"
  | "INVALID_CANONICAL_ID"
  | "INVALID_DIAGNOSTIC"
  | "INVALID_JSON_VALUE"
  | "INVALID_MODEL"
  | "INVALID_PATH_PARAMETER"
  | "INVALID_SCHEMA"
  | "MODEL_LIMIT_EXCEEDED"
  | "MISSING_DIAGNOSTIC"
  | "MISSING_REFERENCE"
  | "MISSING_SECURITY_SCHEME"
  | "MISSING_SERVER"
  | "NON_SERIALIZABLE"
  | "SCHEMA_IGNORED_ANNOTATION"
  | "SCHEMA_INVALID_SEMANTIC"
  | "SCHEMA_PARTIALLY_REPRESENTED"
  | "SCHEMA_UNSUPPORTED_SEMANTIC";

export interface DiagnosticLocation {
  readonly versionId?: DocumentationVersionId;
  readonly serviceId?: ServiceId;
  readonly operationId?: OperationId;
  readonly schemaId?: SchemaId;
  /** Source-independent RFC 6901 pointer into the canonical artifact. */
  readonly path?: string;
}

export interface CanonicalDiagnostic {
  readonly id: DiagnosticId;
  readonly code: DiagnosticCode;
  /** Stable, catalog-owned, value-free text. */
  readonly message: string;
  readonly severity: "error" | "info" | "warning";
  readonly location?: DiagnosticLocation;
}

export interface ModelLimits {
  readonly maxCollectionEntries: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxStringLength: number;
}

export interface ProjectMetadata {
  readonly id: ProjectId;
  readonly name: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
}

export interface DocumentationVersion {
  readonly id: DocumentationVersionId;
  readonly label: string;
  readonly status: "current" | "deprecated" | "preview";
  /** Explicit author/configuration order is preserved. */
  readonly services: readonly ApiService[];
  readonly pages: readonly AuthoredPageMetadata[];
}

export interface ApiService {
  readonly id: ServiceId;
  readonly name: string;
  readonly description?: string;
  /** Contract-declared servers; not executable playground environments. */
  readonly servers: readonly ServerDefinition[];
  readonly securitySchemes: Readonly<Record<string, SecurityScheme>>;
  readonly operations: readonly Operation[];
  /** Schema IDs are keys in this service-owned registry. */
  readonly schemas: Readonly<Record<string, SchemaNode>>;
  readonly extensions: JsonObject;
}

export interface ServerDefinition {
  readonly id: ServerId;
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
  /** Tags are a semantic set and serialize in canonical order. */
  readonly tags: readonly string[];
  /** Parameter order is presentation-significant and is preserved. */
  readonly parameters: readonly Parameter[];
  readonly requestBody?: RequestBody;
  readonly responses: readonly Response[];
  /** Array entries are OR alternatives; schemes within one entry are ANDed. */
  readonly security: readonly SecurityRequirement[];
  readonly serverIds: readonly ServerId[];
  readonly deprecated: boolean;
  readonly extensions: JsonObject;
}

interface ParameterMetadata {
  readonly id: ParameterId;
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

export type ResponseStatus =
  | { readonly kind: "code"; readonly code: number }
  | {
      readonly kind: "range";
      readonly range: "1XX" | "2XX" | "3XX" | "4XX" | "5XX";
    }
  | { readonly kind: "default" };

export interface Response {
  readonly status: ResponseStatus;
  readonly description: string;
  readonly headers: readonly ResponseHeader[];
  /** Empty for 204 and any other body-less response; no schema is fabricated. */
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
  readonly id: ExampleId;
  readonly name: string;
  readonly summary?: string;
  /** `value` and `externalValue` are mutually exclusive. */
  readonly value?: JsonValue;
  readonly externalValue?: string;
}

export interface SecurityRequirement {
  /** Empty means the operation is allowed anonymously for this OR alternative. */
  readonly schemes: readonly SecuritySchemeUse[];
}

export interface SecuritySchemeUse {
  readonly schemeId: SecuritySchemeId;
  readonly scopes: readonly string[];
}

interface SecuritySchemeMetadata {
  readonly description?: string;
}

export type SecurityScheme = SecuritySchemeMetadata &
  (
    | {
        readonly kind: "apiKey";
        readonly name: string;
        readonly location: "cookie" | "header" | "query";
      }
    | {
        readonly kind: "http";
        /** Lower-case IANA/auth scheme token, including `basic` and `bearer`. */
        readonly scheme: string;
        readonly bearerFormat?: string;
      }
    | {
        readonly kind: "oauth2";
        readonly flows: readonly OAuthFlow[];
      }
    | { readonly kind: "openIdConnect"; readonly openIdConnectUrl: string }
    | { readonly kind: "mutualTLS" }
  );

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

export type SchemaInstanceType =
  "array" | "boolean" | "integer" | "null" | "number" | "object" | "string";

export type SchemaNode =
  | AnySchema
  | BooleanSchema
  | ScalarSchema
  | ObjectSchema
  | ArraySchema
  | TupleSchema
  | CompositionSchema
  | ReferenceSchema
  | TypeLessSchema
  | UnknownSchema;

export interface SchemaMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly deprecated?: boolean;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly defaultValue?: JsonValue;
  readonly examples?: readonly JsonValue[];
  readonly diagnosticIds?: readonly DiagnosticId[];
  readonly extensions?: JsonObject;
}

/** Free-form schema: any JSON instance is accepted. */
export interface AnySchema extends SchemaMetadata {
  readonly kind: "any";
}

/** Preserves the explicit JSON Schema `true` and `false` forms. */
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

export interface NumericConstraints {
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly multipleOf?: number;
}

export interface StringConstraints {
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly format?: string;
}

export type ScalarConstraints = NumericConstraints & StringConstraints;

export interface ObjectConstraints {
  readonly minProperties?: number;
  readonly maxProperties?: number;
  readonly properties: Readonly<Record<string, SchemaNode>>;
  /** Explicit source/author display order; must contain every property key once. */
  readonly propertyOrder: readonly string[];
  readonly required: readonly string[];
  readonly additionalProperties: boolean | SchemaNode;
}

export interface ObjectSchema extends SchemaMetadata, ObjectConstraints {
  readonly kind: "object";
}

export interface ArrayConstraints {
  readonly items: SchemaNode;
  readonly contains?: SchemaNode;
  readonly minContains?: number;
  readonly maxContains?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
}

export interface ArraySchema extends SchemaMetadata, ArrayConstraints {
  readonly kind: "array";
}

export interface TupleSchema extends SchemaMetadata {
  readonly kind: "tuple";
  readonly prefixItems: readonly SchemaNode[];
  readonly additionalItems: boolean | SchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export type CompositionSchema = SchemaMetadata &
  (
    | {
        readonly kind: "composition";
        readonly mode: "allOf" | "anyOf" | "oneOf";
        readonly variants: readonly SchemaNode[];
        readonly discriminator?: {
          readonly propertyName: string;
          readonly mapping: Readonly<Record<string, SchemaId>>;
        };
      }
    | {
        readonly kind: "composition";
        readonly mode: "not";
        readonly variants: readonly [SchemaNode];
      }
  );

export interface ReferenceSchema extends SchemaMetadata {
  readonly kind: "ref";
  readonly schemaId: SchemaId;
}

/**
 * Constraints with no declared instance type. Each keyword applies only to its
 * compatible instance types; this node never implies or invents a type.
 */
export interface TypeLessSchema extends SchemaMetadata {
  readonly kind: "type-less";
  readonly applicableTypes: readonly SchemaInstanceType[];
  readonly numeric?: NumericConstraints;
  readonly string?: StringConstraints;
  readonly array?: ArrayConstraints;
  readonly object?: ObjectConstraints;
  readonly constValue?: JsonValue;
  readonly enumValues?: readonly JsonValue[];
}

/** Semantic content could not be represented faithfully; diagnostics explain why. */
export interface UnknownSchema extends SchemaMetadata {
  readonly kind: "unknown";
  readonly reason: "invalid" | "unresolved" | "unsupported";
  readonly diagnosticIds: readonly DiagnosticId[];
}

export interface AuthoredPageMetadata {
  readonly id: PageId;
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
