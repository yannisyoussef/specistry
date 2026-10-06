import {
  isSensitiveName,
  looksLikeSecret,
  type Pair,
} from "@specistry/snippets/protocol";

/**
 * Presentation-only redaction (SPEC-009 §69, §120–§122): credential headers
 * and secret-shaped values are masked in previews, diagnostics, and
 * response header lists. Execution values are never rewritten.
 */

export const MASK = "••••••••";

const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "x-auth-token",
  "api-key",
  "apikey",
  "x-access-token",
]);

export function isCredentialHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return CREDENTIAL_HEADERS.has(lower) || isSensitiveName(lower);
}

export function redactHeader(pair: Pair): Pair {
  if (isCredentialHeader(pair.name)) {
    const scheme = /^(Basic|Bearer|Digest)\s/i.exec(pair.value)?.[1];
    return {
      name: pair.name,
      value: scheme === undefined ? MASK : `${scheme} ${MASK}`,
    };
  }
  if (looksLikeSecret(pair.value)) return { name: pair.name, value: MASK };
  return pair;
}

export function redactHeaders(headers: readonly Pair[]): readonly Pair[] {
  return headers.map(redactHeader);
}

/** Bounded, control-free text for a response header list. */
export function sanitizeHeaderValue(value: string, maxLength: number): string {
  const cleaned = value
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g,
      "",
    )
    .replace(
      /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g,
      "",
    )
    .replace(/[\r\n\t]+/g, " ");
  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength - 1)}…`
    : cleaned;
}
