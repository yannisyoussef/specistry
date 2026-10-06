/**
 * Shared predicates for the rule catalogue. Rules ask whether authored
 * prose exists and whether an example value looks like a real credential;
 * they never read a value into a finding.
 */

import type { JsonValue, ResponseStatus } from "@specistry/model";

/** True when a string carries readable text rather than whitespace. */
export function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

/** The status as the structured diff spells it: `200`, `2XX`, `default`. */
export function statusLabel(status: ResponseStatus): string {
  if (status.kind === "code") return String(status.code);
  if (status.kind === "range") return status.range;
  return "default";
}

/** A 2xx response, the one a caller normally consumes. */
export function isSuccessStatus(status: ResponseStatus): boolean {
  if (status.kind === "code") return status.code >= 200 && status.code < 300;
  return status.kind === "range" && status.range === "2XX";
}

const PLACEHOLDER =
  /(^|[^a-z])(your|example|sample|placeholder|redacted|dummy|changeme|todo|xxx+|test[-_]?key|fake)([^a-z]|$)/i;

/** Well-known credential shapes; each is a published, unambiguous format. */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  // JSON Web Token: three base64url segments with a JSON header prefix.
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}$/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^AKIA[0-9A-Z]{16}$/,
  /^gh[pousr]_[A-Za-z0-9]{36,}$/,
  /^xox[baprs]-[A-Za-z0-9-]{10,}$/,
  /^sk_live_[A-Za-z0-9]{16,}$/,
  /^AIza[0-9A-Za-z_-]{35}$/,
];

const CREDENTIAL_NAME =
  /^(?:.*[._-])?(api[-_]?key|secret|password|passwd|token|credential|private[-_]?key|client[-_]?secret|access[-_]?key|authorization|auth)$/i;

/** High-entropy opaque strings: mixed classes, long, no spaces. */
function looksOpaque(value: string): boolean {
  if (value.length < 24 || value.length > 4_096) return false;
  if (/\s/.test(value)) return false;
  if (PLACEHOLDER.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/].filter((pattern) =>
    pattern.test(value),
  ).length;
  return classes >= 3 && /^[A-Za-z0-9._~+/=-]+$/.test(value);
}

export interface CredentialHit {
  /** Dotted path inside the example, for the finding's locator. */
  readonly path: string;
}

/**
 * Reports where an example value carries something credential-shaped,
 * never what it is (SPEC-011 §29, §69). A well-known secret format is
 * reported wherever it appears; an opaque high-entropy string is reported
 * only under a credential-named key, and obvious placeholders such as
 * `<YOUR_API_KEY>` are never reported.
 */
export function findCredential(
  value: JsonValue | undefined,
  path = "",
  depth = 0,
): CredentialHit | undefined {
  if (value === undefined || value === null || depth > 12) return undefined;
  if (typeof value === "string") {
    if (CREDENTIAL_SHAPES.some((shape) => shape.test(value))) {
      return { path: path === "" ? "(value)" : path };
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.slice(0, 100).entries()) {
      const hit = findCredential(item, `${path}[${index}]`, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    const next = path === "" ? key : `${path}.${key}`;
    if (
      typeof item === "string" &&
      CREDENTIAL_NAME.test(key) &&
      looksOpaque(item)
    ) {
      return { path: next };
    }
    const hit = findCredential(item, next, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}
