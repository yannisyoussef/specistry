import { PLACEHOLDERS, SNIPPET_LIMITS } from "./types.js";

/**
 * Value hygiene shared by every projection step. Canonical strings are
 * untrusted documentation input: control characters, line separators, and
 * bidirectional formatting characters are removed before a value can reach a
 * generator, so no example can smuggle a header line, a shell line break, or
 * a reordered display into generated code. Language escaping is layered on
 * top; this module never decides quoting.
 */

/** C0/C1 controls except tab and newline, and Unicode line/paragraph separators. */
const CONTROLS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/gu;
const TAB_AND_NEWLINE = /[\t\n\r]+/gu;
/** Bidirectional and zero-width formatting characters. */
const FORMAT_CONTROLS =
  /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/gu;

/** Single-line text: no controls at all, bounded. */
export function sanitizeLine(
  value: string,
  maxCharacters: number = SNIPPET_LIMITS.maxValueCharacters,
): string {
  return value
    .normalize("NFC")
    .replace(CONTROLS, "")
    .replace(TAB_AND_NEWLINE, " ")
    .replace(FORMAT_CONTROLS, "")
    .slice(0, maxCharacters);
}

/** Multi-line text (bodies): newlines and tabs survive, everything else is removed. */
export function sanitizeText(
  value: string,
  maxCharacters: number = SNIPPET_LIMITS.maxTextCharacters,
): string {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROLS, "")
    .replace(FORMAT_CONTROLS, "")
    .slice(0, maxCharacters);
}

/** RFC 7230 token: header and cookie names, form field names. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isToken(value: string): boolean {
  return value.length > 0 && value.length <= 128 && TOKEN.test(value);
}

/**
 * Names whose values are credentials or personal data regardless of the
 * example the contract provides. Matching is by word and deliberately
 * conservative: `apiKey`, `api_key`, `X-Auth-Token`, `password`, `sessionId`,
 * and even `tokenCount` are redacted; `description` or `keyword` are not.
 */
const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  "apikey",
  "auth",
  "authorization",
  "bearer",
  "cookie",
  "credential",
  "credentials",
  "jwt",
  "key",
  "passcode",
  "passphrase",
  "password",
  "passwd",
  "private",
  "pwd",
  "secret",
  "session",
  "sessionid",
  "ssn",
  "token",
]);

export function isSensitiveName(name: string): boolean {
  const words = nameWords(name);
  if (words.some((word) => SENSITIVE_WORDS.has(word))) return true;
  // `api_key` and `x-api-key` split into words that are individually benign.
  for (let index = 0; index + 1 < words.length; index += 1) {
    if (SENSITIVE_WORDS.has(`${words[index]}${words[index + 1]}`)) return true;
  }
  return false;
}

/** Lower-case words of a camelCase, kebab-case, or snake_case identifier. */
function nameWords(name: string): string[] {
  return name
    .normalize("NFKC")
    .replace(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})/gu, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

const MAX_PLACEHOLDER_WORDS = 6;

/** `<INBOX_ID>` for `inboxId`; `<VALUE>` when nothing usable remains. */
export function placeholderFor(name: string): string {
  const words = nameWords(name)
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter((word) => word.length > 0)
    .slice(0, MAX_PLACEHOLDER_WORDS);
  const body = words.length === 0 ? "VALUE" : words.join("_").toUpperCase();
  return `<${body}>`;
}

/** Placeholder for a credential-shaped name: `<YOUR_API_KEY>`. */
export function secretPlaceholderFor(name: string): string {
  const inner = placeholderFor(name).slice(1, -1);
  return inner.startsWith("YOUR_") ? `<${inner}>` : `<YOUR_${inner}>`;
}

/**
 * Values that look like credentials regardless of their name: well-known
 * key prefixes, JWTs, PEM blocks, and long opaque tokens. A deliberate
 * policy (SPEC-008 §28–§29): such example values become placeholders.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /^(?:sk|pk|rk)_(?:live|test|prod)_[A-Za-z0-9]{8,}/,
  /^AKIA[0-9A-Z]{16}$/,
  /^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /^xox[abprs]-[A-Za-z0-9-]{10,}/,
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.?[A-Za-z0-9_-]*$/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^[A-Fa-f0-9]{40,}$/,
  /^[A-Za-z0-9+/_-]{48,}={0,2}$/,
];

export function looksLikeSecret(value: string): boolean {
  return SECRET_SHAPES.some((shape) => shape.test(value));
}

const PLACEHOLDER = /^<[A-Z][A-Z0-9_]*>$/;

/** Placeholders are emitted verbatim (never percent-encoded) so readers recognise them. */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value) || value === PLACEHOLDERS.filePath;
}
