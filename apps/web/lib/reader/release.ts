import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  ALIAS_REDIRECT_STATUS,
  CATALOG_FILENAME,
  findRelease,
  isVersionId,
  parseChangelog,
  parseRedirectTable,
  parseReleaseCatalog,
  parseReleaseManifest,
  parseRouteTable,
  RELEASE_MANIFEST_FILENAME,
  RELEASES_DIRECTORY,
  scopeRoute,
  versionRoots,
  type PublishedChangelog,
  type RedirectTable,
  type ReleaseCatalog,
  type ReleaseManifest,
  type RouteTable,
} from "@specistry/release";

import {
  projectRoot,
  readArtifactSet,
  ReaderArtifactError,
  type ReaderArtifact,
} from "./artifact";
import { readerVersion, releaseRoots } from "./scope";

/**
 * Release-scoped reading (SPEC-010 §26–§28, §98, §114–§115). The reader
 * starts from the small catalog, resolves the requested version, loads that
 * release's manifest, and only then its component artifacts, each verified
 * against the manifest digest before it is parsed. Nothing loads every
 * retained release, and the process holds a bounded number of parsed
 * releases keyed by version and aggregate identity.
 */

export const SERVE_MODE_VARIABLE = "SPECISTRY_SERVE";
export const MAX_LOADED_RELEASES = 4;
const MAX_LOADED_METADATA = 32;

export type ReaderMode = "candidate" | "releases";

export interface ReaderCatalog {
  readonly catalog: ReleaseCatalog;
  /** Project-relative store directory. */
  readonly directory: string;
}

export interface ReleaseMetadata {
  readonly manifest: ReleaseManifest;
  readonly routes: RouteTable;
  readonly redirects: RedirectTable;
  readonly changelog?: PublishedChangelog;
  readonly directory: string;
}

/** Bounded insertion-order cache with promise values (safe under concurrency). */
class BoundedCache<T> {
  private readonly entries = new Map<string, Promise<T>>();

  public constructor(private readonly capacity: number) {}

  public get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      // Refresh recency.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const loading = load().catch((error: unknown) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, loading);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return loading;
  }

  public clear(): void {
    this.entries.clear();
  }

  public get size(): number {
    return this.entries.size;
  }
}

interface CatalogEntry {
  /** Size and modification time of the catalog file the entry was read from. */
  readonly stamp: string;
  readonly loading: Promise<ReaderCatalog | undefined>;
}

const catalogs = new Map<string, CatalogEntry>();
const metadata = new BoundedCache<ReleaseMetadata>(MAX_LOADED_METADATA);
const releases = new BoundedCache<ReaderArtifact>(MAX_LOADED_RELEASES);

/** Clears every release cache; used by tests that switch projects. */
export function resetReleaseCaches(): void {
  catalogs.clear();
  metadata.clear();
  releases.clear();
}

/** How many parsed releases the process currently holds (tests measure this). */
export function loadedReleaseCount(): number {
  return releases.size;
}

