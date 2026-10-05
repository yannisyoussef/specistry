/**
 * Documentation release identifiers (SPEC-010 §8–§10). A version id is a
 * documentation-release identity, not a SemVer, Git, package, or deployment
 * version: `v1`, `v1.2`, `1.2.0`, and `2026-09` are all valid. Ids are
 * path-safe and deterministic; routing compares them exactly, and the
 * catalog refuses two ids that differ only by case so one platform never
 * serves two routes where another serves one.
 */

export const MAX_VERSION_ID_LENGTH = 64;

/** ASCII letters, digits, `.`, `_`, `-`; starts and ends alphanumeric. */
const VERSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;

/**
 * Names that carry routing or system meaning and can therefore never be a
 * release id: the current alias, the reader's own top-level routes, the
 * mutable candidate, and the store directories. Compared case-insensitively.
 */
export const RESERVED_VERSION_IDS: ReadonlySet<string> = new Set([
  "_next",
  "api",
  "assets",
  "candidate",
  "candidates",
  "changelog",
  "current",
  "docs",
  "latest",
  "not-found",
  "releases",
  "robots.txt",
  "search",
  "sitemap.xml",
  "theme",
]);

export type VersionIdIssue =
  "dot-segment" | "empty" | "grammar" | "reserved" | "too-long";

/** `undefined` when the id is acceptable, otherwise the first reason it is not. */
export function validateVersionId(id: string): VersionIdIssue | undefined {
  if (id.length === 0) return "empty";
  if (id.length > MAX_VERSION_ID_LENGTH) return "too-long";
  if (id === "." || id === ".." || id.includes("..")) return "dot-segment";
  if (!VERSION_ID.test(id)) return "grammar";
  if (RESERVED_VERSION_IDS.has(id.toLowerCase())) return "reserved";
  return undefined;
}

export function isVersionId(id: string): boolean {
  return validateVersionId(id) === undefined;
}

/** Collision key: ids equal under this key cannot coexist in one catalog. */
export function versionKey(id: string): string {
  return id.toLowerCase();
}

export const VERSION_ID_MESSAGES: Readonly<Record<VersionIdIssue, string>> = {
  "dot-segment": "A version id cannot be or contain dot segments.",
  empty: "A version id is required.",
  grammar:
    "A version id uses ASCII letters, digits, dots, underscores, and hyphens, starting and ending with a letter or digit.",
  reserved: "This name is reserved for routing and cannot be a version id.",
  "too-long": "A version id is at most 64 characters.",
};
