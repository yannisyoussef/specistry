import { validateBaseUrl } from "@specra/snippets/protocol";

import {
  PLAYGROUND_FORMAT_VERSION,
  PLAYGROUND_HARD_LIMITS,
  type AuthAlternativeForm,
  type AuthSchemeForm,
  type BodyFieldForm,
  type BodyForm,
  type CapabilityReason,
  type OperationForm,
  type ParameterField,
  type PlaygroundArtifact,
  type PlaygroundEnvironment,
  type PlaygroundLimits,
} from "./types.js";

/**
 * Strict (de)serialization of `playground.json`. The reader trusts nothing
 * it did not validate here: every environment must be an exact origin the
 * policy allows, every limit must sit under the hard maximum, every form
 * value is bounded, and unknown keys, kinds, or reasons fail closed. A
 * tampered artifact therefore cannot widen a destination or a budget.
 */

const MAX_ARTIFACT_BYTES = 64 * 1_024 * 1_024;
const MAX_OPERATIONS = 200_000;
const OPERATION_KEY =
  /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}~[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
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
const LOCATIONS: ReadonlySet<string> = new Set([
  "cookie",
  "header",
  "path",
  "query",
]);
const FIELD_KINDS: ReadonlySet<string> = new Set([
  "boolean",
  "enum",
  "integer",
  "json",
  "number",
  "string",
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
const REASONS: ReadonlySet<string> = new Set([
  "auth-basic-requires-credentials",
  "auth-cookie-api-key",
  "auth-mutual-tls",
  "auth-query-api-key",
  "auth-unsupported-scheme",
  "cookie-parameter",
  "forbidden-header",
  "no-environment",
]);
const STATES: ReadonlySet<string> = new Set([
  "executable",
  "partial",
  "unsupported",
]);
const RESPONSE_KINDS: ReadonlySet<string> = new Set(["json", "none", "text"]);
const LIMIT_KEYS = Object.keys(PLAYGROUND_HARD_LIMITS).sort();

export class PlaygroundArtifactError extends Error {
  public readonly path: string;

  public constructor(message: string, path: string) {
    super(message);
    this.name = "PlaygroundArtifactError";
    this.path = path;
  }
}

export function serializePlaygroundArtifact(
  artifact: PlaygroundArtifact,
): string {
  return `${JSON.stringify(sortKeys(artifact))}\n`;
}

export function parsePlaygroundArtifact(text: string): PlaygroundArtifact {
  if (text.length > MAX_ARTIFACT_BYTES) {
    fail("Playground artifact exceeds the size ceiling.", "/");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail("Playground artifact is not valid JSON.", "/");
  }
  return parsePlaygroundArtifactValue(value);
}

/** The exact origin of a validated base URL, or `undefined` if not allowed. */
export function originOf(baseUrl: string): string | undefined {
  const validated = validateBaseUrl(baseUrl);
  if (validated === undefined) return undefined;
  const parsed = new URL(validated);
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  // A parsed hostname is ASCII (punycode) or a bracketed IPv6 literal; a
  // wildcard or any other character can never name an exact origin.
  if (
    parsed.hostname === "" ||
    !/^[a-z0-9.\-]+$|^\[[0-9a-f:.]+\]$/i.test(parsed.hostname)
  ) {
    return undefined;
  }
  return parsed.origin;
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "[::1]",
  "localhost",
]);

export function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function parsePlaygroundArtifactValue(
  value: unknown,
): PlaygroundArtifact {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "enabled",
      "environments",
      "limits",
      "operations",
      "playgroundVersion",
    ])
  ) {
    fail("Playground artifact shape is not recognized.", "/");
  }
  if (value.playgroundVersion !== PLAYGROUND_FORMAT_VERSION) {
    fail("Playground artifact version is unsupported.", "/playgroundVersion");
  }
  if (typeof value.enabled !== "boolean") {
    fail("Enabled flag is invalid.", "/enabled");
  }
  const environments = list(value.environments, "/environments", 16).map(
    (item, index) => environment(item, `/environments/${index}`),
  );
  const ids = new Set(environments.map((item) => item.id));
  if (ids.size !== environments.length) {
    fail("Environment ids must be unique.", "/environments");
  }
  const limits = parseLimits(value.limits, "/limits");
  if (!isRecord(value.operations))
    fail("Operations must be an object.", "/operations");
  const entries = Object.entries(value.operations);
  if (entries.length > MAX_OPERATIONS)
    fail("Too many operations.", "/operations");
  const operations: Record<string, OperationForm> = {};
  for (const [key, item] of entries) {
    if (!OPERATION_KEY.test(key))
      fail("Operation key is invalid.", "/operations");
    operations[key] = operationForm(item, `/operations/${key}`);
  }
  return {
    enabled: value.enabled,
    environments,
    limits,
    operations,
    playgroundVersion: PLAYGROUND_FORMAT_VERSION,
  };
}

