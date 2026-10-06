import { composeUrl, type Pair } from "@specistry/snippets/protocol";

import type { PlaygroundEnvironment } from "../types.js";

/**
 * Destination integrity (SPEC-009 §15–§18). The final URL is composed
 * structurally from the approved environment's base URL and the serialized
 * path and query, then re-parsed and compared with the approved exact
 * origin: protocol, hostname, port, and origin must match, userinfo must be
 * empty, no fragment may exist, and the length must sit under the budget.
 * Anything else fails closed before any fetch.
 */

export type DestinationFailure =
  | "base-path"
  | "fragment"
  | "invalid-url"
  | "origin-mismatch"
  | "url-too-long"
  | "userinfo";

export interface DestinationResult {
  readonly ok: boolean;
  readonly url: string;
  readonly failure?: DestinationFailure;
}

export function composeDestination(
  environment: PlaygroundEnvironment,
  path: string,
  query: readonly Pair[],
  maxLength: number,
): DestinationResult {
  const url = composeUrl(environment.baseUrl, path, query);
  const failure =
    assertExactOrigin(url, environment.origin, maxLength) ??
    assertBasePath(url, environment.baseUrl);
  return failure === undefined
    ? { ok: true, url }
    : { failure, ok: false, url };
}

/**
 * Dot segments (`..`, `%2e%2e`) are normalized by the URL parser; after
 * normalization the path must still sit under the environment's base path,
 * so a parameter value can never climb out of `/v1`.
 */
export function assertBasePath(
  url: string,
  baseUrl: string,
): DestinationFailure | undefined {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return "invalid-url";
  }
  const prefix = base.pathname.replace(/\/+$/, "");
  if (parsed.pathname === prefix || parsed.pathname.startsWith(`${prefix}/`))
    return undefined;
  return "base-path";
}

/** `undefined` when the URL is exactly on the approved origin, else the reason. */
export function assertExactOrigin(
  url: string,
  approvedOrigin: string,
  maxLength: number,
): DestinationFailure | undefined {
  if (url.length > maxLength) return "url-too-long";
  let parsed: URL;
  let approved: URL;
  try {
    parsed = new URL(url);
    approved = new URL(approvedOrigin);
  } catch {
    return "invalid-url";
  }
  if (parsed.username !== "" || parsed.password !== "") return "userinfo";
  if (parsed.hash !== "" || url.includes("#")) return "fragment";
  if (
    parsed.protocol !== approved.protocol ||
    parsed.hostname !== approved.hostname ||
    parsed.port !== approved.port ||
    parsed.origin !== approved.origin ||
    parsed.origin === "null"
  ) {
    return "origin-mismatch";
  }
  // The composed path must still start with the environment's base path.
  const basePath = approvedBasePath(approvedOrigin, url);
  if (basePath === undefined) return "origin-mismatch";
  return undefined;
}

function approvedBasePath(origin: string, url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.origin === new URL(origin).origin
      ? parsed.pathname
      : undefined;
  } catch {
    return undefined;
  }
}

export const DESTINATION_MESSAGES: Readonly<
  Record<DestinationFailure, string>
> = {
  "base-path":
    "The request URL does not stay under the approved environment base path; the parameter values were rejected.",
  fragment: "The request URL must not contain a fragment.",
  "invalid-url": "The request URL could not be composed.",
  "origin-mismatch":
    "The request URL does not stay on the approved environment origin; the parameter values were rejected.",
  "url-too-long": "The request URL exceeds the playground length limit.",
  userinfo: "The request URL must not carry a username or password.",
};
