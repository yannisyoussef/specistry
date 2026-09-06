import { DOCUMENT_MODEL_VERSION } from "./types.js";

/**
 * The build artifact directory contract. `documentation.json` holds the
 * canonical `DocumentationArtifact`; `manifest.json` describes it so a reader
 * can consume the directory without depending on the CLI. Everything here is
 * deterministic data: no timestamps, identifiers, or machine paths.
 */
export const ARTIFACT_MANIFEST_FORMAT = 1 as const;
export const ARTIFACT_DOCUMENTATION_FILENAME = "documentation.json";
export const ARTIFACT_MANIFEST_FILENAME = "manifest.json";

export interface ArtifactSourceRecord {
  /** Project-relative POSIX path of an ingested source document. */
  readonly path: string;
  readonly bytes: number;
  /** Lower-case hexadecimal SHA-256 of the source bytes. */
  readonly sha256: string;
}

export interface ArtifactStatistics {
  readonly documents: number;
  readonly operations: number;
  readonly references: number;
  readonly schemas: number;
  /** Authored pages in the content artifact (SPEC-006, optional). */
  readonly pages?: number;
}

export interface ArtifactAssetRecord {
  /** Artifact-relative POSIX path, e.g. `assets/0123456789abcdef.png`. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ArtifactBranding {
  /** Artifact-relative asset paths and the validated accent (SPEC-006). */
  readonly logo?: string;
  readonly favicon?: string;
  readonly accent?: string;
}

export interface ArtifactManifest {
  readonly artifactFormat: typeof ARTIFACT_MANIFEST_FORMAT;
  readonly modelVersion: typeof DOCUMENT_MODEL_VERSION;
  readonly generator: "specra";
  readonly project: { readonly id: string; readonly name: string };
  readonly files: {
    readonly documentation: typeof ARTIFACT_DOCUMENTATION_FILENAME;
    /** Present when the project has authored content (SPEC-006). */
    readonly content?: string;
    readonly navigation?: string;
  };
  readonly assets?: readonly ArtifactAssetRecord[];
  readonly branding?: ArtifactBranding;
  readonly sources: readonly ArtifactSourceRecord[];
  readonly statistics: ArtifactStatistics;
  /** A written artifact never carries errors; warnings are counted. */
  readonly diagnostics: { readonly errors: 0; readonly warnings: number };
}