function environment(value: unknown, path: string): PlaygroundEnvironment {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["baseUrl", "id", "label", "loopback", "origin"])
  ) {
    fail("Environment shape is invalid.", path);
  }
  const id = text(value.id, `${path}/id`, 80);
  if (!ID.test(id)) fail("Environment id is invalid.", `${path}/id`);
  const baseUrl = text(value.baseUrl, `${path}/baseUrl`, 2_048);
  const origin = text(value.origin, `${path}/origin`, 512);
  const expected = originOf(baseUrl);
  if (
    expected === undefined ||
    expected !== origin ||
    validateBaseUrl(baseUrl) !== baseUrl ||
    /[*]/.test(origin)
  ) {
    fail(
      "Environment origin is not an exact allowed origin.",
      `${path}/origin`,
    );
  }
  if (
    typeof value.loopback !== "boolean" ||
    value.loopback !== isLoopbackOrigin(origin)
  ) {
    fail("Environment loopback flag is invalid.", `${path}/loopback`);
  }
  return {
    baseUrl,
    id,
    label: text(value.label, `${path}/label`, 80),
    loopback: value.loopback,
    origin,
  };
}

function parseLimits(value: unknown, path: string): PlaygroundLimits {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== LIMIT_KEYS.join(",")
  ) {
    fail("Limits shape is invalid.", path);
  }
  const limits: Record<string, number> = {};
  for (const key of LIMIT_KEYS) {
    const item = value[key];
    const maximum = PLAYGROUND_HARD_LIMITS[key as keyof PlaygroundLimits];
    if (
      !Number.isSafeInteger(item) ||
      (item as number) < 1 ||
      (item as number) > maximum
    ) {
      fail("A limit is outside its hard bound.", `${path}/${key}`);
    }
    limits[key] = item as number;
  }
  return limits as unknown as PlaygroundLimits;
}

function operationForm(value: unknown, path: string): OperationForm {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "auth",
      "bodies",
      "bodyRequired",
      "capability",
      "method",
      "parameters",
      "pathTemplate",
      "responseKind",
    ])
  ) {
    fail("Operation form shape is invalid.", path);
  }
  if (typeof value.method !== "string" || !METHODS.has(value.method)) {
    fail("Method is invalid.", `${path}/method`);
  }
  if (typeof value.bodyRequired !== "boolean") {
    fail("Body requirement flag is invalid.", `${path}/bodyRequired`);
  }
  if (
    typeof value.responseKind !== "string" ||
    !RESPONSE_KINDS.has(value.responseKind)
  ) {
    fail("Response kind is invalid.", `${path}/responseKind`);
  }
  const pathTemplate = text(value.pathTemplate, `${path}/pathTemplate`, 2_048);
  // Literal segments are percent-encoded by the shared path renderer, so
  // spaces and reserved characters are data; only control characters are
  // unrepresentable.
  if (/[\u0000-\u001f\u007f]/.test(pathTemplate)) {
    fail("Path template is invalid.", `${path}/pathTemplate`);
  }
  return {
    auth: list(value.auth, `${path}/auth`, 32).map((item, index) =>
      alternative(item, `${path}/auth/${index}`),
    ),
    bodies: list(value.bodies, `${path}/bodies`, 32).map((item, index) =>
      bodyForm(item, `${path}/bodies/${index}`),
    ),
    bodyRequired: value.bodyRequired,
    capability: capability(value.capability, `${path}/capability`),
    method: value.method as OperationForm["method"],
    parameters: list(value.parameters, `${path}/parameters`, 96).map(
      (item, index) => parameterField(item, `${path}/parameters/${index}`),
    ),
    pathTemplate,
    responseKind: value.responseKind as OperationForm["responseKind"],
  };
}

function capability(value: unknown, path: string) {
  if (!isRecord(value) || !hasOnlyKeys(value, ["reasons", "state"])) {
    fail("Capability shape is invalid.", path);
  }
  if (typeof value.state !== "string" || !STATES.has(value.state)) {
    fail("Capability state is invalid.", `${path}/state`);
  }
  return {
    reasons: list(value.reasons, `${path}/reasons`, 16).map((item, index) =>
      reason(item, `${path}/reasons/${index}`),
    ),
    state: value.state as OperationForm["capability"]["state"],
  };
}

function reason(value: unknown, path: string): CapabilityReason {
  if (typeof value !== "string" || !REASONS.has(value)) {
    fail("Capability reason is invalid.", path);
  }
  return value as CapabilityReason;
}

