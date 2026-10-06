import type { SpecistryConfig } from "@specistry/config";
import type { ContentDiagnosticCode } from "@specistry/content";
import type {
  QualityDiagnosticCode,
  QualityEvaluation,
} from "@specistry/quality";
import type { ContractDiff } from "@specistry/release";
import {
  ARTIFACT_DOCUMENTATION_FILENAME,
  ARTIFACT_MANIFEST_FILENAME,
  ARTIFACT_MANIFEST_FORMAT,
} from "@specistry/model";
import type {
  IngestionSourceRecord,
  IngestionStatistics,
  SourceDiagnosticCode,
} from "@specistry/openapi";

export const DEFAULT_CONFIG_TIMEOUT_MS = 5_000;
export const MIN_CONFIG_TIMEOUT_MS = 100;
export const MAX_CONFIG_TIMEOUT_MS = 60_000;
export const DEFAULT_SOURCE_TIMEOUT_MS = 30_000;
export const MIN_SOURCE_TIMEOUT_MS = 100;
export const MAX_SOURCE_TIMEOUT_MS = 600_000;
export const ARTIFACT_DIRECTORY = ".specistry/artifacts";
export const ARTIFACT_FORMAT_VERSION = ARTIFACT_MANIFEST_FORMAT;
export { ARTIFACT_DOCUMENTATION_FILENAME, ARTIFACT_MANIFEST_FILENAME };
/**
 * One canonical artifact of at most 10,000,000 code units, each up to three
 * UTF-8 bytes and doubled by JSON string escaping in the worst case, plus
 * envelope slack. A model-valid artifact therefore always fits the frame.
 */
export const MAX_INGESTION_FRAME_BYTES = 64 * 1_024 * 1_024;
export const MAX_INGESTION_REQUEST_BYTES = 128 * 1_024;
/** Configured OpenAPI documents per project; each becomes one service. */
export const MAX_INGESTION_ENTRIES = 64;

export const EXIT_CODES = {
  success: 0,
  validationFailure: 2,
  /**
   * `specistry check` ran and the quality gate failed (SPEC-011 §54, §180). It
   * is deliberately distinct from `validationFailure`, which means the
   * project or its policy could not be read.
   */
  qualityFailure: 3,
  usage: 64,
  internalFailure: 70,
  cancelled: 130,
} as const;

export type DiagnosticCode =
  | SourceDiagnosticCode
  | ContentDiagnosticCode
  | QualityDiagnosticCode
  | "ARTIFACT_INVALID"
  | "ARTIFACT_WRITE_FAILED"
  | "SEARCH_BUILD_FAILED"
  | "SNIPPETS_BUILD_FAILED"
  | "PLAYGROUND_BUILD_FAILED"
  | "PLAYGROUND_ENVIRONMENT_NOT_FOUND"
  | "PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID"
  | "PLAYGROUND_OPERATION_UNSUPPORTED"
  | "VERSION_ID_INVALID"
  | "VERSION_ALREADY_EXISTS"
  | "VERSION_NOT_FOUND"
  | "VERSION_IS_CURRENT"
  | "CATALOG_INVALID"
  | "CANDIDATE_MISSING"
  | "CANDIDATE_INVALID"
  | "RELEASE_MANIFEST_INVALID"
  | "RELEASE_WRITE_FAILED"
  | "RELEASE_LOCKED"
  | "RELEASE_LIMIT_EXCEEDED"
  | "DIFF_TRUNCATED"
  | "REDIRECT_CYCLE"
  | "REDIRECT_DESTINATION_INVALID"
  | "REDIRECT_DESTINATION_NOT_FOUND"
  | "REDIRECT_LIMIT_EXCEEDED"
  | "REDIRECT_SOURCE_DUPLICATE"
  | "REDIRECT_SOURCE_INVALID"
  | "REDIRECT_SOURCE_SHADOWS_ROUTE"
  | "CHANGELOG_CANDIDATE_UNKNOWN"
  | "CHANGELOG_CANDIDATE_UNREVIEWED"
  | "CHANGELOG_INVALID"
  | "CHANGELOG_OPERATION_NOT_FOUND"
  | "SNIPPET_BODY_TRUNCATED"
  | "SNIPPET_HEADER_SKIPPED"
  | "SNIPPET_SERVER_UNUSABLE"
  | "SDK_ID_DUPLICATE"
  | "SDK_EXAMPLE_CODE_EMPTY"
  | "SDK_EXAMPLE_CODE_TOO_LARGE"
  | "SDK_EXAMPLE_DUPLICATE"
  | "SDK_EXAMPLE_FILE_INVALID"
  | "SDK_EXAMPLE_MISSING"
  | "SDK_EXAMPLE_TARGET_AMBIGUOUS"
  | "SDK_EXAMPLE_TARGET_NOT_FOUND"
  | "CANCELLED"
  | "CONFIG_INVALID"
  | "CONFIG_LOAD_FAILED"
  | "CONFIG_NOT_FOUND"
  | "CONFIG_NOT_SERIALIZABLE"
  | "CONFIG_PATH_INVALID"
  | "CONFIG_PATH_NOT_FOUND"
  | "CONFIG_PATH_OUTSIDE_ROOT"
  | "CONFIG_TIMEOUT"
  | "CONFIG_UNSUPPORTED"
  | "INGESTION_FAILED"
  | "INGESTION_TIMEOUT"
  | "INTERNAL_ERROR"
  | "PROJECT_ROOT_INVALID";