export function readerMode(
  root: string = projectRoot(),
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ReaderMode> {
  if (environment[SERVE_MODE_VARIABLE] === "candidate") {
    return Promise.resolve("candidate");
  }
  return loadReaderCatalog(root).then((catalog) =>
    catalog === undefined ? "candidate" : "releases",
  );
}

/**
 * The catalog, when the project has released versions. Memoized per root
 * and re-read only when the file's size or modification time changes, so
 * `specistry current` and `specistry deprecate` take effect on the next request
 * without restarting the reader (one `stat` per request, no parse).
 */
export async function loadReaderCatalog(
  root: string = projectRoot(),
): Promise<ReaderCatalog | undefined> {
  const stamp = await catalogStamp(root);
  const existing = catalogs.get(root);
  if (existing !== undefined && existing.stamp === stamp) {
    return existing.loading;
  }
  const loading = readCatalog(root).catch((error: unknown) => {
    catalogs.delete(root);
    throw error;
  });
  catalogs.set(root, { loading, stamp });
  return loading;
}

async function catalogStamp(root: string): Promise<string> {
  try {
    const entry = await stat(
      path.join(root, RELEASES_DIRECTORY, CATALOG_FILENAME),
    );
    return `${entry.size}:${entry.mtimeMs}`;
  } catch {
    return "missing";
  }
}

async function readCatalog(root: string): Promise<ReaderCatalog | undefined> {
  const directory = path.join(root, RELEASES_DIRECTORY);
  let text: string;
  try {
    text = await readFile(path.join(directory, CATALOG_FILENAME), "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new ReaderArtifactError(
      `The release catalog ${RELEASES_DIRECTORY}/${CATALOG_FILENAME} could not be read.`,
      RELEASE_HINT,
    );
  }
  try {
    return {
      catalog: parseReleaseCatalog(text),
      directory: RELEASES_DIRECTORY,
    };
  } catch (error) {
    throw new ReaderArtifactError(
      `The release catalog ${RELEASES_DIRECTORY}/${CATALOG_FILENAME} is invalid (${describe(error)}).`,
      RELEASE_HINT,
    );
  }
}

const RELEASE_HINT =
  "Restore the release store from backup or re-run `specistry release`; the reader never falls back to another version.";

/** Release manifest, route table, redirects, and changelog: small, verified, cached. */
export function loadReleaseMetadata(
  version: string,
  root: string = projectRoot(),
): Promise<ReleaseMetadata> {
  return metadata.get(`${root}\u0000${version}`, () =>
    readMetadata(root, version),
  );
}

async function readMetadata(
  root: string,
  version: string,
): Promise<ReleaseMetadata> {
  const reader = await loadReaderCatalog(root);
  if (
    reader === undefined ||
    !isVersionId(version) ||
    findRelease(reader.catalog, version) === undefined
  ) {
    throw new ReaderArtifactError(
      `Version ${version} is not a retained release.`,
      RELEASE_HINT,
    );
  }
  const entry = findRelease(reader.catalog, version);
  const directory = `${RELEASES_DIRECTORY}/${version}`;
  const absolute = path.join(root, directory);
  const manifestText = await readReleaseFile(
    absolute,
    RELEASE_MANIFEST_FILENAME,
    directory,
  );
  let manifest: ReleaseManifest;
  try {
    manifest = parseReleaseManifest(manifestText);
  } catch (error) {
    throw new ReaderArtifactError(
      `The release manifest ${directory}/${RELEASE_MANIFEST_FILENAME} is invalid (${describe(error)}).`,
      RELEASE_HINT,
    );
  }
  if (manifest.version !== version || manifest.digest !== entry?.digest) {
    throw new ReaderArtifactError(
      `The release manifest ${directory}/${RELEASE_MANIFEST_FILENAME} does not match the catalog entry for ${version}.`,
      RELEASE_HINT,
    );
  }
  const routesText = await verifiedComponent(
    absolute,
    directory,
    manifest,
    "routes",
  );
  const redirectsText = await verifiedComponent(
    absolute,
    directory,
    manifest,
    "redirects",
  );
  if (routesText === undefined) {
    throw new ReaderArtifactError(
      `The release ${directory} has no route table.`,
      RELEASE_HINT,
    );
  }
  let routes: RouteTable;
  let redirects: RedirectTable;
  let changelog: PublishedChangelog | undefined;
  try {
    routes = parseRouteTable(routesText);
    redirects =
      redirectsText === undefined
        ? { entries: [], redirectsFormat: 1, version }
        : parseRedirectTable(redirectsText);
    const changelogText = await verifiedComponent(
      absolute,
      directory,
      manifest,
      "changelog",
    );
    changelog =
      changelogText === undefined ? undefined : parseChangelog(changelogText);
  } catch (error) {
    if (error instanceof ReaderArtifactError) throw error;
    throw new ReaderArtifactError(
      `A release component of ${directory} failed validation (${describe(error)}).`,
      RELEASE_HINT,
    );
  }
  if (
    routes.version !== version ||
    redirects.version !== version ||
    (changelog !== undefined && changelog.version !== version)
  ) {
    throw new ReaderArtifactError(
      `The components of ${directory} belong to another version.`,
      RELEASE_HINT,
    );
  }
  return {
    ...(changelog === undefined ? {} : { changelog }),
    directory,
    manifest,
    redirects,
    routes,
  };
}

/** The full artifact set of one release, verified against its manifest. */
export async function loadReaderRelease(
  version: string,
  root: string = projectRoot(),
): Promise<ReaderArtifact> {
  const meta = await loadReleaseMetadata(version, root);
  return releases.get(
    `${root}\u0000${version}\u0000${meta.manifest.digest}`,
    async () => {
      const reader = await loadReaderCatalog(root);
      if (reader === undefined)
        throw new ReaderArtifactError(
          "The release catalog disappeared.",
          RELEASE_HINT,
        );
      const view = readerVersion(reader.catalog, version);
      if (view === undefined)
        throw new ReaderArtifactError(
          `Version ${version} is not a retained release.`,
          RELEASE_HINT,
        );
      return await readArtifactSet(
        path.join(root, meta.directory),
        meta.directory,
        {
          release: meta.manifest,
          roots: releaseRoots(version),
          version: view,
        },
      );
    },
  );
}

async function verifiedComponent(
  absolute: string,
  directory: string,
  manifest: ReleaseManifest,
  name: "changelog" | "redirects" | "routes",
): Promise<string | undefined> {
  const component = manifest.components[name];
  if (component === undefined) return undefined;
  const text = await readReleaseFile(absolute, component.file, directory);
  if (
    createHash("sha256").update(text).digest("hex") !== component.sha256 ||
    Buffer.byteLength(text, "utf8") !== component.bytes
  ) {
    throw new ReaderArtifactError(
      `The release component ${directory}/${component.file} does not match the release manifest.`,
      RELEASE_HINT,
    );
  }
  return text;
}

async function readReleaseFile(
  absolute: string,
  name: string,
  directory: string,
): Promise<string> {
  try {
    return await readFile(path.join(absolute, name), "utf8");
  } catch {
    throw new ReaderArtifactError(
      `The release component ${directory}/${name} could not be read.`,
      RELEASE_HINT,
    );
  }
}

// --- route resolution -----------------------------------------------------

export type VersionRouteResolution =
  | { readonly kind: "serve"; readonly version: string }
  | {
      readonly kind: "redirect";
      readonly status: 307 | 308;
      readonly location: string;
    }
  | { readonly kind: "not-found" };

/**
 * Resolves a request path in release mode (SPEC-010 §18–§24, §56–§65):
 * mutable aliases (`/`, `/docs`, `/api`, and unversioned legacy routes that
 * exist in the current release) redirect non-permanently; frozen release
 * redirects are permanent; a known version serves its own routes and only
 * its own; an unknown version or route is a real 404. No fallback to
 * current ever happens for an explicit version.
 */
export async function resolveVersionRoute(
  pathname: string,
  root: string = projectRoot(),
): Promise<VersionRouteResolution> {
  const reader = await loadReaderCatalog(root);
  if (reader === undefined)
    throw new ReaderArtifactError("No release catalog.", RELEASE_HINT);
  const { catalog } = reader;
  const current = catalog.current;
  const currentRoots = versionRoots(current);
  if (pathname === "/" || pathname === "/docs" || pathname === "/docs/") {
    return {
      kind: "redirect",
      location: currentRoots.docs,
      status: ALIAS_REDIRECT_STATUS,
    };
  }
  if (pathname === "/api" || pathname === "/api/") {
    return {
      kind: "redirect",
      location: currentRoots.api,
      status: ALIAS_REDIRECT_STATUS,
    };
  }
  const match = /^\/(docs|api)\/([^/]+)(\/.*)?$/.exec(pathname);
  if (match === null) return { kind: "not-found" };
  const [, area, first, rest = ""] = match;
  const segment = first ?? "";
  if (findRelease(catalog, segment) !== undefined) {
    const version = segment;
    const meta = await loadReleaseMetadata(version, root);
    const clean = pathname.replace(/\/+$/, "");
    if (meta.routes.routes.some((route) => route.path === clean))
      return { kind: "serve", version };
    const redirect = meta.redirects.entries.find(
      (entry) => entry.from === clean,
    );
    if (redirect !== undefined)
      return {
        kind: "redirect",
        location: redirect.to,
        status: redirect.status,
      };
    return { kind: "not-found" };
  }
  // Not a retained version: a legacy unversioned route becomes a current
  // alias when the current release has it; anything else is unknown.
  const legacy = `/${area}/${segment}${rest}`.replace(/\/+$/, "");
  const scoped = scopeRoute(legacy, currentRoots);
  const meta = await loadReleaseMetadata(current, root);
  if (meta.routes.routes.some((route) => route.path === scoped)) {
    return {
      kind: "redirect",
      location: scoped,
      status: ALIAS_REDIRECT_STATUS,
    };
  }
  const redirect = meta.redirects.entries.find(
    (entry) => entry.from === scoped,
  );
  if (redirect !== undefined)
    return {
      kind: "redirect",
      location: redirect.to,
      status: ALIAS_REDIRECT_STATUS,
    };
  return { kind: "not-found" };
}

/** The version segment of a versioned path, when it names a retained release. */
export async function versionOfPath(
  pathname: string,
  root: string = projectRoot(),
): Promise<string | undefined> {
  const reader = await loadReaderCatalog(root);
  if (reader === undefined) return undefined;
  const match = /^\/(?:docs|api)\/([^/]+)/.exec(pathname);
  const segment = match?.[1];
  return segment !== undefined &&
    findRelease(reader.catalog, segment) !== undefined
    ? segment
    : undefined;
}

// --- content-addressed lookups --------------------------------------------

/** Which release serves `/search/index.<prefix>.json`, by digest prefix. */
export async function releaseForSearch(
  name: string,
  root: string = projectRoot(),
): Promise<string | undefined> {
  const reader = await loadReaderCatalog(root);
  if (reader === undefined) return undefined;
  const prefix = /^index\.([a-f0-9]{16})\.json$/.exec(name)?.[1];
  if (prefix === undefined) return undefined;
  for (const release of reader.catalog.releases) {
    const meta = await loadReleaseMetadata(release.version, root);
    if (meta.manifest.components.search?.sha256.startsWith(prefix))
      return release.version;
  }
  return undefined;
}

/** Which release directory holds a content-addressed asset name, if any. */
export async function releaseForAsset(
  name: string,
  root: string = projectRoot(),
): Promise<{ readonly directory: string; readonly bytes: number } | undefined> {
  const reader = await loadReaderCatalog(root);
  if (reader === undefined) return undefined;
  for (const release of reader.catalog.releases) {
    const meta = await loadReleaseMetadata(release.version, root);
    const asset = meta.manifest.assets.find(
      (entry) => entry.path === `assets/${name}`,
    );
    if (asset !== undefined)
      return { bytes: asset.bytes, directory: meta.directory };
  }
  return undefined;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : "unknown error";
}

/**
 * The artifact set that serves a request path: the candidate in candidate
 * mode; in release mode the release the path names, else the current one
 * (for aliases and the 404 page).
 */
export async function loadReaderFor(
  pathname: string,
  root: string = projectRoot(),
): Promise<ReaderArtifact> {
  if ((await readerMode(root)) === "candidate") {
    const { loadReaderArtifact } = await import("./artifact");
    return await loadReaderArtifact(root);
  }
  const reader = await loadReaderCatalog(root);
  const version =
    (await versionOfPath(pathname, root)) ?? reader?.catalog.current;
  if (version === undefined)
    throw new ReaderArtifactError("No release catalog.", RELEASE_HINT);
  return await loadReaderRelease(version, root);
}

export interface VersionSwitchTarget {
  readonly id: string;
  /** The same page in that release when it exists, else the release home. */
  readonly href: string;
  readonly counterpart: boolean;
}

/**
 * Version switch destinations for a page (SPEC-010 §49–§50, §117): the
 * semantic counterpart by identity when the target release has it, else
 * that release's home. Uses the small route tables only.
 */
export async function versionSwitchTargets(
  pathname: string,
  version: string,
  root: string = projectRoot(),
): Promise<readonly VersionSwitchTarget[]> {
  const reader = await loadReaderCatalog(root);
  if (reader === undefined) return [];
  const own = await loadReleaseMetadata(version, root);
  const clean = pathname.replace(/\/+$/, "");
  const identity = own.routes.routes.find(
    (route) => route.path === clean,
  )?.identity;
  const targets: VersionSwitchTarget[] = [];
  for (const release of [...reader.catalog.releases].reverse()) {
    const roots = versionRoots(release.version);
    if (release.version === version) {
      targets.push({ counterpart: true, href: clean, id: release.version });
      continue;
    }
    if (identity === undefined) {
      targets.push({
        counterpart: false,
        href: roots.docs,
        id: release.version,
      });
      continue;
    }
    const meta = await loadReleaseMetadata(release.version, root);
    const counterpart = meta.routes.routes.find(
      (route) => route.identity === identity,
    );
    targets.push({
      counterpart: counterpart !== undefined,
      href: counterpart?.path ?? roots.docs,
      id: release.version,
    });
  }
  return targets;
}
