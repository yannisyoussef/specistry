import type { ReleaseCatalog, ReleaseState } from "@specra/release";

/**
 * Where a reader's routes live (SPEC-010 §20–§23). Artifacts store
 * unversioned routes (`/`, `/docs/x`, `/api/x`); the reader maps them into
 * the roots of the release being served. Candidate mode (no catalog) keeps
 * the pre-versioning roots, so an unversioned project renders exactly as
 * before; a release maps everything under its immutable identity.
 */
export interface ReaderRoots {
  /** The release home (`/` in candidate mode, `/docs/{version}` for a release). */
  readonly home: string;
  /** Authored pages root (`/docs` or `/docs/{version}`). */
  readonly docs: string;
  /** API reference root (`/api` or `/api/{version}`). */
  readonly api: string;
}

export const LEGACY_ROOTS: ReaderRoots = {
  api: "/api",
  docs: "/docs",
  home: "/",
};

export function releaseRoots(version: string): ReaderRoots {
  return {
    api: `/api/${version}`,
    docs: `/docs/${version}`,
    home: `/docs/${version}`,
  };
}

/** Scopes an internal artifact href; external, mailto, and anchor hrefs pass through. */
export function scopeHref(href: string, roots: ReaderRoots): string {
  const hashIndex = href.indexOf("#");
  const path = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex);
  if (path === "/") return `${roots.home}${hash}`;
  if (path === "/docs" || path === "/docs/") return `${roots.home}${hash}`;
  if (path.startsWith("/docs/"))
    return `${roots.docs}${path.slice("/docs".length)}${hash}`;
  if (path === "/api" || path === "/api/") return `${roots.api}${hash}`;
  if (path.startsWith("/api/"))
    return `${roots.api}${path.slice("/api".length)}${hash}`;
  return href;
}

/** Deep-maps every internal `href`/`route` string of authored content into the roots. */
export function scopeContentValue<T>(value: T, roots: ReaderRoots): T {
  return walk(value, roots, 0) as T;
}

function walk(value: unknown, roots: ReaderRoots, depth: number): unknown {
  if (depth > 64 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((item) => walk(item, roots, depth + 1));
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    if (
      (key === "href" || key === "route") &&
      typeof item === "string" &&
      item.startsWith("/")
    ) {
      // Authored links were validated at build time as internal routes.
      out[key] =
        record.target === "external" || record.target === "mailto"
          ? item
          : scopeHref(item, roots);
    } else {
      out[key] = walk(item, roots, depth + 1);
    }
  }
  return out;
}

export function isUnderApi(pathname: string, roots: ReaderRoots): boolean {
  return pathname === roots.api || pathname.startsWith(`${roots.api}/`);
}

/** What the shell shows about the release being served. */
export interface ReaderVersion {
  readonly id: string;
  readonly label: string;
  readonly state: ReleaseState;
  readonly current: boolean;
  readonly changelog: boolean;
  /** Small catalog metadata for the selector, newest first. */
  readonly catalog: readonly {
    readonly id: string;
    readonly label: string;
    readonly state: ReleaseState;
    readonly current: boolean;
    readonly changelog: boolean;
    readonly date?: string;
  }[];
  readonly currentId: string;
  readonly currentLabel: string;
}

export function readerVersion(
  catalog: ReleaseCatalog,
  version: string,
): ReaderVersion | undefined {
  const release = catalog.releases.find((entry) => entry.version === version);
  if (release === undefined) return undefined;
  const current = catalog.releases.find(
    (entry) => entry.version === catalog.current,
  );
  return {
    catalog: [...catalog.releases].reverse().map((entry) => ({
      changelog: entry.changelog,
      current: entry.version === catalog.current,
      ...(entry.date === undefined ? {} : { date: entry.date }),
      id: entry.version,
      label: entry.label ?? entry.version,
      state: entry.state,
    })),
    changelog: release.changelog,
    current: release.version === catalog.current,
    currentId: catalog.current,
    currentLabel: current?.label ?? catalog.current,
    id: release.version,
    label: release.label ?? release.version,
    state: release.state,
  };
}
