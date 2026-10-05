import {
  PROTOCOL_LANGUAGES,
  SNIPPET_LIMITS,
  SNIPPETS_FORMAT_VERSION,
  type AuthAlternative,
  type AuthSchemeKind,
  type AuthSchemeProjection,
  type BodyKind,
  type BodyProjection,
  type EnvironmentProjection,
  type FormField,
  type Pair,
  type RequestProjection,
  type SdkDeclaration,
  type SdkExample,
  type SnippetToken,
  type SnippetTokenClass,
  type SnippetsArtifact,
} from "./types.js";
import { validateBaseUrl } from "./url.js";

/**
 * Strict, dependency-free (de)serialization of `snippets.json`. The reader
 * validates the artifact before generating anything from it, so a tampered
 * or malformed file fails closed: unknown keys, unbounded strings, invalid
 * base URLs, unknown kinds, or a wrong version are all rejected.
 */

const MAX_ARTIFACT_BYTES = 128 * 1_024 * 1_024;
const MAX_OPERATIONS = 200_000;
const MAX_STRING = 4_096;
const MAX_PAIRS = 64;
const METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);
const BODY_KINDS: ReadonlySet<string> = new Set([
  "binary",
  "form",
  "json",
  "multipart",
  "opaque",
  "text",
]);
const AUTH_KINDS: ReadonlySet<string> = new Set([
  "apiKeyCookie",
  "apiKeyHeader",
  "apiKeyQuery",
  "basic",
  "bearer",
  "httpOther",
  "mutualTls",
  "oauth2",
  "openIdConnect",
]);
const RESPONSE_KINDS: ReadonlySet<string> = new Set(["json", "none", "text"]);
const TOKEN_CLASSES: ReadonlySet<string> = new Set([
  "attr",
  "cmt",
  "fn",
  "kw",
  "num",
  "str",
  "tag",
  "type",
  "var",
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
/** `<service id>~<operation id>`, see `operationKey`. */
const OPERATION_KEY =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}~[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const PLACEHOLDER_BASE = "<BASE_URL>";

export class SnippetsArtifactError extends Error {
  public readonly path: string;

  public constructor(message: string, path: string) {
    super(message);
    this.name = "SnippetsArtifactError";
    this.path = path;
  }
}

export function serializeSnippetsArtifact(artifact: SnippetsArtifact): string {
  return `${JSON.stringify(sortKeys(artifact))}\n`;
}

export function parseSnippetsArtifact(text: string): SnippetsArtifact {
  if (text.length > MAX_ARTIFACT_BYTES) {
    throw new SnippetsArtifactError(
      "Snippets artifact exceeds the size ceiling.",
      "/",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SnippetsArtifactError(
      "Snippets artifact is not valid JSON.",
      "/",
    );
  }
  return parseSnippetsArtifactValue(value);
}

export function parseSnippetsArtifactValue(value: unknown): SnippetsArtifact {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "environments",
      "operations",
      "sdkExamples",
      "sdks",
      "snippetsVersion",
    ])
  ) {
    fail("Snippets artifact shape is not recognized.", "/");
  }
  if (value.snippetsVersion !== SNIPPETS_FORMAT_VERSION) {
    fail("Snippets artifact version is unsupported.", "/snippetsVersion");
  }
  const environments = list(value.environments, "/environments", 64).map(
    (item, index) => environment(item, `/environments/${index}`),
  );
  if (!isRecord(value.operations))
    fail("Operations must be an object.", "/operations");
  const operationEntries = Object.entries(value.operations);
  if (operationEntries.length > MAX_OPERATIONS) {
    fail("Too many operations.", "/operations");
  }
  const operations: Record<string, RequestProjection> = {};
  for (const [id, item] of operationEntries) {
    if (!OPERATION_KEY.test(id))
      fail("Operation key is invalid.", "/operations");
    operations[id] = projection(item, `/operations/${id}`);
  }
  const sdks = list(value.sdks, "/sdks", 32).map((item, index) =>
    sdk(item, `/sdks/${index}`),
  );
  const sdkIds = new Set(sdks.map((entry) => entry.id));
  if (sdkIds.size !== sdks.length) fail("SDK ids must be unique.", "/sdks");
  if (!isRecord(value.sdkExamples)) {
    fail("SDK examples must be an object.", "/sdkExamples");
  }
  const sdkExamples: Record<string, readonly SdkExample[]> = {};
  for (const [id, item] of Object.entries(value.sdkExamples)) {
    if (!Object.hasOwn(operations, id)) {
      fail("SDK example targets an unknown operation.", `/sdkExamples/${id}`);
    }
    const examples = list(item, `/sdkExamples/${id}`, 32).map((entry, index) =>
      sdkExample(entry, `/sdkExamples/${id}/${index}`, sdkIds),
    );
    sdkExamples[id] = examples;
  }
  return {
    environments,
    operations,
    sdkExamples,
    sdks,
    snippetsVersion: SNIPPETS_FORMAT_VERSION,
  };
}

