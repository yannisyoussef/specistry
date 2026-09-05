import process from "node:process";
import { pathToFileURL } from "node:url";

import type { SpecraConfig } from "@specra/config";

import { loadConfigIsolated } from "./config-loader.js";
import {
  ARTIFACT_DIRECTORY,
  DEFAULT_CONFIG_TIMEOUT_MS,
  MAX_CONFIG_TIMEOUT_MS,
  MIN_CONFIG_TIMEOUT_MS,
  type BuildContext,
  type BuildPaths,
  type DeepReadonly,
  type Diagnostic,
  type ValidationOptions,
  type ValidationResult,
} from "./contracts.js";
import { createDiagnostic, sortDiagnostics } from "./diagnostics.js";
import {
  resolveExistingProjectPath,
  resolveFutureProjectPath,
  resolveProjectRoot,
  type ExistingPathResult,
} from "./path-policy.js";

const CONFIG_FILENAME = "specra.config.ts";

export async function createBuildContext(
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) return cancelled();

  const timeoutMs = options.configTimeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS;
  if (!isValidTimeout(timeoutMs)) {
    return failure("internal-failure", [createDiagnostic("INTERNAL_ERROR")]);
  }

  try {
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = await resolveProjectRoot(options.root ?? ".", cwd);
    if (projectRoot === undefined) {
      return failure("validation-failure", [
        createDiagnostic("PROJECT_ROOT_INVALID", "root"),
      ]);
    }
    if (signal.aborted) return cancelled();

    const configResolution = await resolveExistingProjectPath(
      projectRoot,
      CONFIG_FILENAME,
      "file",
    );
    if (!configResolution.ok) {
      const code =
        configResolution.kind === "missing"
          ? "CONFIG_NOT_FOUND"
          : configResolution.kind === "outside"
            ? "CONFIG_PATH_OUTSIDE_ROOT"
            : "CONFIG_LOAD_FAILED";
      return failure("validation-failure", [createDiagnostic(code, "config")]);
    }

    const loaded = await loadConfigIsolated({
      configUrl: pathToFileURL(configResolution.path),
      signal,
      timeoutMs,
    });
    if (!loaded.ok) {
      if (loaded.code === "CANCELLED") return cancelled();
      const paths =
        loaded.issuePaths === undefined || loaded.issuePaths.length === 0
          ? ["config"]
          : loaded.issuePaths;
      return failure(
        "validation-failure",
        paths.map((path) => createDiagnostic(loaded.code, path)),
      );
    }
    if (signal.aborted) return cancelled();

    const pathResult = await resolveConfiguredPaths(projectRoot, loaded.config);
    if (!pathResult.ok) {
      return failure("validation-failure", pathResult.diagnostics);
    }
    if (signal.aborted) return cancelled();

    const context: BuildContext = Object.freeze({
      config: deepFreeze(loaded.config),
      configPath: configResolution.path,
      paths: deepFreeze(pathResult.paths),
      projectRoot,
      signal,
    });
    return { context, diagnostics: [], ok: true, outcome: "success" };
  } catch {
    return failure("internal-failure", [createDiagnostic("INTERNAL_ERROR")]);
  }
}

export async function validateProject(
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  return await createBuildContext(options);
}

type ConfiguredPathsResult =
  | { readonly diagnostics: readonly Diagnostic[]; readonly ok: false }
  | { readonly ok: true; readonly paths: BuildPaths };

async function resolveConfiguredPaths(
  projectRoot: string,
  config: SpecraConfig,
): Promise<ConfiguredPathsResult> {
  const diagnostics: Diagnostic[] = [];
  const openapiInput = Array.isArray(config.openapi)
    ? config.openapi
    : [config.openapi];
  const openapi = await Promise.all(
    openapiInput.map(async (configuredPath, index) => {
      const label = openapiInput.length === 1 ? "openapi" : `openapi[${index}]`;
      return await resolvePath(
        projectRoot,
        configuredPath,
        "file",
        label,
        diagnostics,
      );
    }),
  );
  const docs = await resolvePath(
    projectRoot,
    config.docs,
    "directory",
    "docs",
    diagnostics,
  );

  let logo: string | undefined;
  let favicon: string | undefined;
  if (config.branding?.logo !== undefined) {
    logo = await resolvePath(
      projectRoot,
      config.branding.logo,
      "file",
      "branding.logo",
      diagnostics,
    );
  }
  if (config.branding?.favicon !== undefined) {
    favicon = await resolvePath(
      projectRoot,
      config.branding.favicon,
      "file",
      "branding.favicon",
      diagnostics,
    );
  }

  const artifact = await resolveFutureProjectPath(
    projectRoot,
    ARTIFACT_DIRECTORY,
  );
  if (!artifact.ok) {
    diagnostics.push(
      createDiagnostic(
        artifact.kind === "outside"
          ? "CONFIG_PATH_OUTSIDE_ROOT"
          : "CONFIG_PATH_INVALID",
        "artifacts",
      ),
    );
  }

  if (
    diagnostics.length > 0 ||
    docs === undefined ||
    artifact.ok === false ||
    openapi.some((entry) => entry === undefined)
  ) {
    return { diagnostics: sortDiagnostics(diagnostics), ok: false };
  }

  const branding =
    logo === undefined && favicon === undefined
      ? undefined
      : {
          ...(favicon === undefined ? {} : { favicon }),
          ...(logo === undefined ? {} : { logo }),
        };
  return {
    ok: true,
    paths: {
      artifactRoot: artifact.path,
      docs,
      openapi: openapi.filter((entry): entry is string => entry !== undefined),
      ...(branding === undefined ? {} : { branding }),
    },
  };
}

async function resolvePath(
  projectRoot: string,
  configuredPath: string,
  expected: "directory" | "file",
  label: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  const result = await resolveExistingProjectPath(
    projectRoot,
    configuredPath,
    expected,
  );
  if (result.ok) return result.path;
  diagnostics.push(pathDiagnostic(result, label));
  return undefined;
}

function pathDiagnostic(
  result: Exclude<ExistingPathResult, { ok: true }>,
  path: string,
): Diagnostic {
  switch (result.kind) {
    case "missing":
      return createDiagnostic("CONFIG_PATH_NOT_FOUND", path);
    case "outside":
      return createDiagnostic("CONFIG_PATH_OUTSIDE_ROOT", path);
    case "invalid":
    case "wrong-type":
      return createDiagnostic("CONFIG_PATH_INVALID", path);
  }
}

/**
 * Freezes a validated JSON snapshot in place, recursively. The loader only
 * ever hands over plain objects, arrays, and primitives that were rebuilt from
 * a bounded JSON frame, so there are no prototypes, accessors, or cycles to
 * consider here.
 */
function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value as DeepReadonly<T>;
}

function cancelled(): ValidationResult {
  return failure("cancelled", [createDiagnostic("CANCELLED")]);
}

function failure(
  outcome: "cancelled" | "internal-failure" | "validation-failure",
  diagnostics: readonly Diagnostic[],
): ValidationResult {
  return { diagnostics: sortDiagnostics(diagnostics), ok: false, outcome };
}

function isValidTimeout(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_CONFIG_TIMEOUT_MS &&
    value <= MAX_CONFIG_TIMEOUT_MS
  );
}
