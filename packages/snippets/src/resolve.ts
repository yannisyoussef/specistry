import { encodeQueryValue } from "./url.js";
import {
  PLACEHOLDERS,
  type AuthAlternative,
  type EnvironmentProjection,
  type Pair,
  type RequestProjection,
  type ResolvedRequest,
} from "./types.js";
import { composeUrl } from "./url.js";

/**
 * Selection: environment, body media type, and security alternative turn a
 * projection into one concrete request. Header composition is deterministic:
 * parameter headers in declaration order, then authentication, then the
 * body's `Content-Type`; a later header replaces an earlier one with the
 * same case-insensitive name (the security scheme and the media type are
 * authoritative over a parameter that happens to share the name).
 */

export interface Selection {
  readonly environment?: string | undefined;
  readonly body?: string | undefined;
  readonly auth?: string | undefined;
}

export interface SelectionOption {
  readonly id: string;
  readonly label: string;
}

export interface ResolvedSelection {
  readonly request: ResolvedRequest;
  readonly environment: EnvironmentProjection;
  readonly environments: readonly SelectionOption[];
  readonly bodies: readonly SelectionOption[];
  readonly auths: readonly SelectionOption[];
  readonly selected: {
    readonly environment: string;
    readonly body?: string;
    readonly auth?: string;
  };
}

const PLACEHOLDER_ENVIRONMENT: EnvironmentProjection = {
  baseUrl: PLACEHOLDERS.baseUrl,
  id: "base-url",
  label: "Base URL",
};

/**
 * Environments offered for an operation: configured environments when the
 * project declares any, otherwise the operation's usable contract servers,
 * otherwise the explicit `<BASE_URL>` placeholder. The first is the default.
 */
export function environmentsFor(
  projection: RequestProjection,
  configured: readonly EnvironmentProjection[],
): readonly EnvironmentProjection[] {
  if (configured.length > 0) return configured;
  if (projection.servers.length > 0) return projection.servers;
  return [PLACEHOLDER_ENVIRONMENT];
}

export function resolveRequest(
  projection: RequestProjection,
  configured: readonly EnvironmentProjection[],
  selection: Selection = {},
): ResolvedSelection {
  const environments = environmentsFor(projection, configured);
  const environment =
    environments.find((candidate) => candidate.id === selection.environment) ??
    (environments[0] as EnvironmentProjection);
  const body =
    projection.bodies.find(
      (candidate) => candidate.mediaType === selection.body,
    ) ?? projection.bodies[0];
  const authIndex = Number.parseInt(selection.auth ?? "", 10);
  const alternative: AuthAlternative =
    projection.auth[Number.isInteger(authIndex) ? authIndex : -1] ??
    projection.auth[0] ??
    ANONYMOUS;

  const query: Pair[] = [...projection.query];
  const headers: Pair[] = [...projection.headers];
  const cookies: Pair[] = [...projection.cookies];
  let basic: ResolvedRequest["basic"];
  let mutualTls = false;
  for (const scheme of alternative.schemes) {
    switch (scheme.kind) {
      case "apiKeyHeader":
        setHeader(headers, scheme.name ?? "X-API-Key", PLACEHOLDERS.apiKey);
        break;
      case "apiKeyQuery":
        query.push({
          name: encodeQueryValue(scheme.name ?? "api_key"),
          value: PLACEHOLDERS.apiKey,
        });
        break;
      case "apiKeyCookie":
        cookies.push({
          name: scheme.name ?? "session",
          value: PLACEHOLDERS.apiKey,
        });
        break;
      case "bearer":
      case "oauth2":
      case "openIdConnect":
        setHeader(
          headers,
          "Authorization",
          `Bearer ${PLACEHOLDERS.accessToken}`,
        );
        break;
      case "basic":
        basic = {
          password: PLACEHOLDERS.password,
          username: PLACEHOLDERS.username,
        };
        setHeader(headers, "Authorization", `Basic ${basicPlaceholder()}`);
        break;
      case "httpOther":
        setHeader(
          headers,
          "Authorization",
          `${capitalize(scheme.name ?? "Custom")} ${PLACEHOLDERS.credentials}`,
        );
        break;
      case "mutualTls":
        mutualTls = true;
        break;
    }
  }
  if (body !== undefined && body.kind !== "multipart") {
    setHeader(headers, "Content-Type", body.mediaType);
  } else {
    removeHeader(headers, "Content-Type");
  }
  const request: ResolvedRequest = {
    auth: alternative,
    baseUrl: environment.baseUrl,
    ...(basic === undefined ? {} : { basic }),
    ...(body === undefined ? {} : { body }),
    cookies,
    headers,
    method: projection.method,
    mutualTls,
    path: projection.path,
    query,
    responseKind: projection.responseKind,
    url: composeUrl(environment.baseUrl, projection.path, query),
  };
  return {
    auths: projection.auth.map((candidate, index) => ({
      id: String(index),
      label: candidate.label,
    })),
    bodies: projection.bodies.map((candidate) => ({
      id: candidate.mediaType,
      label: candidate.mediaType,
    })),
    environment,
    environments: environments.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
    })),
    request,
    selected: {
      environment: environment.id,
      ...(body === undefined ? {} : { body: body.mediaType }),
      ...(projection.auth.length === 0
        ? {}
        : { auth: String(Math.max(projection.auth.indexOf(alternative), 0)) }),
    },
  };
}

const ANONYMOUS: AuthAlternative = { label: "No authentication", schemes: [] };

/** The placeholder the raw HTTP form shows for basic credentials. */
export function basicPlaceholder(): string {
  return "<BASE64_CREDENTIALS>";
}

function setHeader(headers: Pair[], name: string, value: string): void {
  removeHeader(headers, name);
  headers.push({ name, value });
}

function removeHeader(headers: Pair[], name: string): void {
  const lower = name.toLowerCase();
  for (let index = headers.length - 1; index >= 0; index -= 1) {
    if (headers[index]?.name.toLowerCase() === lower) headers.splice(index, 1);
  }
}

function capitalize(value: string): string {
  return value.length === 0
    ? value
    : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
