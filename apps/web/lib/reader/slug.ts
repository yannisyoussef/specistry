/**
 * URL slug rules for the reader. Slugs are a public contract, so every rule
 * here is deterministic, locale-independent, and documented in
 * `docs/design/reader-v1.md` and ADR-010.
 */

const MAX_SLUG_LENGTH = 80;

/** Lower-case ASCII slug: letters, digits, and single hyphens. */
export function slugify(text: string, fallback = "item"): string {
  const ascii = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const bounded =
    ascii.length <= MAX_SLUG_LENGTH ? ascii : truncateAtWord(ascii);
  return bounded.length === 0 ? fallback : bounded;
}

/** Cuts an over-long slug at the last word boundary inside the length bound. */
function truncateAtWord(slug: string): string {
  const cut = slug.slice(0, MAX_SLUG_LENGTH);
  const boundary = cut.lastIndexOf("-");
  return (
    boundary > MAX_SLUG_LENGTH / 2 ? cut.slice(0, boundary) : cut
  ).replace(/-+$/g, "");
}

/**
 * Slug for a contract identifier such as an `operationId`: word boundaries
 * inside camelCase, PascalCase, snake_case, and dotted names become hyphens
 * (`createInbox` → `create-inbox`, `inboxes.list_v2` → `inboxes-list-v2`).
 */
export function identifierSlug(
  identifier: string,
  fallback = "operation",
): string {
  const spaced = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return slugify(spaced, fallback);
}

/** Slug for a method and path pair when no contract identifier exists. */
export function methodPathSlug(method: string, path: string): string {
  return slugify(`${method} ${path.replace(/[{}]/g, "")}`, "operation");
}

/**
 * Makes slugs unique within one namespace by appending `-2`, `-3`, … in the
 * order the candidates are given, which callers keep canonical (sorted by
 * canonical identity), so the outcome never depends on encounter order in
 * the source document.
 */
export function uniqueSlugs(candidates: readonly string[]): readonly string[] {
  const taken = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    let slug = candidate;
    let suffix = 2;
    while (taken.has(slug)) {
      slug = `${candidate}-${suffix}`;
      suffix += 1;
    }
    taken.add(slug);
    result.push(slug);
  }
  return result;
}

/** Deep-link fragment for a response status. */
export function responseAnchor(status: {
  readonly kind: "code" | "default" | "range";
  readonly code?: number;
  readonly range?: string;
}): string {
  if (status.kind === "code") return `response-${status.code ?? 0}`;
  if (status.kind === "range")
    return `response-${(status.range ?? "").toLowerCase()}`;
  return "response-default";
}

/** Deep-link fragment for a media type block. */
export function mediaTypeAnchor(prefix: string, mediaType: string): string {
  return `${prefix}-${slugify(mediaType, "media")}`;
}
