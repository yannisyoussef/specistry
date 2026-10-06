import type { ContentLocation } from "./types.js";

/**
 * Authored-content diagnostics. Codes are stable, messages are fixed and
 * value-free, locations are project-relative with 1-based line and column.
 * Nothing from the source text is ever interpolated.
 */

export type ContentDiagnosticCode =
  | "CONTENT_ASSET_INVALID"
  | "CONTENT_ASSET_NOT_FOUND"
  | "CONTENT_ASSET_OUTSIDE_ROOT"
  | "CONTENT_ASSET_TOO_LARGE"
  | "CONTENT_ASSET_UNSUPPORTED"
  | "CONTENT_BUDGET_EXCEEDED"
  | "CONTENT_COMPONENT_NESTING_INVALID"
  | "CONTENT_COMPONENT_PROP_INVALID"
  | "CONTENT_COMPONENT_UNKNOWN"
  | "CONTENT_ESM_FORBIDDEN"
  | "CONTENT_EXPRESSION_FORBIDDEN"
  | "CONTENT_FRONTMATTER_INVALID"
  | "CONTENT_FRONTMATTER_MISSING"
  | "CONTENT_FRONTMATTER_UNKNOWN_FIELD"
  | "CONTENT_HEADING_H1"
  | "CONTENT_HEADING_SKIPPED"
  | "CONTENT_HTML_FORBIDDEN"
  | "CONTENT_LINK_ANCHOR_MISSING"
  | "CONTENT_LINK_SCHEME_FORBIDDEN"
  | "CONTENT_LINK_TARGET_MISSING"
  | "CONTENT_PARSE_FAILED"
  | "CONTENT_SOURCE_OUTSIDE_ROOT"
  | "CONTENT_UNSUPPORTED"
  | "NAVIGATION_API_DUPLICATE"
  | "NAVIGATION_DEPTH_EXCEEDED"
  | "NAVIGATION_INVALID"
  | "NAVIGATION_LINK_INVALID"
  | "NAVIGATION_PAGE_DUPLICATE"
  | "NAVIGATION_PAGE_MISSING"
  | "NAVIGATION_PAGE_ORPHANED"
  | "ROUTE_COLLISION"
  | "ROUTE_SLUG_INVALID";

export type ContentDiagnosticSeverity = "error" | "warning";

export interface ContentDiagnostic {
  readonly code: ContentDiagnosticCode;
  readonly message: string;
  readonly severity: ContentDiagnosticSeverity;
  /** Project-relative POSIX path of the authored file, or `config` for navigation. */
  readonly path: string;
  readonly line?: number;
  readonly column?: number;
}

export const CONTENT_DIAGNOSTIC_MESSAGES: Readonly<
  Record<ContentDiagnosticCode, string>
> = {
  CONTENT_ASSET_INVALID:
    "The referenced asset path is not a valid relative path inside the documentation root.",
  CONTENT_ASSET_NOT_FOUND: "The referenced asset file does not exist.",
  CONTENT_ASSET_OUTSIDE_ROOT:
    "The referenced asset resolves outside the documentation root.",
  CONTENT_ASSET_TOO_LARGE:
    "The referenced asset exceeds the size budget for documentation assets.",
  CONTENT_ASSET_UNSUPPORTED:
    "The referenced asset is not a supported image type (PNG, JPEG, WebP, or GIF by content).",
  CONTENT_BUDGET_EXCEEDED:
    "The authored content exceeds a documented resource budget.",
  CONTENT_COMPONENT_NESTING_INVALID:
    "The component is not allowed at this position; check the documented nesting rules.",
  CONTENT_COMPONENT_PROP_INVALID:
    "A component attribute is missing, unknown, or has an invalid value.",
  CONTENT_COMPONENT_UNKNOWN:
    "The component is not part of the Specistry authoring vocabulary.",
  CONTENT_ESM_FORBIDDEN:
    "Import and export statements are not allowed in documentation.",
  CONTENT_EXPRESSION_FORBIDDEN:
    "JavaScript expressions are not allowed in documentation.",
  CONTENT_FRONTMATTER_INVALID:
    "The frontmatter is not a valid mapping of the documented fields.",
  CONTENT_FRONTMATTER_MISSING:
    "The page has no frontmatter title; every page needs one.",
  CONTENT_FRONTMATTER_UNKNOWN_FIELD:
    "The frontmatter contains a field that is not part of the contract.",
  CONTENT_HEADING_H1:
    "The page title owns the H1; use level-2 headings and below in the body.",
  CONTENT_HEADING_SKIPPED:
    "The heading skips a level; headings should descend one level at a time.",
  CONTENT_HTML_FORBIDDEN:
    "Raw HTML is not allowed in documentation; use Markdown or a Specistry component.",
  CONTENT_LINK_ANCHOR_MISSING:
    "The link points at a heading anchor that does not exist on the target page.",
  CONTENT_LINK_SCHEME_FORBIDDEN:
    "The link uses a scheme that is not allowed; use https, http, mailto, or a relative link.",
  CONTENT_LINK_TARGET_MISSING:
    "The internal link points at a page or API route that does not exist.",
  CONTENT_PARSE_FAILED: "The document could not be parsed as Markdown.",
  CONTENT_SOURCE_OUTSIDE_ROOT:
    "The authored file resolves outside the documentation root and was not compiled.",
  CONTENT_UNSUPPORTED:
    "The Markdown construct is not supported by the Specistry content model.",
  NAVIGATION_API_DUPLICATE:
    "The generated API reference is inserted more than once in the navigation.",
  NAVIGATION_DEPTH_EXCEEDED:
    "Navigation sections nest deeper than the supported depth.",
  NAVIGATION_INVALID:
    "The navigation entry is not a page slug, section, API insertion, or link.",
  NAVIGATION_LINK_INVALID:
    "The navigation link must be an absolute https or http URL.",
  NAVIGATION_PAGE_DUPLICATE:
    "The page appears more than once in the navigation.",
  NAVIGATION_PAGE_MISSING:
    "The navigation references a page that does not exist.",
  NAVIGATION_PAGE_ORPHANED:
    "The page is not listed in the navigation; its route still exists.",
  ROUTE_COLLISION: "Two pages resolve to the same route.",
  ROUTE_SLUG_INVALID:
    "The page path or slug does not follow the route grammar (lower-case kebab-case segments, at most four deep).",
};

const WARNINGS: ReadonlySet<ContentDiagnosticCode> = new Set([
  "CONTENT_HEADING_SKIPPED",
  "CONTENT_LINK_ANCHOR_MISSING",
  "NAVIGATION_PAGE_ORPHANED",
]);

export function contentSeverity(
  code: ContentDiagnosticCode,
): ContentDiagnosticSeverity {
  return WARNINGS.has(code) ? "warning" : "error";
}

export function createContentDiagnostic(
  code: ContentDiagnosticCode,
  path: string,
  location?: ContentLocation,
): ContentDiagnostic {
  return {
    code,
    message: CONTENT_DIAGNOSTIC_MESSAGES[code],
    path,
    severity: contentSeverity(code),
    ...(location === undefined
      ? {}
      : { column: location.column, line: location.line }),
  };
}

/** Errors first, then by path, line, column, and code. */
export function sortContentDiagnostics(
  diagnostics: readonly ContentDiagnostic[],
): readonly ContentDiagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      Number(left.severity === "warning") -
        Number(right.severity === "warning") ||
      compare(left.path, right.path) ||
      (left.line ?? 0) - (right.line ?? 0) ||
      (left.column ?? 0) - (right.column ?? 0) ||
      compare(left.code, right.code),
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
