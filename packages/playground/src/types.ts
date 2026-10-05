import type { HttpMethod } from "@specra/model";
import type {
  AuthSchemeKind,
  BodyKind,
  PathSerialization,
  QuerySerialization,
} from "@specra/snippets/protocol";

/**
 * SPEC-009 contracts. The build projects each canonical operation into a
 * bounded, source-independent request form and analyses whether a browser
 * can execute it; the reader's playground island turns the form plus the
 * user's values into exactly one fetch against an approved exact origin.
 * Nothing here carries a credential or a parser object.
 */

export const PLAYGROUND_FORMAT_VERSION = 1 as const;
export const PLAYGROUND_ARTIFACT_FILENAME = "playground.json";

/** An environment approved for live execution: an exact origin plus base path. */
export interface PlaygroundEnvironment {
  readonly id: string;
  readonly label: string;
  /** `scheme://host[:port]`, no path, no trailing slash. */
  readonly origin: string;
  /** Validated base URL (origin plus optional base path), no trailing slash. */
  readonly baseUrl: string;
  /** Loopback HTTP environments are useful locally and are flagged for the UI. */
  readonly loopback: boolean;
}

/** Centralized limits (SPEC-009 §152); every value is bounded at build time. */
export interface PlaygroundLimits {
  readonly timeoutMs: number;
  readonly responseBytes: number;
  readonly urlLength: number;
  readonly headerValueLength: number;
  readonly headerCount: number;
  readonly bodyBytes: number;
  readonly fileBytes: number;
  readonly parameterLength: number;
  readonly responseHeaderCount: number;
  readonly responseHeaderValueLength: number;
}

export const PLAYGROUND_HARD_LIMITS: PlaygroundLimits = {
  bodyBytes: 4 * 1_048_576,
  fileBytes: 4 * 1_048_576,
  headerCount: 32,
  headerValueLength: 4_096,
  parameterLength: 2_048,
  responseBytes: 4 * 1_048_576,
  responseHeaderCount: 64,
  responseHeaderValueLength: 2_048,
  timeoutMs: 120_000,
  urlLength: 8_192,
};

export type FieldKind =
  "boolean" | "enum" | "integer" | "json" | "number" | "string";

/** A parameter input: identity, location, semantics, and the shared serialization. */
export interface ParameterField {
  readonly name: string;
  readonly location: "cookie" | "header" | "path" | "query";
  readonly label: string;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly description?: string;
  readonly kind: FieldKind;
  /** Enum members for `enum` fields, as text. */
  readonly options?: readonly string[];
  /** The value the form starts with (the code example's value, or empty). */
  readonly initial: string;
  /** Arrays and objects are entered as JSON text and serialized by style. */
  readonly array: boolean;
  readonly serialization:
    PathSerialization | QuerySerialization | { readonly explode: boolean };
  /** Content-typed parameters carry a JSON document as their value. */
  readonly contentTyped: boolean;
  /** Browser capability of this specific parameter. */
  readonly capability: "supported" | "unsupported";
  readonly reason?: CapabilityReason;
}

export interface BodyFieldForm {
  readonly name: string;
  readonly required: boolean;
  readonly file: boolean;
  readonly contentType?: string;
  readonly initial: string;
}

export interface BodyForm {
  readonly mediaType: string;
  readonly kind: BodyKind;
  /** Initial editor text for json/text/opaque bodies. */
  readonly initial: string;
  /** Fields for form/multipart bodies. */
  readonly fields: readonly BodyFieldForm[];
}

export type CapabilityReason =
  | "auth-basic-requires-credentials"
  | "auth-cookie-api-key"
  | "auth-mutual-tls"
  | "auth-query-api-key"
  | "auth-unsupported-scheme"
  | "cookie-parameter"
  | "forbidden-header"
  | "no-environment";

export interface AuthSchemeForm {
  readonly kind: AuthSchemeKind;
  /** Header/query/cookie name for API keys; the scheme token for `httpOther`. */
  readonly name?: string;
  readonly label: string;
  readonly scopes: readonly string[];
  readonly supported: boolean;
  readonly reason?: CapabilityReason;
}

/** One OR alternative; executable only if every AND-joined scheme is supported. */
export interface AuthAlternativeForm {
  readonly label: string;
  readonly schemes: readonly AuthSchemeForm[];
  readonly supported: boolean;
}

export type CapabilityState = "executable" | "partial" | "unsupported";

export interface OperationCapability {
  readonly state: CapabilityState;
  readonly reasons: readonly CapabilityReason[];
}

export interface OperationForm {
  readonly method: HttpMethod;
  readonly pathTemplate: string;
  readonly parameters: readonly ParameterField[];
  readonly bodies: readonly BodyForm[];
  readonly bodyRequired: boolean;
  readonly auth: readonly AuthAlternativeForm[];
  readonly capability: OperationCapability;
  readonly responseKind: "json" | "none" | "text";
}

export interface PlaygroundArtifact {
  readonly playgroundVersion: typeof PLAYGROUND_FORMAT_VERSION;
  /** False when the project did not opt in; the reader then shows no Try it. */
  readonly enabled: boolean;
  readonly environments: readonly PlaygroundEnvironment[];
  readonly limits: PlaygroundLimits;
  /** Keyed like `snippets.json`: `<service id>~<operation id>`. */
  readonly operations: Readonly<Record<string, OperationForm>>;
}

/** Headers that browser Fetch controls or forbids (Fetch standard forbidden request headers). */
export const FORBIDDEN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
]);

export function isForbiddenRequestHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    FORBIDDEN_REQUEST_HEADERS.has(lower) ||
    lower.startsWith("proxy-") ||
    lower.startsWith("sec-")
  );
}

export const CAPABILITY_MESSAGES: Readonly<Record<CapabilityReason, string>> = {
  "auth-basic-requires-credentials":
    "Basic authentication needs a username and password.",
  "auth-cookie-api-key":
    "This API key travels in a cookie, which browser JavaScript cannot set.",
  "auth-mutual-tls":
    "This operation requires a client certificate (mutual TLS) that the Specra playground does not manage.",
  "auth-query-api-key":
    "This authentication method places credentials in the URL and is disabled in the browser playground.",
  "auth-unsupported-scheme":
    "This HTTP authentication scheme cannot be produced in the browser.",
  "cookie-parameter":
    "This request requires a Cookie header, which browser JavaScript cannot set.",
  "forbidden-header":
    "This request requires a header that browsers do not allow scripts to set.",
  "no-environment": "No live playground environment is configured.",
};
