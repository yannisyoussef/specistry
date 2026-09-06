/**
 * Route and anchor slugs for authored content. Both grammars are strict so
 * routes and ids are deterministic, URL-safe, and never derived from
 * unsanitized author text without normalization.
 */

/** One route segment: lower-case kebab-case, ASCII letters and digits. */
export const ROUTE_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_ROUTE_DEPTH = 4;
export const MAX_SEGMENT_LENGTH = 80;
export const DOCS_ROUTE_PREFIX = "/docs";

/** Validates a route slug such as `getting-started/authentication`. */
export function isRouteSlug(slug: string): boolean {
  if (slug === "") return true;
  const segments = slug.split("/");
  return (
    segments.length <= MAX_ROUTE_DEPTH &&
    segments.every(
      (segment) =>
        ROUTE_SEGMENT.test(segment) && segment.length <= MAX_SEGMENT_LENGTH,
    )
  );
}

/** Public route of a slug: the homepage for `""`, `/docs/<slug>` otherwise. */
export function routeOf(slug: string): string {
  return slug === "" ? "/" : `${DOCS_ROUTE_PREFIX}/${slug}`;
}

/**
 * Slug of a docs-relative source path: the extension is dropped, `index`
 * files map to their directory, and the result must satisfy the grammar.
 * Returns `undefined` when it does not (the caller reports ROUTE_SLUG_INVALID).
 */
export function slugFromSourcePath(relativePath: string): string | undefined {
  const withoutExtension = relativePath.replace(/\.(?:md|mdx)$/i, "");
  const segments = withoutExtension.split("/");
  if (segments.at(-1) === "index") segments.pop();
  const slug = segments.join("/");
  return isRouteSlug(slug) ? slug : undefined;
}

const MAX_ANCHOR_LENGTH = 80;

/** Heading id: NFKD, lower-case, ASCII letters/digits with single hyphens. */
export function anchorSlug(text: string): string {
  const ascii = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ANCHOR_LENGTH)
    .replace(/-+$/g, "");
  return ascii.length === 0 ? "section" : ascii;
}

/**
 * Makes anchor ids unique within one page: the first occurrence keeps the
 * slug, later ones gain `-2`, `-3`, … in document order. Reserved ids used by
 * the reader shell are avoided the same way.
 */
export function uniqueAnchors(
  candidates: readonly string[],
  reserved: ReadonlySet<string> = RESERVED_ANCHORS,
): readonly string[] {
  const taken = new Set<string>(reserved);
  const result: string[] = [];
  for (const candidate of candidates) {
    let id = candidate;
    let suffix = 2;
    while (taken.has(id)) {
      id = `${candidate}-${suffix}`;
      suffix += 1;
    }
    taken.add(id);
    result.push(id);
  }
  return result;
}

/** Ids the reader shell already uses on every page. */
export const RESERVED_ANCHORS: ReadonlySet<string> = new Set([
  "content",
  "api-navigation",
  "api-sidebar",
  "api-sidebar-region",
  "outline",
]);
