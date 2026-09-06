import process from "node:process";
import { pathToFileURL } from "node:url";

import type { SpecraConfig } from "@specra/config";
import { DEFAULT_INGESTION_LIMITS } from "@specra/openapi";

import { toDocumentId } from "./acquisition.js";
import { removeStaleArtifacts, writeArtifacts } from "./artifacts.js";
import { buildContent } from "./content.js";
import { buildSearchArtifact, countSearchDocuments } from "./search.js";
import { buildPlayground } from "./playground.js";
import { buildSnippets } from "./snippets.js";
import { loadConfigIsolated } from "./config-loader.js";
import {
  ARTIFACT_DIRECTORY,
  DEFAULT_CONFIG_TIMEOUT_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
  MAX_CONFIG_TIMEOUT_MS,
  MAX_SOURCE_TIMEOUT_MS,
  MIN_CONFIG_TIMEOUT_MS,
  MIN_SOURCE_TIMEOUT_MS,
  type BuildContext,
  type BuildPaths,
  MAX_INGESTION_ENTRIES,
  type BuildResult,
  type ContextResult,
  type DeepReadonly,
  type Diagnostic,
  type FailureResult,
  type IngestionSummary,
  type ValidationOptions,
  type ValidationResult,
} from "./contracts.js";
import {
  artifactPath,
  cliPath,
  configPath,
  createDiagnostic,
  sortDiagnostics,
  sourcePath,
} from "./diagnostics.js";
import {
  runIngestionIsolated,
  type IngestionOutcome,
} from "./ingestion-loader.js";
import {
  resolveExistingProjectPath,
  resolveFutureProjectPath,
  resolveProjectRoot,
  type ExistingPathResult,
} from "./path-policy.js";

const CONFIG_FILENAME = "specra.config.ts";

/**
 * Loads and confines the project without touching OpenAPI sources. Public
 * consumers use it to compose their own commands; `validateProject` and
 * `buildProject` build on it.
 */
export async function createBuildContext(
  options: ValidationOptions = {},
): Promise<ContextResult> {
  return await buildContext(options);
}

/** Validates configuration, paths, the OpenAPI sources, and authored content. */
export async function validateProject(
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const contextResult = await buildContext(options);
  if (!contextResult.ok) return contextResult;
  const ingested = await ingest(contextResult.context, options);
  if (!ingested.ok) return ingested;
  if (contextResult.context.signal.aborted) return cancelled();
  const content = await buildContent(
    contextResult.context,
    ingested.artifactJson,
  );
  if (!content.ok) {
    return {
      diagnostics: sortDiagnostics([
        ...ingested.diagnostics,
        ...content.diagnostics,
      ]),
      ok: false,
      outcome: "validation-failure",
    };
  }
  if (contextResult.context.signal.aborted) return cancelled();
  const snippets = await buildSnippets(
    contextResult.context,
    content.documentationJson,
  );
  if (!snippets.ok) {
    return {
      diagnostics: sortDiagnostics([
        ...ingested.diagnostics,
        ...content.diagnostics,
        ...snippets.diagnostics,
      ]),
      ok: false,
      outcome: "validation-failure",
    };
  }
  const playground = buildPlayground(
    contextResult.context,
    content.documentationJson,
    snippets.json,
  );
  const diagnostics = sortDiagnostics([
    ...ingested.diagnostics,
    ...content.diagnostics,
    ...snippets.diagnostics,
    ...playground.diagnostics,
  ]);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, ok: false, outcome: "validation-failure" };
  }
  return {
    content: { assets: content.assets.length, pages: content.pages },
    context: contextResult.context,
    diagnostics,
    ingestion: ingested.ingestion,
    ok: true,
    outcome: "success",
    playground: {
      enabled: playground.enabled,
      environments: playground.environments,
      operations: playground.operations,
    },
    search: {
      documents: countSearchDocuments(content, snippets.operationTerms),
    },
    snippets: {
      operations: snippets.operations,
      sdkExamples: snippets.sdkExamples,
    },
  };
}

/**
 * Validates, then writes the canonical artifact atomically to the fixed
 * `.specra/artifacts` directory. A failed build removes any previous artifact
 * directory so stale output can never masquerade as the current input.
 */
