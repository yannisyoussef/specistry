import {
  flattenNavigation,
  type ContentPage,
  type NavigationArtifact,
  type NavigationEntry,
  type NavigationNode,
} from "@specra/content";
import type { ArtifactBranding } from "@specra/model";

import type { ReaderIndex } from "./projection";
import { LEGACY_ROOTS, scopeContentValue, type ReaderRoots } from "./scope";

/**
 * Authored-content projection for the reader: page lookup by route, the
 * composed navigation (authored sections plus the generated API reference),
 * breadcrumbs, previous/next, and the page outline. All of it derives from
 * the content and navigation artifacts and the API index; nothing here holds
 * runtime state.
 */

export const DOCS_ROOT = "/docs";

export interface ReaderContent {
  /** Pages keyed by their served route (scoped to the release roots). */
  readonly pages: ReadonlyMap<string, ContentPage>;
  readonly roots: ReaderRoots;
  readonly navigation: NavigationArtifact;
  /** Reading order: authored pages and the single API reference entry. */
  readonly entries: readonly NavigationEntry[];
  readonly branding?: ArtifactBranding;
  /** The authored homepage (`docs/index.*`), when the project has one. */
  readonly home?: ContentPage;
}

export function createReaderContent(
  pages: readonly ContentPage[],
  navigation: NavigationArtifact,
  branding: ArtifactBranding | undefined,
  roots: ReaderRoots = LEGACY_ROOTS,
): ReaderContent {
  // Every internal href and route inside the frozen content is mapped into
  // the release's roots once, here; nothing downstream re-derives it.
  const scopedPages = pages.map((page) => scopeContentValue(page, roots));
  const scopedNavigation = scopeContentValue(navigation, roots);
  const byRoute = new Map(scopedPages.map((page) => [page.route, page]));
  const home = byRoute.get(roots.home);
  // The generated API entry is not stored in the artifact; scope it too.
  const listed = flattenNavigation(scopedNavigation.items).map((entry) =>
    entry.kind === "api" ? { ...entry, route: roots.api } : entry,
  );
  // The homepage opens the reading order even when the configured
  // navigation does not list it, so previous/next never skips it.
  const entries: readonly NavigationEntry[] =
    home === undefined || listed.some((entry) => entry.route === roots.home)
      ? listed
      : [
          { kind: "page", label: home.title, route: roots.home, trail: [] },
          ...listed,
        ];
  return {
    ...(branding === undefined ? {} : { branding }),
    entries,
    ...(home === undefined ? {} : { home }),
    navigation: scopedNavigation,
    pages: byRoute,
    roots,
  };
}

/** Sidebar model: navigation nodes with the current page marked. */
export type SidebarNode =
  | {
      readonly kind: "page";
      readonly href: string;
      readonly label: string;
      readonly current: boolean;
    }
  | { readonly kind: "link"; readonly href: string; readonly label: string }
  | {
      readonly kind: "section";
      readonly label: string;
      readonly items: readonly SidebarNode[];
      /** True when the current page lives inside this section. */
      readonly current: boolean;
    }
  | { readonly kind: "api"; readonly label: string; readonly current: boolean };

export function sidebarNodes(
  items: readonly NavigationNode[],
  currentPath: string,
  roots: ReaderRoots = LEGACY_ROOTS,
): readonly SidebarNode[] {
  const inApi =
    currentPath === roots.api || currentPath.startsWith(`${roots.api}/`);
  const visit = (nodes: readonly NavigationNode[]): SidebarNode[] =>
    nodes.map((node): SidebarNode => {
      switch (node.kind) {
        case "page":
          return {
            current: node.route === currentPath,
            href: node.route,
            kind: "page",
            label: node.label,
          };
        case "link":
          return { href: node.href, kind: "link", label: node.label };
        case "api":
          return { current: inApi, kind: "api", label: node.label };
        case "section": {
          const children = visit(node.items);
          return {
            current: children.some(
              (child) => child.kind !== "link" && child.current,
            ),
            items: children,
            kind: "section",
            label: node.label,
          };
        }
      }
    });
  return visit(items);
}

export interface PageNeighbours {
  readonly previous?: NavigationEntry;
  readonly next?: NavigationEntry;
}

/** Previous and next entries in reading order; absent at the boundaries. */
export function pageNeighbours(
  content: ReaderContent,
  route: string,
): PageNeighbours {
  const index = content.entries.findIndex((entry) => entry.route === route);
  if (index === -1) return {};
  const previous = content.entries[index - 1];
  const next = content.entries[index + 1];
  return {
    ...(previous === undefined ? {} : { previous }),
    ...(next === undefined ? {} : { next }),
  };
}

export interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
}

/**
 * Breadcrumbs derive from the navigation trail: the Docs root, the section
 * labels, then the page. Sections have no route of their own, so they read
 * as plain text. A page outside the navigation gets only the root.
 */
export function pageBreadcrumbs(
  content: ReaderContent,
  page: ContentPage,
): readonly BreadcrumbItem[] {
  if (page.route === content.roots.home) return [];
  const entry = content.entries.find(
    (candidate) => candidate.route === page.route,
  );
  const root: BreadcrumbItem = { href: content.roots.home, label: "Guides" };
  const trail = (entry?.trail ?? []).map((label): BreadcrumbItem => ({
    label,
  }));
  return [root, ...trail, { label: page.title }];
}

export interface OutlineItem {
  readonly id: string;
  readonly text: string;
  readonly depth: 2 | 3;
}

/** "On this page": level-2 and level-3 headings only. */
export function pageOutline(page: ContentPage): readonly OutlineItem[] {
  return page.headings.flatMap((heading) =>
    heading.depth === 2 || heading.depth === 3
      ? [{ depth: heading.depth, id: heading.id, text: heading.text }]
      : [],
  );
}

/** Whether the shell should show the Docs tab: any authored page exists. */
export function hasDocs(content: ReaderContent | undefined): boolean {
  return content !== undefined && content.pages.size > 0;
}

/** Route → page, also mapping `/docs` itself to the homepage. */
export function findPage(
  content: ReaderContent | undefined,
  route: string,
): ContentPage | undefined {
  if (content === undefined) return undefined;
  return content.pages.get(
    route === DOCS_ROOT || route === content.roots.docs
      ? content.roots.home
      : route,
  );
}

/** Every authored route in reading order, for the sitemap. */
export function authoredPaths(
  content: ReaderContent | undefined,
): readonly string[] {
  if (content === undefined) return [];
  const listed = content.entries
    .filter((entry) => entry.kind === "page")
    .map((entry) => entry.route);
  const orphans = [...content.pages.keys()]
    .filter((route) => !listed.includes(route))
    .sort();
  return [...listed, ...orphans];
}

/** The API index label used in the primary navigation. */
export function apiLabel(
  index: ReaderIndex,
  content: ReaderContent | undefined,
): string {
  const node = content?.navigation.items.find((entry) => entry.kind === "api");
  return node?.kind === "api" ? node.label : `API reference`;
}