export type DiagnosticSeverity = "error" | "warning";

/**
 * A CLI diagnostic. `path` uses the unified grammar `scope[#pointer]` where
 * scope is `config`, `cli`, `artifact`, or `source/<project-relative path>`
 * and pointer is an RFC 6901 JSON pointer; it never contains machine paths or
 * source values.
 */
export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly path?: string;
  readonly severity: DiagnosticSeverity;
  /** 1-based source position inside an authored document, when known. */
  readonly line?: number;
  readonly column?: number;
}

export interface BuildPaths {
  readonly artifactRoot: string;
  readonly docs: string;
  readonly openapi: readonly string[];
  readonly branding?: {
    readonly favicon?: string;
    readonly logo?: string;
  };
}

/**
 * Recursively marks every property and array element of a JSON-shaped value as
 * `readonly`. It is intended for data snapshots only: functions are passed
 * through unchanged, and class instances such as `Date` or `Map` are not
 * modelled. The orchestrator deep-freezes the runtime values it types this
 * way, so callers can neither drift the snapshot away from the confined paths
 * derived from it at compile time nor at runtime.
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends (infer Element)[]
    ? readonly DeepReadonly<Element>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

/** Validated config v1 as an immutable snapshot inside a `BuildContext`. */
export type ValidatedConfig = DeepReadonly<SpecistryConfig>;

export interface BuildContext {
  readonly config: ValidatedConfig;
  readonly configPath: string;
  readonly paths: BuildPaths;
  readonly projectRoot: string;
  readonly signal: AbortSignal;
}

export interface ValidationOptions {
  /** Comparison base for diff candidates on `build` (SPEC-010). */
  readonly from?: string;
  readonly configTimeoutMs?: number;
  readonly sourceTimeoutMs?: number;
  readonly cwd?: string;
  readonly root?: string;
  readonly signal?: AbortSignal;
}

export interface SourceSummary {
  /** Project-relative POSIX path of an acquired document. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** What ingestion read and produced; never contains machine paths. */
export interface IngestionSummary {
  readonly sources: readonly SourceSummary[];
  readonly statistics: IngestionStatistics;
}

export type ValidationOutcome =
  | "cancelled"
  | "internal-failure"
  | "quality-failure"
  | "success"
  | "validation-failure";

export interface FailureResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly ok: false;
  readonly outcome: Exclude<ValidationOutcome, "success">;
}

/** Result of `createBuildContext`: configuration and paths only, no ingestion. */
export type ContextResult =
  | {
      readonly context: BuildContext;
      readonly ok: true;
      readonly outcome: "success";
    }
  | FailureResult;