export async function buildProject(
  options: ValidationOptions = {},
): Promise<BuildResult> {
  const contextResult = await buildContext(options);
  if (!contextResult.ok) return contextResult;
  const context = contextResult.context;
  const ingested = await ingest(context, options);
  if (!ingested.ok) {
    if (ingested.outcome === "validation-failure") {
      await removeStaleArtifacts(
        context.projectRoot,
        context.paths.artifactRoot,
      );
    }
    return ingested;
  }
  if (context.signal.aborted) return cancelled();
  const content = await buildContent(context, ingested.artifactJson);
  if (!content.ok) {
    await removeStaleArtifacts(context.projectRoot, context.paths.artifactRoot);
    return {
      diagnostics: sortDiagnostics([
        ...ingested.diagnostics,
        ...content.diagnostics,
      ]),
      ok: false,
      outcome: "validation-failure",
    };
  }
  if (context.signal.aborted) return cancelled();
  // Code samples and SDK mappings are validated before anything is written;
  // a mapping error fails the build and removes stale artifacts.
  let snippets;
  try {
    snippets = await buildSnippets(context, content.documentationJson);
  } catch {
    await removeStaleArtifacts(context.projectRoot, context.paths.artifactRoot);
    return failure("internal-failure", [
      createDiagnostic("SNIPPETS_BUILD_FAILED", artifactPath("")),
    ]);
  }
  if (!snippets.ok) {
    await removeStaleArtifacts(context.projectRoot, context.paths.artifactRoot);
    return {
      diagnostics: sortDiagnostics([
        ...ingested.diagnostics,
        ...content.diagnostics,
        ...snippets.diagnostics,
      ]),
      ok: false,
      outcome: "validation-failure",
    };
  }
  // The playground policy is derived from the same artifacts, offline.
  let playground;
  try {
    playground = buildPlayground(
      context,
      content.documentationJson,
      snippets.json,
    );
  } catch {
    await removeStaleArtifacts(context.projectRoot, context.paths.artifactRoot);
    return failure("internal-failure", [
      createDiagnostic("PLAYGROUND_BUILD_FAILED", artifactPath("")),
    ]);
  }
  const diagnostics = sortDiagnostics([
    ...ingested.diagnostics,
    ...content.diagnostics,
    ...snippets.diagnostics,
    ...playground.diagnostics,
  ]);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    await removeStaleArtifacts(context.projectRoot, context.paths.artifactRoot);
    return { diagnostics, ok: false, outcome: "validation-failure" };
  }
  if (context.signal.aborted) return cancelled();
  // Search is part of the complete build: it is generated from the exact
  // artifacts about to be written and fails the build if it cannot be.
  let search;
  try {
    search = buildSearchArtifact(content, snippets.operationTerms);
  } catch {
    await removeStaleArtifacts(context.projectRoot, context.paths.artifactRoot);
    return failure("internal-failure", [
      createDiagnostic("SEARCH_BUILD_FAILED", artifactPath("")),
    ]);
  }
  const written = await writeArtifacts({
    artifactRoot: context.paths.artifactRoot,
    assets: content.assets,
    ...(content.branding === undefined ? {} : { branding: content.branding }),
    ...(content.contentJson === undefined
      ? {}
      : {
          contentJson: content.contentJson,
          contentSources: content.sources,
          navigationJson: content.navigationJson,
          pages: content.pages,
        }),
    documentationJson: content.documentationJson,
    ingestion: ingested.ingestion,
    project: {
      id: ingested.projectId,
      name: context.config.name,
    },
    projectRoot: context.projectRoot,
    search: { documents: search.documents, json: search.json },
    playground: {
      enabled: playground.enabled,
      environments: playground.environments,
      json: playground.json,
      operations: playground.operations,
    },
    snippets: {
      json: snippets.json,
      operations: snippets.operations,
      sdkExamples: snippets.sdkExamples,
    },
    warnings: diagnostics.length,
  });
  if (!written.ok) {
    return failure("internal-failure", [
      createDiagnostic("ARTIFACT_WRITE_FAILED", artifactPath("")),
    ]);
  }
  return {
    artifacts: written.artifacts,
    content: { assets: content.assets.length, pages: content.pages },
    context,
    diagnostics,
    ingestion: ingested.ingestion,
    ok: true,
    outcome: "success",
    playground: {
      enabled: playground.enabled,
      environments: playground.environments,
      operations: playground.operations,
    },
    search: { documents: search.documents },
    snippets: {
      operations: snippets.operations,
      sdkExamples: snippets.sdkExamples,
    },
  };
}

