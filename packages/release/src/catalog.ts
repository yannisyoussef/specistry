import {
  hasOnlyKeys,
  isRecord,
  isText,
  ReleaseContractError,
  sortKeys,
} from "./manifest.js";
import { validateVersionId, versionKey } from "./version.js";

/**
 * The release catalog (`catalog.json`, SPEC-010 §17–§18, §53, §97–§100):
 * the mutable selection metadata kept apart from immutable release content.
 * It names the current release explicitly (never inferred from ordering,
 * SemVer, or timestamps), lists every retained release in creation order
 * with its aggregate digest, and carries the small lifecycle state the
 * reader shows (`supported` or `deprecated`) plus optional author-provided
 * display metadata. Changing `current` rewrites this file only.
 */

export const CATALOG_FORMAT_VERSION = 1 as const;
export const CATALOG_FILENAME = "catalog.json";
export const RELEASES_DIRECTORY = ".specra/releases";
export const CANDIDATES_DIRECTORY = ".specra/candidates";
export const MAX_RETAINED_RELEASES = 200;

export type ReleaseState = "deprecated" | "supported";

export interface CatalogRelease {
  readonly version: string;
  readonly digest: string;
  readonly state: ReleaseState;
  /** Author-provided display label; defaults to the version id. */
  readonly label?: string;
  /** Author-provided release date, `YYYY-MM-DD`; never generated. */
  readonly date?: string;
  /** Whether the release carries a published changelog. */
  readonly changelog: boolean;
}

export interface ReleaseCatalog {
  readonly catalogFormat: typeof CATALOG_FORMAT_VERSION;
  readonly current: string;
  /** Creation order; the selector shows the newest first. */
  readonly releases: readonly CatalogRelease[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export function serializeReleaseCatalog(catalog: ReleaseCatalog): string {
  return `${JSON.stringify(sortKeys(catalog), null, 2)}\n`;
}

export function parseReleaseCatalog(text: string): ReleaseCatalog {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReleaseContractError("Release catalog is not valid JSON.", "/");
  }
  return parseReleaseCatalogValue(value);
}

export function parseReleaseCatalogValue(value: unknown): ReleaseCatalog {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["catalogFormat", "current", "releases"])
  ) {
    throw new ReleaseContractError(
      "Release catalog shape is not recognized.",
      "/",
    );
  }
  if (value.catalogFormat !== CATALOG_FORMAT_VERSION) {
    throw new ReleaseContractError(
      "Release catalog format is unsupported.",
      "/catalogFormat",
    );
  }
  if (!Array.isArray(value.releases)) {
    throw new ReleaseContractError(
      "Catalog releases must be a list.",
      "/releases",
    );
  }
  if (value.releases.length === 0) {
    throw new ReleaseContractError(
      "A catalog lists at least one release.",
      "/releases",
    );
  }
  if (value.releases.length > MAX_RETAINED_RELEASES) {
    throw new ReleaseContractError(
      "Catalog exceeds the retained release limit.",
      "/releases",
    );
  }
  const releases: CatalogRelease[] = [];
  const keys = new Set<string>();
  const digests = new Set<string>();
  value.releases.forEach((entry, index) => {
    const path = `/releases/${index}`;
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, [
        "changelog",
        "date",
        "digest",
        "label",
        "state",
        "version",
      ])
    ) {
      throw new ReleaseContractError(
        "Catalog release record is invalid.",
        path,
      );
    }
    if (typeof entry.version !== "string" || validateVersionId(entry.version)) {
      throw new ReleaseContractError(
        "Catalog version id is invalid.",
        `${path}/version`,
      );
    }
    const key = versionKey(entry.version);
    if (keys.has(key)) {
      throw new ReleaseContractError(
        "Two catalog releases share a version id (case-insensitively).",
        `${path}/version`,
      );
    }
    keys.add(key);
    if (typeof entry.digest !== "string" || !SHA256.test(entry.digest)) {
      throw new ReleaseContractError(
        "Catalog release digest is invalid.",
        `${path}/digest`,
      );
    }
    // Identical content under two ids is legitimate (a re-release), but a
    // duplicated digest with a duplicated version was caught above.
    digests.add(entry.digest);
    if (entry.state !== "supported" && entry.state !== "deprecated") {
      throw new ReleaseContractError(
        "Catalog release state is invalid.",
        `${path}/state`,
      );
    }
    if (typeof entry.changelog !== "boolean") {
      throw new ReleaseContractError(
        "Catalog changelog flag is invalid.",
        `${path}/changelog`,
      );
    }
    if (entry.label !== undefined && !isText(entry.label, 80)) {
      throw new ReleaseContractError(
        "Catalog release label is invalid.",
        `${path}/label`,
      );
    }
    if (
      entry.date !== undefined &&
      (typeof entry.date !== "string" || !DATE.test(entry.date))
    ) {
      throw new ReleaseContractError(
        "Catalog release date is invalid.",
        `${path}/date`,
      );
    }
    releases.push({
      changelog: entry.changelog,
      ...(entry.date === undefined ? {} : { date: entry.date as string }),
      digest: entry.digest,
      ...(entry.label === undefined ? {} : { label: entry.label as string }),
      state: entry.state,
      version: entry.version,
    });
  });
  if (
    typeof value.current !== "string" ||
    !releases.some((release) => release.version === value.current)
  ) {
    throw new ReleaseContractError(
      "The catalog's current version is not a retained release.",
      "/current",
    );
  }
  return {
    catalogFormat: CATALOG_FORMAT_VERSION,
    current: value.current,
    releases,
  };
}

/** The release named exactly (case-sensitive) or `undefined`. */
export function findRelease(
  catalog: ReleaseCatalog,
  version: string,
): CatalogRelease | undefined {
  return catalog.releases.find((release) => release.version === version);
}

/** Selector order: newest release first, current always listed. */
export function selectorOrder(
  catalog: ReleaseCatalog,
): readonly CatalogRelease[] {
  return [...catalog.releases].reverse();
}