function environment(value: unknown, path: string): EnvironmentProjection {
  if (!isRecord(value) || !hasOnlyKeys(value, ["baseUrl", "id", "label"])) {
    fail("Environment shape is invalid.", path);
  }
  const id = text(value.id, `${path}/id`, 80);
  if (!ID.test(id)) fail("Environment id is invalid.", `${path}/id`);
  const baseUrl = text(value.baseUrl, `${path}/baseUrl`, 2_048);
  if (baseUrl !== PLACEHOLDER_BASE && validateBaseUrl(baseUrl) !== baseUrl) {
    fail("Environment base URL is not allowed.", `${path}/baseUrl`);
  }
  return { baseUrl, id, label: text(value.label, `${path}/label`, 80) };
}

function projection(value: unknown, path: string): RequestProjection {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "auth",
      "bodies",
      "cookies",
      "headers",
      "method",
      "path",
      "pathTemplate",
      "query",
      "responseKind",
      "servers",
    ])
  ) {
    fail("Operation projection shape is invalid.", path);
  }
  if (typeof value.method !== "string" || !METHODS.has(value.method)) {
    fail("Method is invalid.", `${path}/method`);
  }
  const requestPath = text(value.path, `${path}/path`, MAX_STRING);
  if (!requestPath.startsWith("/") || /[\s#?]/.test(requestPath)) {
    fail("Path is invalid.", `${path}/path`);
  }
  if (
    typeof value.responseKind !== "string" ||
    !RESPONSE_KINDS.has(value.responseKind)
  ) {
    fail("Response kind is invalid.", `${path}/responseKind`);
  }
  return {
    auth: list(value.auth, `${path}/auth`, 32).map((item, index) =>
      alternative(item, `${path}/auth/${index}`),
    ),
    bodies: list(value.bodies, `${path}/bodies`, 32).map((item, index) =>
      body(item, `${path}/bodies/${index}`),
    ),
    cookies: pairs(value.cookies, `${path}/cookies`),
    headers: pairs(value.headers, `${path}/headers`),
    method: value.method as RequestProjection["method"],
    path: requestPath,
    pathTemplate: text(value.pathTemplate, `${path}/pathTemplate`, MAX_STRING),
    query: pairs(value.query, `${path}/query`),
    responseKind: value.responseKind as RequestProjection["responseKind"],
    servers: list(value.servers, `${path}/servers`, 64).map((item, index) =>
      environment(item, `${path}/servers/${index}`),
    ),
  };
}

function pairs(value: unknown, path: string): readonly Pair[] {
  return list(value, path, MAX_PAIRS).map((item, index) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["name", "value"])) {
      fail("Pair shape is invalid.", `${path}/${index}`);
    }
    const name = text(item.name, `${path}/${index}/name`, 256);
    const pairValue = text(item.value, `${path}/${index}/value`, MAX_STRING);
    if (/[\r\n\0]/.test(name) || /[\r\n\0]/.test(pairValue)) {
      fail("Pair contains a line break.", `${path}/${index}`);
    }
    return { name, value: pairValue };
  });
}

function body(value: unknown, path: string): BodyProjection {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "fields",
      "json",
      "kind",
      "mediaType",
      "text",
      "truncated",
    ])
  ) {
    fail("Body shape is invalid.", path);
  }
  if (typeof value.kind !== "string" || !BODY_KINDS.has(value.kind)) {
    fail("Body kind is invalid.", `${path}/kind`);
  }
  if (typeof value.truncated !== "boolean") {
    fail("Body truncation flag is invalid.", `${path}/truncated`);
  }
  const kind = value.kind as BodyKind;
  const result: BodyProjection = {
    kind,
    mediaType: text(value.mediaType, `${path}/mediaType`, 256),
    truncated: value.truncated,
  };
  if (value.json !== undefined) {
    if (!isJson(value.json, 0)) fail("Body JSON is invalid.", `${path}/json`);
    return {
      ...result,
      json: value.json as NonNullable<BodyProjection["json"]>,
      ...fieldsAndText(value, path),
    };
  }
  return { ...result, ...fieldsAndText(value, path) };
}

function fieldsAndText(
  value: Record<string, unknown>,
  path: string,
): Pick<BodyProjection, "fields" | "text"> {
  const result: { fields?: readonly FormField[]; text?: string } = {};
  if (value.fields !== undefined) {
    result.fields = list(value.fields, `${path}/fields`, MAX_PAIRS).map(
      (item, index) => {
        if (
          !isRecord(item) ||
          !hasOnlyKeys(item, ["contentType", "file", "name", "value"]) ||
          typeof item.file !== "boolean"
        ) {
          fail("Form field shape is invalid.", `${path}/fields/${index}`);
        }
        return {
          file: item.file,
          name: text(item.name, `${path}/fields/${index}/name`, 256),
          value: text(item.value, `${path}/fields/${index}/value`, MAX_STRING),
          ...(item.contentType === undefined
            ? {}
            : {
                contentType: text(
                  item.contentType,
                  `${path}/fields/${index}/contentType`,
                  256,
                ),
              }),
        };
      },
    );
  }
  if (value.text !== undefined) {
    result.text = text(
      value.text,
      `${path}/text`,
      SNIPPET_LIMITS.maxTextCharacters + 16,
    );
  }
  return result;
}