async function buildContext(
  options: ValidationOptions,
): Promise<ContextResult> {
  const signal = options.signal ?? new AbortController().signal;
  if (signal.aborted) return cancelled();

  const timeoutMs = options.configTimeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS;
  const sourceTimeoutMs = options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  if (
    !isValidTimeout(timeoutMs, MIN_CONFIG_TIMEOUT_MS, MAX_CONFIG_TIMEOUT_MS) ||
    !isValidTimeout(
      sourceTimeoutMs,
      MIN_SOURCE_TIMEOUT_MS,
      MAX_SOURCE_TIMEOUT_MS,
    )
  ) {
    return failure("internal-failure", [createDiagnostic("INTERNAL_ERROR")]);
  }

  try {
    const cwd = options.cwd ?? process.cwd();
    const projectRoot = await resolveProjectRoot(options.root ?? ".", cwd);
    if (projectRoot === undefined) {
      return failure("validation-failure", [
        createDiagnostic("PROJECT_ROOT_INVALID", cliPath("/root")),
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
      const labels =
        loaded.issuePaths === undefined || loaded.issuePaths.length === 0
          ? ["config"]
          : loaded.issuePaths;
      return failure(
        "validation-failure",
        labels.map((label) => createDiagnostic(loaded.code, configPath(label))),
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
    return { context, ok: true, outcome: "success" };
  } catch {
    return failure("internal-failure", [createDiagnostic("INTERNAL_ERROR")]);
  }
}

type IngestOutcome =
  | {
      readonly artifactJson: string;
      readonly diagnostics: readonly Diagnostic[];
      readonly ingestion: IngestionSummary;
      readonly ok: true;
      readonly projectId: string;
    }
  | FailureResult;

async function ingest(
  context: BuildContext,
  options: ValidationOptions,
): Promise<IngestOutcome> {
  const configured = Array.isArray(context.config.openapi)
    ? context.config.openapi
    : [context.config.openapi];
  const entries: string[] = [];
  if (configured.length > MAX_INGESTION_ENTRIES) {
    return failure("validation-failure", [
      createDiagnostic("CONFIG_PATH_INVALID", configPath("openapi")),
    ]);
  }
  for (const [index, configuredPath] of configured.entries()) {
    const id = toDocumentId(configuredPath);
    if (id === undefined) {
      return failure("validation-failure", [
        createDiagnostic(
          "CONFIG_PATH_INVALID",
          configPath(configured.length === 1 ? "openapi" : `openapi.${index}`),
        ),
      ]);
    }
    entries.push(id);
  }
  const loaded = await runIngestionIsolated({
    entries,
    limits: DEFAULT_INGESTION_LIMITS,
    project: { name: context.config.name },
    projectRoot: context.projectRoot,
    signal: context.signal,
    timeoutMs: options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS,
  });
  if (!loaded.ok) {
    if (loaded.reason === "cancelled") return cancelled();
    return failure("validation-failure", [
      createDiagnostic(
        loaded.reason === "timeout" ? "INGESTION_TIMEOUT" : "INGESTION_FAILED",
        entries[0] === undefined ? undefined : sourcePath(entries[0], ""),
      ),
    ]);
  }
  const outcome = loaded.outcome;
  const diagnostics = mapIngestionDiagnostics(outcome);
  const ingestion: IngestionSummary = {
    sources: outcome.sources.map((source) => ({
      bytes: source.bytes,
      path: source.id,
      sha256: source.sha256,
    })),
    statistics: outcome.statistics,
  };
  if (
    !outcome.ok ||
    outcome.artifact === undefined ||
    outcome.artifactJson === undefined
  ) {
    return { diagnostics, ok: false, outcome: "validation-failure" };
  }
  return {
    artifactJson: outcome.artifactJson,
    diagnostics,
    ingestion,
    ok: true,
    projectId: outcome.artifact.model.project.id,
  };
}

/** Projects host diagnostics onto the unified CLI path grammar, sorted. */
export function mapIngestionDiagnostics(
  outcome: Pick<IngestionOutcome, "artifactDiagnostics" | "diagnostics">,
): readonly Diagnostic[] {
  return sortDiagnostics([
    ...outcome.diagnostics.map((diagnostic) =>
      createDiagnostic(
        diagnostic.code,
        sourcePath(diagnostic.document, diagnostic.pointer),
      ),
    ),
    ...outcome.artifactDiagnostics.map((diagnostic) =>
      createDiagnostic("ARTIFACT_INVALID", artifactPath(diagnostic.path)),
    ),
  ]);
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
      const label = openapiInput.length === 1 ? "openapi" : `openapi.${index}`;
      return await resolvePath(
        projectRoot,
        configuredPath,
        "file",
        label,
        diagnostics,
      );
    }),
  );
  // The same document listed twice would become two services with one
  // identity; reject it as a configuration error rather than a source one.
  const seenDocuments = new Set<string>();
  openapiInput.forEach((configuredPath, index) => {
    const id = toDocumentId(configuredPath) ?? configuredPath;
    if (seenDocuments.has(id)) {
      diagnostics.push(
        createDiagnostic("CONFIG_PATH_INVALID", configPath(`openapi.${index}`)),
      );
    }
    seenDocuments.add(id);
  });
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
        artifactPath(""),
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
  diagnostics.push(pathDiagnostic(result, configPath(label)));
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

function cancelled(): FailureResult {
  return failure("cancelled", [createDiagnostic("CANCELLED")]);
}

function failure(
  outcome: "cancelled" | "internal-failure" | "validation-failure",
  diagnostics: readonly Diagnostic[],
): FailureResult {
  return { diagnostics: sortDiagnostics(diagnostics), ok: false, outcome };
}

function isValidTimeout(
  value: number,
  minimum: number,
  maximum: number,
): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}
