import {
  buildApiRouteTree,
  type ContentArtifact,
  type NavigationArtifact,
} from "@specra/content";
import type { DocumentationArtifact } from "@specra/model";

import {
  hasOnlyKeys,
  isRecord,
  isText,
  ReleaseContractError,
  sortKeys,
} from "./manifest.js";
import { validateVersionId } from "./version.js";

/**
 * Canonical versioned routes (SPEC-010 §20, §116–§117). Every indexable
 * surface of a release lives under an immutable release identity:
 *
 *   /docs/{version}                 release home (authored index or the reference)
 *   /docs/{version}/<slug...>       authored page
 *   /docs/{version}/changelog       published release notes
 *   /api/{version}                  API reference index
 *   /api/{version}/<service>/<group>/<operation>   (service segment only with several)
 *
 * The route table is derived from the frozen artifacts by the same route
 * tree the reader renders, so there is one route truth; the reader uses it
 * for redirects, version switching, and the sitemap, and its own rendering
 * is proven equal to it in tests. Each route carries a semantic identity
 * (page slug, service id, canonical operation id) so a counterpart in
 * another release is found by identity, never by fuzzy matching.
 */

export const ROUTES_FORMAT_VERSION = 1 as const;
export const ROUTES_FILENAME = "routes.json";
export const MAX_ROUTES = 200_000;

export type RouteKind =
  "api" | "changelog" | "group" | "home" | "operation" | "page" | "service";

export interface ReleaseRoute {
  readonly path: string;
  readonly kind: RouteKind;
  /** Stable semantic identity across releases. */
  readonly identity: string;
  readonly indexable: boolean;
}

export interface RouteTable {
  readonly routesFormat: typeof ROUTES_FORMAT_VERSION;
  readonly version: string;
  readonly routes: readonly ReleaseRoute[];
}

export interface VersionRoots {
  readonly docs: string;
  readonly api: string;
}

export function versionRoots(version: string): VersionRoots {
  return { api: `/api/${version}`, docs: `/docs/${version}` };
}

/**
 * Maps an unversioned internal route as artifacts store them (`/`,
 * `/docs/x#a`, `/api/x`) into the release's canonical route space. Anything
 * else (external, mailto, anchors) is returned unchanged.
 */
export function scopeRoute(route: string, roots: VersionRoots): string {
  const hashIndex = route.indexOf("#");
  const path = hashIndex === -1 ? route : route.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : route.slice(hashIndex);
  if (path === "/" || path === "/docs" || path === "/docs/")
    return `${roots.docs}${hash}`;
  if (path.startsWith("/docs/"))
    return `${roots.docs}${path.slice("/docs".length)}${hash}`;
  if (path === "/api" || path === "/api/") return `${roots.api}${hash}`;
  if (path.startsWith("/api/"))
    return `${roots.api}${path.slice("/api".length)}${hash}`;
  return route;
}

export interface RouteTableInput {
  readonly version: string;
  readonly artifact: DocumentationArtifact;
  readonly content?: ContentArtifact | undefined;
  readonly navigation?: NavigationArtifact | undefined;
  readonly changelog: boolean;
}

export function deriveRouteTable(input: RouteTableInput): RouteTable {
  const roots = versionRoots(input.version);
  const routes: ReleaseRoute[] = [];
  routes.push({
    identity: "home",
    indexable: true,
    kind: "home",
    path: roots.docs,
  });
  for (const page of input.content?.pages ?? []) {
    if (page.slug === "") continue;
    routes.push({
      identity: `page:${page.slug}`,
      indexable: true,
      kind: "page",
      path: `${roots.docs}/${page.slug}`,
    });
  }
  if (input.changelog) {
    routes.push({
      identity: "changelog",
      indexable: true,
      kind: "changelog",
      path: `${roots.docs}/changelog`,
    });
  }
  const tree = buildApiRouteTree(input.artifact, { apiRoot: roots.api });
  routes.push({
    identity: "api",
    indexable: true,
    kind: "api",
    path: roots.api,
  });
  for (const service of tree.services) {
    if (!tree.singleService) {
      routes.push({
        identity: `service:${service.id}`,
        indexable: true,
        kind: "service",
        path: service.href,
      });
    }
    for (const group of service.groups) {
      routes.push({
        identity: `group:${service.id}~${group.name}`,
        indexable: true,
        kind: "group",
        path: group.href,
      });
      for (const operation of group.operations) {
        routes.push({
          identity: `operation:${service.id}~${operation.id}`,
          indexable: true,
          kind: "operation",
          path: operation.href,
        });
      }
    }
  }
  return {
    routes,
    routesFormat: ROUTES_FORMAT_VERSION,
    version: input.version,
  };
}

export function serializeRouteTable(table: RouteTable): string {
  return `${JSON.stringify(sortKeys(table))}\n`;
}

const ROUTE_PATH =
  /^\/(?:docs|api)\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const KINDS: ReadonlySet<string> = new Set([
  "api",
  "changelog",
  "group",
  "home",
  "operation",
  "page",
  "service",
]);

export function parseRouteTable(text: string): RouteTable {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReleaseContractError("Route table is not valid JSON.", "/");
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["routes", "routesFormat", "version"])
  ) {
    throw new ReleaseContractError("Route table shape is not recognized.", "/");
  }
  if (value.routesFormat !== ROUTES_FORMAT_VERSION) {
    throw new ReleaseContractError(
      "Route table format is unsupported.",
      "/routesFormat",
    );
  }
  if (typeof value.version !== "string" || validateVersionId(value.version)) {
    throw new ReleaseContractError(
      "Route table version is invalid.",
      "/version",
    );
  }
  if (!Array.isArray(value.routes) || value.routes.length > MAX_ROUTES) {
    throw new ReleaseContractError(
      "Route table routes must be a bounded list.",
      "/routes",
    );
  }
  const roots = versionRoots(value.version);
  const paths = new Set<string>();
  const routes: ReleaseRoute[] = value.routes.map((entry, index) => {
    const path = `/routes/${index}`;
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["identity", "indexable", "kind", "path"]) ||
      typeof entry.path !== "string" ||
      !ROUTE_PATH.test(entry.path) ||
      !(
        entry.path === roots.docs ||
        entry.path === roots.api ||
        entry.path.startsWith(`${roots.docs}/`) ||
        entry.path.startsWith(`${roots.api}/`)
      ) ||
      typeof entry.kind !== "string" ||
      !KINDS.has(entry.kind) ||
      !isText(entry.identity, 512) ||
      typeof entry.indexable !== "boolean"
    ) {
      throw new ReleaseContractError("Route record is invalid.", path);
    }
    if (paths.has(entry.path)) {
      throw new ReleaseContractError(
        "Route table contains a duplicate path.",
        path,
      );
    }
    paths.add(entry.path);
    return {
      identity: entry.identity,
      indexable: entry.indexable,
      kind: entry.kind as RouteKind,
      path: entry.path,
    };
  });
  return {
    routes,
    routesFormat: ROUTES_FORMAT_VERSION,
    version: value.version,
  };
}

/** The route in `table` with the same semantic identity, if any. */
export function findCounterpart(
  table: RouteTable,
  identity: string,
): ReleaseRoute | undefined {
  return table.routes.find((route) => route.identity === identity);
}

export function findRoute(
  table: RouteTable,
  path: string,
): ReleaseRoute | undefined {
  return table.routes.find((route) => route.path === path);
}
