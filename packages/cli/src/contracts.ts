import type { SpecraConfig } from "@specra/config";

export const DEFAULT_CONFIG_TIMEOUT_MS = 5_000;
export const MIN_CONFIG_TIMEOUT_MS = 100;
export const MAX_CONFIG_TIMEOUT_MS = 60_000;
export const ARTIFACT_DIRECTORY = ".specra/artifacts";

export const EXIT_CODES = {
  success: 0,
  validationFailure: 2,
  usage: 64,
  internalFailure: 70,
  cancelled: 130,
} as const;

export type DiagnosticCode =
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
  | "INTERNAL_ERROR"
  | "PROJECT_ROOT_INVALID";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly path?: string;
  readonly severity: "error";
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

export interface BuildContext {
  readonly config: SpecraConfig;
  readonly configPath: string;
  readonly paths: BuildPaths;
  readonly projectRoot: string;
  readonly signal: AbortSignal;
}

export interface ValidationOptions {
  readonly configTimeoutMs?: number;
  readonly cwd?: string;
  readonly root?: string;
  readonly signal?: AbortSignal;
}

export type ValidationResult =
  | {
      readonly context: BuildContext;
      readonly diagnostics: readonly [];
      readonly ok: true;
      readonly outcome: "success";
    }
  | {
      readonly diagnostics: readonly Diagnostic[];
      readonly ok: false;
      readonly outcome: "cancelled" | "internal-failure" | "validation-failure";
    };