function parameterField(value: unknown, path: string): ParameterField {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "array",
      "capability",
      "contentTyped",
      "deprecated",
      "description",
      "initial",
      "kind",
      "label",
      "location",
      "name",
      "options",
      "reason",
      "required",
      "serialization",
    ])
  ) {
    fail("Parameter field shape is invalid.", path);
  }
  if (typeof value.location !== "string" || !LOCATIONS.has(value.location)) {
    fail("Parameter location is invalid.", `${path}/location`);
  }
  if (typeof value.kind !== "string" || !FIELD_KINDS.has(value.kind)) {
    fail("Parameter kind is invalid.", `${path}/kind`);
  }
  if (value.capability !== "supported" && value.capability !== "unsupported") {
    fail("Parameter capability is invalid.", `${path}/capability`);
  }
  for (const flag of ["array", "contentTyped", "deprecated", "required"]) {
    if (typeof value[flag] !== "boolean")
      fail("Parameter flag is invalid.", `${path}/${flag}`);
  }
  if (
    !isRecord(value.serialization) ||
    !hasOnlyKeys(value.serialization, ["allowReserved", "explode", "style"])
  ) {
    fail("Parameter serialization is invalid.", `${path}/serialization`);
  }
  const name = text(value.name, `${path}/name`, 120);
  if (/[\r\n\0]/.test(name)) fail("Parameter name is invalid.", `${path}/name`);
  return {
    array: value.array as boolean,
    capability: value.capability,
    contentTyped: value.contentTyped as boolean,
    deprecated: value.deprecated as boolean,
    ...(value.description === undefined
      ? {}
      : { description: text(value.description, `${path}/description`, 1_000) }),
    initial: text(value.initial, `${path}/initial`, 2_048),
    kind: value.kind as ParameterField["kind"],
    label: text(value.label, `${path}/label`, 120),
    location: value.location as ParameterField["location"],
    name,
    ...(value.options === undefined
      ? {}
      : {
          options: list(value.options, `${path}/options`, 64).map(
            (item, index) => text(item, `${path}/options/${index}`, 256),
          ),
        }),
    ...(value.reason === undefined
      ? {}
      : { reason: reason(value.reason, `${path}/reason`) }),
    required: value.required as boolean,
    serialization: value.serialization as ParameterField["serialization"],
  };
}

function bodyForm(value: unknown, path: string): BodyForm {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["fields", "initial", "kind", "mediaType"])
  ) {
    fail("Body form shape is invalid.", path);
  }
  if (typeof value.kind !== "string" || !BODY_KINDS.has(value.kind)) {
    fail("Body kind is invalid.", `${path}/kind`);
  }
  return {
    fields: list(value.fields, `${path}/fields`, 64).map((item, index) =>
      bodyField(item, `${path}/fields/${index}`),
    ),
    initial: text(value.initial, `${path}/initial`, 16_384),
    kind: value.kind as BodyForm["kind"],
    mediaType: text(value.mediaType, `${path}/mediaType`, 256),
  };
}

function bodyField(value: unknown, path: string): BodyFieldForm {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "contentType",
      "file",
      "initial",
      "name",
      "required",
    ]) ||
    typeof value.file !== "boolean" ||
    typeof value.required !== "boolean"
  ) {
    fail("Body field shape is invalid.", path);
  }
  return {
    ...(value.contentType === undefined
      ? {}
      : { contentType: text(value.contentType, `${path}/contentType`, 256) }),
    file: value.file,
    initial: text(value.initial, `${path}/initial`, 4_096),
    name: text(value.name, `${path}/name`, 256),
    required: value.required,
  };
}

function alternative(value: unknown, path: string): AuthAlternativeForm {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["label", "schemes", "supported"]) ||
    typeof value.supported !== "boolean"
  ) {
    fail("Auth alternative shape is invalid.", path);
  }
  const schemes = list(value.schemes, `${path}/schemes`, 16).map(
    (item, index) => scheme(item, `${path}/schemes/${index}`),
  );
  if (value.supported !== schemes.every((item) => item.supported)) {
    fail(
      "Auth alternative support flag disagrees with its schemes.",
      `${path}/supported`,
    );
  }
  return {
    label: text(value.label, `${path}/label`, 256),
    schemes,
    supported: value.supported,
  };
}

function scheme(value: unknown, path: string): AuthSchemeForm {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "kind",
      "label",
      "name",
      "reason",
      "scopes",
      "supported",
    ]) ||
    typeof value.supported !== "boolean"
  ) {
    fail("Auth scheme shape is invalid.", path);
  }
  if (typeof value.kind !== "string" || !AUTH_KINDS.has(value.kind)) {
    fail("Auth scheme kind is invalid.", `${path}/kind`);
  }
  // Only these kinds may ever be marked executable in the browser.
  const executable = new Set([
    "apiKeyHeader",
    "basic",
    "bearer",
    "oauth2",
    "openIdConnect",
  ]);
  if (value.supported && !executable.has(value.kind)) {
    fail("Auth scheme cannot be marked supported.", `${path}/supported`);
  }
  return {
    kind: value.kind as AuthSchemeForm["kind"],
    label: text(value.label, `${path}/label`, 256),
    ...(value.name === undefined
      ? {}
      : { name: text(value.name, `${path}/name`, 256) }),
    ...(value.reason === undefined
      ? {}
      : { reason: reason(value.reason, `${path}/reason`) }),
    scopes: list(value.scopes, `${path}/scopes`, 64).map((item, index) =>
      text(item, `${path}/scopes/${index}`, 128),
    ),
    supported: value.supported,
  };
}

// --- helpers --------------------------------------------------------------

function fail(message: string, path: string): never {
  throw new PlaygroundArtifactError(message, path);
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
