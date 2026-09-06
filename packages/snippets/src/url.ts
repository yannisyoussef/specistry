import { isPlaceholder, sanitizeLine } from "./sanitize.js";
import {
  SNIPPET_LIMITS,
  type EnvironmentProjection,
  type Pair,
} from "./types.js";

/**
 * Structured URL composition. The authority always comes from a validated
 * environment or contract server; the path and query are assembled from
 * percent-encoded parts, so hostile parameter values or path templates can
 * never change the destination, add a fragment, or inject a second query.
 */

const UNRESERVED = /[A-Za-z0-9\-._~]/;
/** Characters `allowReserved` may keep; `&`, `#`, `+`, `%`, and space are always encoded. */
const RESERVED_KEEP = /[:/?@!$'()*,;=[\]]/;
/** Characters allowed unencoded inside a literal path segment. */
const PCHAR = /[A-Za-z0-9\-._~!$&'()*+,;=:@]/;
const encoder = new TextEncoder();

function encodeWith(value: string, keep: RegExp): string {
  let encoded = "";
  for (const character of value) {
    if (keep.test(character)) {
      encoded += character;
    } else {
      for (const byte of encoder.encode(character)) {
        encoded += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
  }
  return encoded;
}

/** Path parameter values: unreserved only; placeholders verbatim. */
export function encodePathValue(value: string): string {
  return isPlaceholder(value) ? value : encodeWith(value, UNRESERVED);
}

/** A literal path segment from the template: pchar set, `/` handled by the caller. */
export function encodePathLiteral(value: string): string {
  return value
    .split("/")
    .map((segment) => encodeWith(segment, PCHAR))
    .join("/");
}

/** Query and cookie values: form encoding, optionally keeping reserved characters. */
export function encodeQueryValue(value: string, allowReserved = false): string {
  if (isPlaceholder(value)) return value;
  if (!allowReserved) return encodeWith(value, UNRESERVED);
  let encoded = "";
  for (const character of value) {
    encoded +=
      UNRESERVED.test(character) || RESERVED_KEEP.test(character)
        ? character
        : encodeWith(character, UNRESERVED);
  }
  return encoded;
}

export function queryString(pairs: readonly Pair[]): string {
  return pairs.map((pair) => `${pair.name}=${pair.value}`).join("&");
}

/** Base URL + path + query. The base's own path is kept; trailing slashes collapse. */
export function composeUrl(
  baseUrl: string,
  path: string,
  query: readonly Pair[],
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = query.length === 0 ? "" : `?${queryString(query)}`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}${suffix}`;
}

const LOOPBACK: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "[::1]",
  "localhost",
]);

/**
 * The same policy as configured environments: absolute https (or loopback
 * http), no credentials, query, or fragment. Returns the normalized URL
 * without a trailing slash.
 */
export function validateBaseUrl(value: string): string | undefined {
  const line = sanitizeLine(value, 2_048);
  let parsed: URL;
  try {
    parsed = new URL(line);
  } catch {
    return undefined;
  }
  if (
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    line.endsWith("?") ||
    line.endsWith("#")
  ) {
    return undefined;
  }
  const isHttps = parsed.protocol === "https:";
  const isLoopback =
    parsed.protocol === "http:" && LOOPBACK.has(parsed.hostname);
  if (!isHttps && !isLoopback) return undefined;
  return parsed.href.replace(/\/+$/, "");
}

/**
 * Contract servers become environments when their URL, with every variable
 * replaced by its default, passes the base-URL policy. Relative server URLs
 * (a bare `/v1`) have no authority and are skipped.
 */
export function serverEnvironment(server: {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  readonly variables: Readonly<
    Record<string, { readonly defaultValue: string }>
  >;
}): EnvironmentProjection | undefined {
  const url = server.url.replace(/\{([^{}]+)\}/g, (match, name: string) => {
    const variable = Object.hasOwn(server.variables, name)
      ? server.variables[name]
      : undefined;
    return variable === undefined ? match : variable.defaultValue;
  });
  if (/[{}]/.test(url)) return undefined;
  const baseUrl = validateBaseUrl(url);
  if (baseUrl === undefined) return undefined;
  return {
    baseUrl,
    id: server.id,
    label: sanitizeLine(server.label, 80) || server.id,
  };
}

/** Bounded, deduplicated by id, in the given order. */
export function boundEnvironments(
  environments: readonly EnvironmentProjection[],
): readonly EnvironmentProjection[] {
  const seen = new Set<string>();
  const result: EnvironmentProjection[] = [];
  for (const environment of environments) {
    if (seen.has(environment.id)) continue;
    seen.add(environment.id);
    result.push(environment);
    if (result.length >= SNIPPET_LIMITS.maxEnvironments) break;
  }
  return result;
}

/** Host header value: host plus port when the port is not the scheme default. */
export function hostOf(url: string): string {
  return new URL(url).host;
}

/** The path prefix a base URL carries (`/v1`), without a trailing slash. */
export function basePathOf(baseUrl: string): string {
  return new URL(baseUrl).pathname.replace(/\/+$/, "");
}
