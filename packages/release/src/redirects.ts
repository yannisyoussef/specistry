import {
  hasOnlyKeys,
  isRecord,
  ReleaseContractError,
  sortKeys,
} from "./manifest.js";
import { scopeRoute, versionRoots, type RouteTable } from "./routes.js";
import { validateVersionId } from "./version.js";

/**
 * Validated internal redirects (SPEC-010 §56–§64). Redirects are data
 * frozen with a release: a source path that no longer exists maps to a
 * canonical route of the same release. Sources and destinations use the
 * unversioned grammar authors know (`/docs/old-page`, `/api/old/route`)
 * and are scoped to the release at validation time. A destination may name
 * another redirect's source; chains are flattened to their final route and
 * cycles fail. Sources may not shadow live routes, and nothing here can name
 * a scheme, a host, a query, or an encoded separator, so a redirect can
 * never leave the site.
 */

export const REDIRECTS_FORMAT_VERSION = 1 as const;
export const REDIRECTS_FILENAME = "redirects.json";
export const MAX_REDIRECTS = 10_000;
/** Author-reviewed route migrations are permanent; the current alias is not. */
export const MIGRATION_REDIRECT_STATUS = 308 as const;
export const ALIAS_REDIRECT_STATUS = 307 as const;

export interface RedirectInput {
  readonly from: string;
  readonly to: string;
}

export interface RedirectEntry {
  /** Versioned source path. */
  readonly from: string;
  /** Versioned canonical destination, chains already flattened. */
  readonly to: string;
  readonly status: typeof MIGRATION_REDIRECT_STATUS;
}

export interface RedirectTable {
  readonly redirectsFormat: typeof REDIRECTS_FORMAT_VERSION;
  readonly version: string;
  readonly entries: readonly RedirectEntry[];
}

export type RedirectDiagnosticCode =
  | "REDIRECT_CYCLE"
  | "REDIRECT_DESTINATION_INVALID"
  | "REDIRECT_DESTINATION_NOT_FOUND"
  | "REDIRECT_LIMIT_EXCEEDED"
  | "REDIRECT_SOURCE_DUPLICATE"
  | "REDIRECT_SOURCE_INVALID"
  | "REDIRECT_SOURCE_SHADOWS_ROUTE";

export interface RedirectDiagnostic {
  readonly code: RedirectDiagnosticCode;
  /** Index into the input list. */
  readonly index: number;
}

export const REDIRECT_MESSAGES: Readonly<
  Record<RedirectDiagnosticCode, string>
> = {
  REDIRECT_CYCLE: "The redirect is part of a cycle.",
  REDIRECT_DESTINATION_INVALID:
    "The redirect destination is not an internal documentation route.",
  REDIRECT_DESTINATION_NOT_FOUND:
    "The redirect destination is not a route of this release.",
  REDIRECT_LIMIT_EXCEEDED:
    "The project declares more redirects than the limit.",
  REDIRECT_SOURCE_DUPLICATE: "Two redirects share a source path.",
  REDIRECT_SOURCE_INVALID:
    "The redirect source is not an internal documentation route.",
  REDIRECT_SOURCE_SHADOWS_ROUTE:
    "The redirect source is a live route of this release.",
};

/** Unversioned internal route grammar: `/`, `/docs/<slugs>`, `/api/<slugs>`, optional anchor on destinations. */
const INTERNAL_ROUTE =
  /^\/(?:(?:docs|api)(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,6})?$/;
const ANCHOR = /^#[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isInternalRedirectPath(
  value: string,
  allowAnchor: boolean,
): boolean {
  if (value.length === 0 || value.length > 512) return false;
  if (/[\s\u0000-\u001f\u007f-%?\\]/.test(value)) return false;
  const hashIndex = value.indexOf("#");
  if (hashIndex !== -1) {
    if (!allowAnchor) return false;
    return (
      INTERNAL_ROUTE.test(value.slice(0, hashIndex)) &&
      ANCHOR.test(value.slice(hashIndex))
    );
  }
  return INTERNAL_ROUTE.test(value);
}

export interface RedirectValidation {
  readonly table: RedirectTable;
  readonly diagnostics: readonly RedirectDiagnostic[];
}

/**
 * Validates author redirects against the release route table and returns
 * the frozen table. Near-linear: one pass for sources, one for shadowing,
 * and one path-compression pass over the source graph for chains and cycles.
 */