function alternative(value: unknown, path: string): AuthAlternative {
  if (!isRecord(value) || !hasOnlyKeys(value, ["label", "schemes"])) {
    fail("Auth alternative shape is invalid.", path);
  }
  return {
    label: text(value.label, `${path}/label`, 256),
    schemes: list(value.schemes, `${path}/schemes`, 16).map((item, index) =>
      scheme(item, `${path}/schemes/${index}`),
    ),
  };
}

function scheme(value: unknown, path: string): AuthSchemeProjection {
  if (!isRecord(value) || !hasOnlyKeys(value, ["kind", "name", "scopes"])) {
    fail("Auth scheme shape is invalid.", path);
  }
  if (typeof value.kind !== "string" || !AUTH_KINDS.has(value.kind)) {
    fail("Auth scheme kind is invalid.", `${path}/kind`);
  }
  return {
    kind: value.kind as AuthSchemeKind,
    ...(value.name === undefined
      ? {}
      : { name: text(value.name, `${path}/name`, 256) }),
    scopes: list(value.scopes, `${path}/scopes`, 64).map((item, index) =>
      text(item, `${path}/scopes/${index}`, 128),
    ),
  };
}

function sdk(value: unknown, path: string): SdkDeclaration {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["coverage", "id", "label", "language", "package"])
  ) {
    fail("SDK declaration shape is invalid.", path);
  }
  const id = text(value.id, `${path}/id`, 64);
  if (!ID.test(id)) fail("SDK id is invalid.", `${path}/id`);
  if (value.coverage !== "complete" && value.coverage !== "partial") {
    fail("SDK coverage is invalid.", `${path}/coverage`);
  }
  return {
    coverage: value.coverage,
    id,
    label: text(value.label, `${path}/label`, 80),
    language: text(value.language, `${path}/language`, 32),
    ...(value.package === undefined
      ? {}
      : { package: text(value.package, `${path}/package`, 214) }),
  };
}

function sdkExample(
  value: unknown,
  path: string,
  sdkIds: ReadonlySet<string>,
): SdkExample {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["code", "description", "lines", "sdk", "title"])
  ) {
    fail("SDK example shape is invalid.", path);
  }
  const id = text(value.sdk, `${path}/sdk`, 64);
  if (!sdkIds.has(id))
    fail("SDK example names an undeclared SDK.", `${path}/sdk`);
  const code = text(
    value.code,
    `${path}/code`,
    SNIPPET_LIMITS.maxSdkCodeCharacters,
  );
  const lines = list(
    value.lines,
    `${path}/lines`,
    SNIPPET_LIMITS.maxCodeLines * 4,
  ).map((line, index) => tokens(line, `${path}/lines/${index}`));
  if (
    lines.map((line) => line.map((token) => token.text).join("")).join("\n") !==
    code
  ) {
    fail("SDK example tokens do not match the code.", `${path}/lines`);
  }
  return {
    code,
    lines,
    sdk: id,
    ...(value.title === undefined
      ? {}
      : { title: text(value.title, `${path}/title`, 120) }),
    ...(value.description === undefined
      ? {}
      : { description: text(value.description, `${path}/description`, 1_000) }),
  };
}

function tokens(value: unknown, path: string): readonly SnippetToken[] {
  return list(value, path, 512).map((item, index) => {
    if (!isRecord(item) || !hasOnlyKeys(item, ["cls", "text"])) {
      fail("Token shape is invalid.", `${path}/${index}`);
    }
    const tokenText = text(item.text, `${path}/${index}/text`, MAX_STRING);
    if (tokenText.includes("\n"))
      fail("Token spans lines.", `${path}/${index}`);
    if (item.cls === undefined) return { text: tokenText };
    if (typeof item.cls !== "string" || !TOKEN_CLASSES.has(item.cls)) {
      fail("Token class is invalid.", `${path}/${index}/cls`);
    }
    return { cls: item.cls as SnippetTokenClass, text: tokenText };
  });
}

// --- helpers --------------------------------------------------------------

function fail(message: string, path: string): never {
  throw new SnippetsArtifactError(message, path);
}

function list(value: unknown, path: string, max: number): readonly unknown[] {
  if (!Array.isArray(value)) fail("Expected a list.", path);
  if (value.length > max) fail("List exceeds its bound.", path);
  return value;
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.length > max) {
    fail("Expected a bounded string.", path);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isJson(value: unknown, depth: number): boolean {
  if (depth > 32) return false;
  if (value === null) return true;
  switch (typeof value) {
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "string":
      return value.length <= 65_536;
    case "object":
      if (Array.isArray(value)) {
        return (
          value.length <= 4_096 &&
          value.every((item) => isJson(item, depth + 1))
        );
      }
      return (
        isRecord(value) &&
        Object.entries(value).every(
          ([key, item]) =>
            key !== "__proto__" &&
            key.length <= 1_024 &&
            isJson(item, depth + 1),
        )
      );
    default:
      return false;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export { PROTOCOL_LANGUAGES };
