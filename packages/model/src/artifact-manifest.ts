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
}

export interface ArtifactManifest {
  readonly artifactFormat: typeof ARTIFACT_MANIFEST_FORMAT;
  readonly modelVersion: typeof DOCUMENT_MODEL_VERSION;
  readonly generator: "specra";
  readonly project: { readonly id: string; readonly name: string };
  readonly files: {
    readonly documentation: typeof ARTIFACT_DOCUMENTATION_FILENAME;
  };
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
    !hasOnlyKeys(value.files, ["documentation"]) ||
    value.files.documentation !== ARTIFACT_DOCUMENTATION_FILENAME
  ) {
    throw new TypeError(
      "Artifact manifest project or file entries are invalid.",
    );
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
      "references",
      "schemas",
    ]) ||
    !isCount(statistics.documents) ||
    !isCount(statistics.operations) ||
    !isCount(statistics.references) ||
    !isCount(statistics.schemas)
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
    diagnostics: { errors: 0, warnings: diagnostics.warnings },
    files: { documentation: ARTIFACT_DOCUMENTATION_FILENAME },
    generator: "specra",
    modelVersion: DOCUMENT_MODEL_VERSION,
    project: { id: value.project.id, name: value.project.name },
    sources,
    statistics: {
      documents: statistics.documents,
      operations: statistics.operations,
      references: statistics.references,
      schemas: statistics.schemas,
    },
  };
}

const MANIFEST_KEYS = [
  "artifactFormat",
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
