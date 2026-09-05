import type { SpecraConfig } from "@specra/config";
import type {
  IngestionSourceRecord,
  IngestionStatistics,
  SourceDiagnosticCode,
} from "@specra/openapi";

export const DEFAULT_CONFIG_TIMEOUT_MS = 5_000;
export const MIN_CONFIG_TIMEOUT_MS = 100;
export const MAX_CONFIG_TIMEOUT_MS = 60_000;
export const DEFAULT_SOURCE_TIMEOUT_MS = 30_000;
export const MIN_SOURCE_TIMEOUT_MS = 100;
export const MAX_SOURCE_TIMEOUT_MS = 600_000;
export const ARTIFACT_DIRECTORY = ".specra/artifacts";
export const ARTIFACT_FORMAT_VERSION = 1;
export const ARTIFACT_MANIFEST_FILENAME = "manifest.json";
export const ARTIFACT_DOCUMENTATION_FILENAME = "documentation.json";
/** One canonical artifact (≤ 10,000,000 code units) plus frame envelope slack. */
export const MAX_INGESTION_FRAME_BYTES = 48 * 1_024 * 1_024;
export const MAX_INGESTION_REQUEST_BYTES = 64 * 1_024;

export const EXIT_CODES = {
  success: 0,
  validationFailure: 2,
  usage: 64,
  internalFailure: 70,
  cancelled: 130,
} as const;

export type DiagnosticCode =
  | SourceDiagnosticCode
  | "ARTIFACT_INVALID"
  | "ARTIFACT_WRITE_FAILED"
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
export type ValidatedConfig = DeepReadonly<SpecraConfig>;

export interface BuildContext {
  readonly config: ValidatedConfig;
  readonly configPath: string;
  readonly paths: BuildPaths;
  readonly projectRoot: string;
  readonly signal: AbortSignal;
}

export interface ValidationOptions {
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
  "cancelled" | "internal-failure" | "success" | "validation-failure";

export type ValidationResult =
  | {
      readonly context: BuildContext;
      /** Warnings only; a successful result never carries an error. */
      readonly diagnostics: readonly Diagnostic[];
      readonly ingestion: IngestionSummary;
      readonly ok: true;
      readonly outcome: "success";
    }
  | {
      readonly diagnostics: readonly Diagnostic[];
      readonly ok: false;
      readonly outcome: Exclude<ValidationOutcome, "success">;
    };

export interface ArtifactSummary {
  /** Fixed project-relative artifact directory. */
  readonly directory: string;
  /** Artifact-relative file names in canonical order. */
  readonly files: readonly string[];
  readonly bytes: number;
}

export type BuildResult =
  | {
      readonly artifacts: ArtifactSummary;
      readonly context: BuildContext;
      readonly diagnostics: readonly Diagnostic[];
      readonly ingestion: IngestionSummary;
      readonly ok: true;
      readonly outcome: "success";
    }
  | {
      readonly diagnostics: readonly Diagnostic[];
      readonly ok: false;
      readonly outcome: Exclude<ValidationOutcome, "success">;
    };

export type { IngestionSourceRecord, IngestionStatistics };