const SOURCE_PATH =
  /^(?!\.\.?(?:\/|$))[^\0/\\]+(?:\/(?!\.\.?(?:\/|$))[^\0/\\]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Deterministic manifest bytes: recursively sorted keys, two-space indentation. */
export function serializeArtifactManifest(manifest: ArtifactManifest): string {
  return `${JSON.stringify(sortKeys(manifest), null, 2)}\n`;
}

/** Parses and strictly validates manifest text; throws `TypeError` otherwise. */
export function parseArtifactManifest(text: string): ArtifactManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("Artifact manifest is not valid JSON.");
  }
  if (!isRecord(value) || !hasOnlyKeys(value, MANIFEST_KEYS)) {
    throw new TypeError("Artifact manifest shape is not recognized.");
  }
  if (
    value.artifactFormat !== ARTIFACT_MANIFEST_FORMAT ||
    value.modelVersion !== DOCUMENT_MODEL_VERSION ||
    value.generator !== "specra"
  ) {
    throw new TypeError(
      "Artifact manifest format or model version is unsupported.",
    );
  }
  if (
    !isRecord(value.project) ||
    !hasOnlyKeys(value.project, ["id", "name"]) ||
    !isNonEmptyString(value.project.id) ||
    !isNonEmptyString(value.project.name) ||
    !isRecord(value.files) ||
    !hasOnlyKeys(value.files, ["content", "documentation", "navigation"]) ||
    value.files.documentation !== ARTIFACT_DOCUMENTATION_FILENAME ||
    (value.files.content !== undefined &&
      !ARTIFACT_FILENAME.test(String(value.files.content))) ||
    (value.files.navigation !== undefined &&
      !ARTIFACT_FILENAME.test(String(value.files.navigation))) ||
    (value.files.content === undefined) !==
      (value.files.navigation === undefined)
  ) {
    throw new TypeError(
      "Artifact manifest project or file entries are invalid.",
    );
  }
  const assets: ArtifactAssetRecord[] = [];
  if (value.assets !== undefined) {
    if (!Array.isArray(value.assets)) {
      throw new TypeError("Artifact manifest assets must be a list.");
    }
    for (const asset of value.assets) {
      if (
        !isRecord(asset) ||
        !hasOnlyKeys(asset, ["bytes", "path", "sha256"]) ||
        typeof asset.path !== "string" ||
        !ASSET_PATH.test(asset.path) ||
        !isCount(asset.bytes) ||
        typeof asset.sha256 !== "string" ||
        !SHA256.test(asset.sha256)
      ) {
        throw new TypeError("Artifact manifest asset record is invalid.");
      }
      assets.push({
        bytes: asset.bytes,
        path: asset.path,
        sha256: asset.sha256,
      });
    }
  }
  let branding: ArtifactBranding | undefined;
  if (value.branding !== undefined) {
    if (
      !isRecord(value.branding) ||
      !hasOnlyKeys(value.branding, ["accent", "favicon", "logo"]) ||
      (value.branding.logo !== undefined &&
        (typeof value.branding.logo !== "string" ||
          !ASSET_PATH.test(value.branding.logo))) ||
      (value.branding.favicon !== undefined &&
        (typeof value.branding.favicon !== "string" ||
          !ASSET_PATH.test(value.branding.favicon))) ||
      (value.branding.accent !== undefined &&
        (typeof value.branding.accent !== "string" ||
          !ACCENT.test(value.branding.accent)))
    ) {
      throw new TypeError("Artifact manifest branding is invalid.");
    }
    branding = {
      ...(value.branding.accent === undefined
        ? {}
        : { accent: value.branding.accent as string }),
      ...(value.branding.favicon === undefined
        ? {}
        : { favicon: value.branding.favicon as string }),
      ...(value.branding.logo === undefined
        ? {}
        : { logo: value.branding.logo as string }),
    };
  }
  if (!Array.isArray(value.sources)) {
    throw new TypeError("Artifact manifest sources must be a list.");
  }
  const sources: ArtifactSourceRecord[] = [];
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      !hasOnlyKeys(source, ["bytes", "path", "sha256"]) ||
      typeof source.path !== "string" ||
      !SOURCE_PATH.test(source.path) ||
      !isCount(source.bytes) ||
      typeof source.sha256 !== "string" ||
      !SHA256.test(source.sha256)
    ) {
      throw new TypeError("Artifact manifest source record is invalid.");
    }
    sources.push({
      bytes: source.bytes,
      path: source.path,
      sha256: source.sha256,
    });
  }
  const statistics = value.statistics;
  if (
    !isRecord(statistics) ||
    !hasOnlyKeys(statistics, [
      "documents",
      "operations",
      "pages",
      "references",
      "schemas",
    ]) ||
    !isCount(statistics.documents) ||
    !isCount(statistics.operations) ||
    !isCount(statistics.references) ||
    !isCount(statistics.schemas) ||
    (statistics.pages !== undefined && !isCount(statistics.pages))
  ) {
    throw new TypeError("Artifact manifest statistics are invalid.");
  }
  const diagnostics = value.diagnostics;
  if (
    !isRecord(diagnostics) ||
    !hasOnlyKeys(diagnostics, ["errors", "warnings"]) ||
    diagnostics.errors !== 0 ||
    !isCount(diagnostics.warnings)
  ) {
    throw new TypeError("Artifact manifest diagnostic counts are invalid.");
  }
  return {
    artifactFormat: ARTIFACT_MANIFEST_FORMAT,
    ...(value.assets === undefined ? {} : { assets }),
    ...(branding === undefined ? {} : { branding }),
    diagnostics: { errors: 0, warnings: diagnostics.warnings },
    files: {
      documentation: ARTIFACT_DOCUMENTATION_FILENAME,
      ...(value.files.content === undefined
        ? {}
        : { content: value.files.content as string }),
      ...(value.files.navigation === undefined
        ? {}
        : { navigation: value.files.navigation as string }),
    },
    generator: "specra",
    modelVersion: DOCUMENT_MODEL_VERSION,
    project: { id: value.project.id, name: value.project.name },
    sources,
    statistics: {
      documents: statistics.documents,
      operations: statistics.operations,
      ...(statistics.pages === undefined ? {} : { pages: statistics.pages }),
      references: statistics.references,
      schemas: statistics.schemas,
    },
  };
}

const ARTIFACT_FILENAME = /^[a-z][a-z0-9-]*\.json$/;
const ASSET_PATH = /^assets\/[a-f0-9]{16}\.(?:png|jpg|webp|gif|svg|ico)$/;
const ACCENT = /^#[0-9a-f]{6}$/;

const MANIFEST_KEYS = [
  "artifactFormat",
  "assets",
  "branding",
  "diagnostics",
  "files",
  "generator",
  "modelVersion",
  "project",
  "sources",
  "statistics",
];

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
