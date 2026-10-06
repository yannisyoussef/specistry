import {
  createContentDiagnostic,
  sortContentDiagnostics,
  type ContentDiagnostic,
} from "./diagnostics.js";
import { routeOf } from "./slug.js";
import type { ContentPage, NavigationNode } from "./types.js";

/**
 * Configured navigation. The consumer's `specistry.config.ts` lists pages by
 * slug in the order and hierarchy readers should see; the build validates it
 * against the compiled pages and resolves labels, producing a navigation
 * artifact that describes structure only (no runtime state). Without a
 * configuration, pages appear in route order followed by the API reference.
 */

export type NavigationConfigNode =
  | string
  | { readonly page: string; readonly label?: string }
  | {
      readonly section: string;
      readonly items: readonly NavigationConfigNode[];
    }
  | { readonly api: true; readonly label?: string }
  | { readonly link: string; readonly label: string };

export const MAX_SECTION_DEPTH = 2;
export const DEFAULT_API_LABEL = "API reference";
export const DEFAULT_SECTION_LABEL = "Documentation";

export interface NavigationResult {
  readonly items: readonly NavigationNode[];
  readonly diagnostics: readonly ContentDiagnostic[];
  readonly ok: boolean;
}

const EXTERNAL = /^https?:\/\/[^\s/?#]+[^\s]*$/i;
const MAX_LABEL = 120;

/** Builds the navigation from configuration (or the default) and the pages. */
export function buildNavigation(
  config: readonly NavigationConfigNode[] | undefined,
  pages: readonly ContentPage[],
): NavigationResult {
  const diagnostics: ContentDiagnostic[] = [];
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  if (config === undefined) {
    const listed = [...pages]
      .sort((left, right) => compareRoutes(left.route, right.route))
      .filter((page) => page.slug !== "")
      .map((page): NavigationNode => ({
        kind: "page",
        label: page.sidebarTitle ?? page.title,
        route: page.route,
      }));
    const items: NavigationNode[] = [];
    if (listed.length > 0) {
      items.push({
        items: listed,
        kind: "section",
        label: DEFAULT_SECTION_LABEL,
      });
    }
    items.push({ kind: "api", label: DEFAULT_API_LABEL });
    return { diagnostics, items, ok: true };
  }
  const seenPages = new Set<string>();
  let apiCount = 0;
  const convert = (
    nodes: readonly NavigationConfigNode[],
    depth: number,
    pointer: string,
  ): NavigationNode[] => {
    const result: NavigationNode[] = [];
    nodes.forEach((node, index) => {
      const at = `${pointer}/${index}`;
      if (typeof node === "string" || "page" in node) {
        const slug = typeof node === "string" ? node : node.page;
        const page = bySlug.get(slug);
        if (page === undefined || slug === "") {
          diagnostics.push(
            createContentDiagnostic("NAVIGATION_PAGE_MISSING", at),
          );
          return;
        }
        if (seenPages.has(slug)) {
          diagnostics.push(
            createContentDiagnostic("NAVIGATION_PAGE_DUPLICATE", at),
          );
          return;
        }
        seenPages.add(slug);
        const label = typeof node === "string" ? undefined : node.label;
        if (label !== undefined && !validLabel(label)) {
          diagnostics.push(createContentDiagnostic("NAVIGATION_INVALID", at));
          return;
        }
        result.push({
          kind: "page",
          label: label ?? page.sidebarTitle ?? page.title,
          route: page.route,
        });
        return;
      }
      if ("section" in node) {
        if (depth >= MAX_SECTION_DEPTH) {
          diagnostics.push(
            createContentDiagnostic("NAVIGATION_DEPTH_EXCEEDED", at),
          );
          return;
        }
        if (!validLabel(node.section) || !Array.isArray(node.items)) {
          diagnostics.push(createContentDiagnostic("NAVIGATION_INVALID", at));
          return;
        }
        result.push({
          items: convert(node.items, depth + 1, `${at}/items`),
          kind: "section",
          label: node.section,
        });
        return;
      }
      if ("api" in node) {
        apiCount += 1;
        if (apiCount > 1) {
          diagnostics.push(
            createContentDiagnostic("NAVIGATION_API_DUPLICATE", at),
          );
          return;
        }
        if (node.label !== undefined && !validLabel(node.label)) {
          diagnostics.push(createContentDiagnostic("NAVIGATION_INVALID", at));
          return;
        }
        result.push({ kind: "api", label: node.label ?? DEFAULT_API_LABEL });
        return;
      }
      if ("link" in node) {
        if (!validLabel(node.label) || !isExternal(node.link)) {
          diagnostics.push(
            createContentDiagnostic("NAVIGATION_LINK_INVALID", at),
          );
          return;
        }
        result.push({ href: node.link, kind: "link", label: node.label });
        return;
      }
      diagnostics.push(createContentDiagnostic("NAVIGATION_INVALID", at));
    });
    return result;
  };
  const items = convert(config, 0, "config#/navigation");
  for (const page of pages) {
    if (page.slug !== "" && !seenPages.has(page.slug)) {
      diagnostics.push(
        createContentDiagnostic("NAVIGATION_PAGE_ORPHANED", page.sourcePath, {
          column: 1,
          line: 1,
        }),
      );
    }
  }
  const sorted = sortContentDiagnostics(diagnostics);
  return {
    diagnostics: sorted,
    items,
    ok: !sorted.some((diagnostic) => diagnostic.severity === "error"),
  };
}

function compareRoutes(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validLabel(label: unknown): label is string {
  return (
    typeof label === "string" &&
    label.trim().length > 0 &&
    label.length <= MAX_LABEL &&
    !/[\p{Cc}]/u.test(label)
  );
}

function isExternal(href: unknown): href is string {
  if (typeof href !== "string" || !EXTERNAL.test(href) || href.length > 2_048) {
    return false;
  }
  try {
    const url = new URL(href);
    return url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/** A page's position in the flattened reading order, for previous/next. */
export interface NavigationEntry {
  readonly kind: "api" | "page";
  readonly route: string;
  readonly label: string;
  /** Section labels from the root to the entry, for breadcrumbs. */
  readonly trail: readonly string[];
}

/**
 * Flattens the navigation into reading order. External links are skipped;
 * the API insertion is one entry whose route is `/api`.
 */
export function flattenNavigation(
  items: readonly NavigationNode[],
): readonly NavigationEntry[] {
  const entries: NavigationEntry[] = [];
  const visit = (
    nodes: readonly NavigationNode[],
    trail: readonly string[],
  ) => {
    for (const node of nodes) {
      switch (node.kind) {
        case "page":
          entries.push({
            kind: "page",
            label: node.label,
            route: node.route,
            trail,
          });
          break;
        case "api":
          entries.push({
            kind: "api",
            label: node.label,
            route: "/api",
            trail,
          });
          break;
        case "section":
          visit(node.items, [...trail, node.label]);
          break;
        case "link":
          break;
      }
    }
  };
  visit(items, []);
  return entries;
}

export { routeOf };
