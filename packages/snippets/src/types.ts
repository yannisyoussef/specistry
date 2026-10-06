import type { HttpMethod, JsonValue } from "@specistry/model";

/**
 * SPEC-008 contracts. Two data paths share this module but never share
 * semantic authority: generated protocol examples are projected from the
 * canonical operation only; SDK examples are authored by the consumer and
 * carried through unchanged. Nothing here executes, fetches, or stores a
 * credential; every value that can appear in generated code is a placeholder
 * or documentation data that has passed the projection's sanitizer.
 */

export const SNIPPETS_FORMAT_VERSION = 1 as const;
export const SNIPPETS_ARTIFACT_FILENAME = "snippets.json";

/** The six protocol languages, in presentation order. */
export const PROTOCOL_LANGUAGES = [
  "curl",
  "http",
  "javascript",
  "typescript",
  "java",
  "python",
] as const;

export type ProtocolLanguage = (typeof PROTOCOL_LANGUAGES)[number];

export const PROTOCOL_LANGUAGE_LABELS: Readonly<
  Record<ProtocolLanguage, string>
> = {
  curl: "cURL",
  http: "HTTP",
  java: "Java",
  javascript: "JavaScript",
  python: "Python",
  typescript: "TypeScript",
};

/** Token classes match the reader's `tok-*` code-surface classes. */
export type SnippetTokenClass =
  "attr" | "cmt" | "fn" | "kw" | "num" | "str" | "tag" | "type" | "var";

export interface SnippetToken {
  readonly text: string;
  readonly cls?: SnippetTokenClass;
}

/** One generated example: the text to copy and the tokens to render. */
export interface Snippet {
  readonly language: ProtocolLanguage;
  readonly label: string;
  readonly code: string;
  readonly lines: readonly (readonly SnippetToken[])[];
}

/**
 * A serialized name/value pair. Names and values have already been
 * sanitized (no control characters) and, for query pairs, percent-encoded;
 * placeholders keep their `<NAME>` spelling so readers recognise them.
 */
export interface Pair {
  readonly name: string;
  readonly value: string;
}

export type BodyKind =
  "binary" | "form" | "json" | "multipart" | "opaque" | "text";

export interface FormField {
  readonly name: string;
  /** Serialized value; for file parts the placeholder path. */
  readonly value: string;
  readonly file: boolean;
  /** Part content type from the encoding, when declared. */
  readonly contentType?: string;
}

/** A representative request body for one media type. */
export interface BodyProjection {
  readonly mediaType: string;
  readonly kind: BodyKind;
  /** `json`: the representative value. */
  readonly json?: JsonValue;
  /** `form` and `multipart`: fields in schema order. */
  readonly fields?: readonly FormField[];
  /** `text` and `opaque`: the literal text. */
  readonly text?: string;
  /** The body example was bounded by the projection limits. */
  readonly truncated: boolean;
}

export type AuthSchemeKind =
  | "apiKeyCookie"
  | "apiKeyHeader"
  | "apiKeyQuery"
  | "basic"
  | "bearer"
  | "httpOther"
  | "mutualTls"
  | "oauth2"
  | "openIdConnect";

export interface AuthSchemeProjection {
  readonly kind: AuthSchemeKind;
  /** Header, query, or cookie name for API keys; the auth scheme for `httpOther`. */
  readonly name?: string;
  readonly scopes: readonly string[];
}

/** One OR alternative of the operation's security requirement. */
export interface AuthAlternative {
  readonly label: string;
  /** Schemes joined with AND; empty means anonymous access. */
  readonly schemes: readonly AuthSchemeProjection[];
}

export interface EnvironmentProjection {
  readonly id: string;
  readonly label: string;
  /** Validated absolute base URL without credentials, query, or fragment. */
  readonly baseUrl: string;
}

/** The pure request projection of one canonical operation. */
export interface RequestProjection {
  readonly method: HttpMethod;
  /** The canonical path template, for display. */
  readonly pathTemplate: string;
  /** Serialized path: literal segments encoded, parameters substituted. */
  readonly path: string;
  readonly query: readonly Pair[];
  readonly headers: readonly Pair[];
  readonly cookies: readonly Pair[];
  readonly bodies: readonly BodyProjection[];
  readonly auth: readonly AuthAlternative[];
  /** Usable contract servers for this operation, in contract order. */
  readonly servers: readonly EnvironmentProjection[];
  /** What the first success response carries, for the response line. */
  readonly responseKind: "json" | "none" | "text";
}

/** A concrete request after environment, body, and auth selection. */
export interface ResolvedRequest {
  readonly method: HttpMethod;
  readonly baseUrl: string;
  readonly path: string;
  readonly query: readonly Pair[];
  /** Full URL: base, path, and query. */
  readonly url: string;
  /** Parameter, auth, and content-type headers in deterministic order. */
  readonly headers: readonly Pair[];
  readonly cookies: readonly Pair[];
  readonly body?: BodyProjection;
  readonly auth: AuthAlternative;
  readonly responseKind: "json" | "none" | "text";
  /** Basic credentials, presented as a user/password pair per language. */
  readonly basic?: { readonly username: string; readonly password: string };
  readonly mutualTls: boolean;
}

/** Consumer-declared SDK identity. */
export interface SdkDeclaration {
  readonly id: string;
  readonly label: string;
  readonly language: string;
  readonly package?: string;
  readonly coverage: "complete" | "partial";
}

/** An authored SDK example, highlighted at build time, never executed. */
export interface SdkExample {
  readonly sdk: string;
  readonly code: string;
  readonly lines: readonly (readonly SnippetToken[])[];
  readonly title?: string;
  readonly description?: string;
}

export interface SnippetsArtifact {
  readonly snippetsVersion: typeof SNIPPETS_FORMAT_VERSION;
  /** Configured environments in author order; the first is the default. */
  readonly environments: readonly EnvironmentProjection[];
  /** Keyed by `<service id>~<operation id>` (`operationKey`). */
  readonly operations: Readonly<Record<string, RequestProjection>>;
  readonly sdks: readonly SdkDeclaration[];
  /** Keyed like `operations`; examples in SDK declaration order. */
  readonly sdkExamples: Readonly<Record<string, readonly SdkExample[]>>;
}

/** Centralized bounds; every generator and projection honours them. */
export const SNIPPET_LIMITS = {
  /** Maximum characters of one generated snippet. */
  maxCodeCharacters: 20_000,
  /** Maximum lines of one generated snippet. */
  maxCodeLines: 400,
  /** Maximum nodes in a generated body example. */
  maxBodyNodes: 120,
  /** Maximum nesting depth of a generated body example. */
  maxBodyDepth: 6,
  /** Array examples show at most this many items. */
  maxArrayItems: 1,
  /** Maximum characters of a text or opaque body. */
  maxTextCharacters: 2_000,
  /** Maximum characters of one serialized parameter value. */
  maxValueCharacters: 200,
  /** Maximum query, header, and cookie parameters projected per location. */
  maxParameters: 24,
  /** Maximum characters of one authored SDK example. */
  maxSdkCodeCharacters: 16 * 1_024,
  /** Maximum environments or servers offered. */
  maxEnvironments: 16,
} as const;

export const PLACEHOLDERS = {
  accessToken: "<YOUR_ACCESS_TOKEN>",
  apiKey: "<YOUR_API_KEY>",
  baseUrl: "<BASE_URL>",
  credentials: "<CREDENTIALS>",
  filePath: "/path/to/file",
  password: "<PASSWORD>",
  username: "<USERNAME>",
} as const;