export interface ValidationSuccess {
  readonly context: BuildContext;
  /** Warnings only; a successful result never carries an error. */
  readonly diagnostics: readonly Diagnostic[];
  readonly ingestion: IngestionSummary;
  /** Authored content counts (SPEC-006); zero pages means API-only. */
  readonly content: { readonly pages: number; readonly assets: number };
  /** Search documents the project produces (SPEC-007). */
  readonly search: { readonly documents: number };
  /** Code sample projections and authored SDK examples (SPEC-008). */
  readonly snippets: {
    readonly operations: number;
    readonly sdkExamples: number;
  };
  /** Browser-direct playground policy (SPEC-009). */
  readonly playground: {
    readonly enabled: boolean;
    readonly environments: number;
    readonly operations: number;
  };
  readonly ok: true;
  readonly outcome: "success";
}

export type ValidationResult = ValidationSuccess | FailureResult;

export interface ArtifactSummary {
  /** Fixed project-relative artifact directory. */
  readonly directory: string;
  /** Artifact-relative file names in canonical order. */
  readonly files: readonly string[];
  readonly bytes: number;
}

export type BuildSuccess = ValidationSuccess & {
  readonly artifacts: ArtifactSummary;
  /** Structured diff candidates written to the private candidates directory (SPEC-010). */
  readonly candidates?: {
    readonly from: string;
    readonly count: number;
    readonly truncated: boolean;
  };
};

export interface ReleaseOptions extends ValidationOptions {
  readonly version: string;
  /** Select the release as current after promotion. */
  readonly current?: boolean;
  /** Comparison base for diff candidates; defaults to the current release. */
  readonly from?: string;
  readonly noDiff?: boolean;
  readonly label?: string;
  readonly date?: string;
}

export interface ReleaseSummary {
  readonly version: string;
  readonly digest: string;
  readonly current: string;
  /** True when an identical release already existed (idempotent no-op). */
  readonly unchanged: boolean;
  readonly components: readonly string[];
  readonly bytes: number;
  readonly directory: string;
  readonly changelog: boolean;
  readonly from?: string;
  readonly candidates?: number;
}

export type ReleaseResult =
  | {
      readonly context: BuildContext;
      readonly diagnostics: readonly Diagnostic[];
      readonly ok: true;
      readonly outcome: "success";
      readonly release: ReleaseSummary;
    }
  | FailureResult;

export interface CatalogSummary {
  readonly current: string;
  readonly releases: readonly {
    readonly version: string;
    readonly digest: string;
    readonly state: "deprecated" | "supported";
    readonly changelog: boolean;
  }[];
}

export type CatalogResult =
  | {
      readonly context: BuildContext;
      readonly diagnostics: readonly Diagnostic[];
      readonly ok: true;
      readonly outcome: "success";
      readonly catalog: CatalogSummary;
    }
  | FailureResult;

export interface CheckOptions extends ValidationOptions {
  /** Retained release to check; the candidate build when omitted. */
  readonly version?: string;
  /** Comparison base that enables the compatibility rules. */
  readonly from?: string;
}

export type CheckResult =
  | {
      readonly context: BuildContext;
      readonly diagnostics: readonly Diagnostic[];
      readonly ok: false;
      readonly outcome: "quality-failure";
      readonly quality: QualityEvaluation;
    }
  | {
      readonly context: BuildContext;
      readonly diagnostics: readonly Diagnostic[];
      readonly ok: true;
      readonly outcome: "success";
      readonly quality: QualityEvaluation;
    }
  | FailureResult;

export interface DiffCommandOptions extends ValidationOptions {
  /** `candidate`, `current`, or an exact retained version id. */
  readonly from: string;
  /** Same grammar; defaults to the candidate build. */
  readonly to?: string;
}

export type DiffCommandResult =
  | {
      readonly context: BuildContext;
      readonly diagnostics: readonly Diagnostic[];
      readonly diff: ContractDiff;
      readonly ok: true;
      readonly outcome: "success";
    }
  | FailureResult;

export type BuildResult = BuildSuccess | FailureResult;

export type { IngestionSourceRecord, IngestionStatistics };