export function validateRedirects(
  inputs: readonly RedirectInput[],
  routes: RouteTable,
): RedirectValidation {
  const diagnostics: RedirectDiagnostic[] = [];
  const version = routes.version;
  const roots = versionRoots(version);
  const routePaths = new Set(routes.routes.map((route) => route.path));
  if (inputs.length > MAX_REDIRECTS) {
    diagnostics.push({ code: "REDIRECT_LIMIT_EXCEEDED", index: MAX_REDIRECTS });
    return {
      diagnostics,
      table: {
        entries: [],
        redirectsFormat: REDIRECTS_FORMAT_VERSION,
        version,
      },
    };
  }
  const sources = new Map<string, number>();
  const scoped: { from: string; to: string; index: number }[] = [];
  inputs.forEach((input, index) => {
    if (!isInternalRedirectPath(input.from, false)) {
      diagnostics.push({ code: "REDIRECT_SOURCE_INVALID", index });
      return;
    }
    if (!isInternalRedirectPath(input.to, true)) {
      diagnostics.push({ code: "REDIRECT_DESTINATION_INVALID", index });
      return;
    }
    const from = scopeRoute(input.from, roots);
    const to = scopeRoute(input.to, roots);
    if (sources.has(from)) {
      diagnostics.push({ code: "REDIRECT_SOURCE_DUPLICATE", index });
      return;
    }
    if (routePaths.has(from)) {
      diagnostics.push({ code: "REDIRECT_SOURCE_SHADOWS_ROUTE", index });
      return;
    }
    sources.set(from, index);
    scoped.push({ from, index, to });
  });
  const bySource = new Map(scoped.map((entry) => [entry.from, entry]));
  const resolved = new Map<string, string | undefined>();
  const failed = new Set<number>();
  const resolve = (start: {
    from: string;
    to: string;
    index: number;
  }): string | undefined => {
    const chain: { from: string; to: string; index: number }[] = [];
    const seen = new Set<string>();
    let current: { from: string; to: string; index: number } | undefined =
      start;
    let final: string | undefined;
    for (;;) {
      if (resolved.has(current.from)) {
        final = resolved.get(current.from);
        break;
      }
      if (seen.has(current.from)) {
        for (const entry of chain) {
          if (!failed.has(entry.index)) {
            failed.add(entry.index);
            diagnostics.push({ code: "REDIRECT_CYCLE", index: entry.index });
          }
        }
        final = undefined;
        break;
      }
      seen.add(current.from);
      chain.push(current);
      const target = current.to.split("#")[0] ?? current.to;
      if (routePaths.has(target)) {
        final = current.to;
        break;
      }
      const next: { from: string; to: string; index: number } | undefined =
        bySource.get(target);
      if (next === undefined) {
        if (!failed.has(current.index)) {
          failed.add(current.index);
          diagnostics.push({
            code: "REDIRECT_DESTINATION_NOT_FOUND",
            index: current.index,
          });
        }
        final = undefined;
        break;
      }
      current = next;
    }
    for (const entry of chain) resolved.set(entry.from, final);
    return final;
  };
  const entries: RedirectEntry[] = [];
  for (const entry of scoped) {
    const final = resolve(entry);
    if (final === undefined) continue;
    entries.push({
      from: entry.from,
      status: MIGRATION_REDIRECT_STATUS,
      to: final,
    });
  }
  entries.sort((left, right) =>
    left.from < right.from ? -1 : left.from > right.from ? 1 : 0,
  );
  return {
    diagnostics,
    table: { entries, redirectsFormat: REDIRECTS_FORMAT_VERSION, version },
  };
}

export function serializeRedirectTable(table: RedirectTable): string {
  return `${JSON.stringify(sortKeys(table))}\n`;
}

const VERSIONED_PATH =
  /^\/(?:docs|api)\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*(?:#[a-z0-9]+(?:-[a-z0-9]+)*)?$/;

export function parseRedirectTable(text: string): RedirectTable {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReleaseContractError("Redirect table is not valid JSON.", "/");
  }
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["entries", "redirectsFormat", "version"])
  ) {
    throw new ReleaseContractError(
      "Redirect table shape is not recognized.",
      "/",
    );
  }
  if (value.redirectsFormat !== REDIRECTS_FORMAT_VERSION) {
    throw new ReleaseContractError(
      "Redirect table format is unsupported.",
      "/redirectsFormat",
    );
  }
  if (typeof value.version !== "string" || validateVersionId(value.version)) {
    throw new ReleaseContractError(
      "Redirect table version is invalid.",
      "/version",
    );
  }
  if (!Array.isArray(value.entries) || value.entries.length > MAX_REDIRECTS) {
    throw new ReleaseContractError(
      "Redirect entries must be a bounded list.",
      "/entries",
    );
  }
  const roots = versionRoots(value.version);
  const inside = (path: string) => {
    const bare = path.split("#")[0] ?? path;
    return (
      bare === roots.docs ||
      bare === roots.api ||
      bare.startsWith(`${roots.docs}/`) ||
      bare.startsWith(`${roots.api}/`)
    );
  };
  const seen = new Set<string>();
  const entries: RedirectEntry[] = value.entries.map((entry, index) => {
    const path = `/entries/${index}`;
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, ["from", "status", "to"]) ||
      typeof entry.from !== "string" ||
      typeof entry.to !== "string" ||
      entry.status !== MIGRATION_REDIRECT_STATUS ||
      !VERSIONED_PATH.test(entry.from) ||
      entry.from.includes("#") ||
      !VERSIONED_PATH.test(entry.to) ||
      !inside(entry.from) ||
      !inside(entry.to) ||
      entry.from === entry.to.split("#")[0]
    ) {
      throw new ReleaseContractError("Redirect entry is invalid.", path);
    }
    if (seen.has(entry.from)) {
      throw new ReleaseContractError("Redirect entries share a source.", path);
    }
    seen.add(entry.from);
    return {
      from: entry.from,
      status: MIGRATION_REDIRECT_STATUS,
      to: entry.to,
    };
  });
  return {
    entries,
    redirectsFormat: REDIRECTS_FORMAT_VERSION,
    version: value.version,
  };
}
