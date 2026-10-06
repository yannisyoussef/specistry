/**
 * `specistry check` and `specistry diff` (SPEC-011 §11–§17). Both commands are
 * read-only orchestration: they resolve the artifact sets the author named,
 * hand them to `@specistry/quality` and to the SPEC-010 diff port, and turn
 * the result into a diagnostic list and an exit outcome. No quality
 * semantics live here — this module contains no rule, no severity
 * decision, and no compatibility judgement.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ContentArtifact, NavigationArtifact } from "@specistry/content";
import {
  parseContentArtifact,
  parseNavigationArtifact,
} from "@specistry/content";
import type { DocumentationArtifact } from "@specistry/model";
import { parseDocumentationArtifact } from "@specistry/model";
import {
  collectFacts,
  evaluateQuality,
  parsePolicy,
  QUALITY_MESSAGES,
  QualityContractError,
  type QualityDiagnostic,
  type QualityEvaluation,
} from "@specistry/quality";
import {
  diffArtifacts,
  findRelease,
  parseReleaseManifest,
  RELEASE_MANIFEST_FILENAME,
  type ContractDiff,
  type ReleaseManifest,
} from "@specistry/release";
import type { SnippetsArtifact } from "@specistry/snippets";
import { parseSnippetsArtifact } from "@specistry/snippets";

import type {
  BuildContext,
  CheckOptions,
  CheckResult,
  Diagnostic,
  DiffCommandOptions,
  DiffCommandResult,
  FailureResult,
} from "./contracts.js";
import { createDiagnostic } from "./diagnostics.js";
import { createBuildContext } from "./orchestrator.js";
import {
  operationRoutes,
  readCandidate,
  readCatalog,
  releaseStore,
} from "./release.js";

/** The literal an author writes to mean the mutable candidate build. */
export const CANDIDATE_SOURCE = "candidate";
/** The literal that resolves through the catalog to the selected release. */
export const CURRENT_SOURCE = "current";

export interface ResolvedSource {
  /** `candidate`, or the release id exactly as the catalog spells it. */
  readonly version: string;
  readonly kind: "candidate" | "release";
  readonly artifact: DocumentationArtifact;
  readonly content?: ContentArtifact;
  readonly navigation?: NavigationArtifact;
  readonly snippets?: SnippetsArtifact;
}

function cliPath(pointer: string): string {
  return `cli#${pointer}`;
}

function failure(
  outcome: "internal-failure" | "validation-failure",
  diagnostics: readonly Diagnostic[],
): FailureResult {
  return { diagnostics, ok: false, outcome };
}

function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Reads one retained release, verifying every component against
 * `release.json` before parsing it. A release whose bytes disagree with its
 * manifest is refused rather than analysed.
 */
async function readRelease(
  store: string,
  version: string,
  pointer: string,
): Promise<
  { readonly ok: true; readonly source: ResolvedSource } | FailureResult
> {
  const invalid = (): FailureResult =>
    failure("validation-failure", [
      createDiagnostic("RELEASE_MANIFEST_INVALID", cliPath(pointer)),
    ]);
  const directory = path.join(store, version);
  let manifest: ReleaseManifest;
  try {
    manifest = parseReleaseManifest(
      await readFile(path.join(directory, RELEASE_MANIFEST_FILENAME), "utf8"),
    );
  } catch {
    return invalid();
  }
  if (manifest.version !== version) return invalid();
  const component = async (
    name: "content" | "documentation" | "navigation" | "snippets",
  ): Promise<string | undefined> => {
    const record = manifest.components[name];
    if (record === undefined) return undefined;
    let text: string;
    try {
      text = await readFile(path.join(directory, record.file), "utf8");
    } catch {
      throw new QualityContractError("missing component");
    }
    if (
      sha256Of(text) !== record.sha256 ||
      Buffer.byteLength(text, "utf8") !== record.bytes
    ) {
      throw new QualityContractError("component digest mismatch");
    }
    return text;
  };
  try {
    const documentationText = await component("documentation");
    if (documentationText === undefined) return invalid();
    const contentText = await component("content");
    const navigationText = await component("navigation");
    const snippetsText = await component("snippets");
    return {
      ok: true,
      source: {
        artifact: parseDocumentationArtifact(documentationText),
        kind: "release",
        version,
        ...(contentText === undefined
          ? {}
          : { content: parseContentArtifact(contentText) }),
        ...(navigationText === undefined
          ? {}
          : { navigation: parseNavigationArtifact(navigationText) }),
        ...(snippetsText === undefined
          ? {}
          : { snippets: parseSnippetsArtifact(snippetsText) }),
      },
    };
  } catch {
    return invalid();
  }
}

/**
 * Resolves `candidate`, `current`, or an exact release id into one artifact
 * set. `current` is looked up in the catalog; nothing is ever inferred from
 * version ordering (SPEC-010 and SPEC-011 §91).
 */
export async function resolveSource(
  context: BuildContext,
  source: string,
  pointer: string,
): Promise<
  { readonly ok: true; readonly source: ResolvedSource } | FailureResult
> {
  if (source === CANDIDATE_SOURCE) {
    const candidate = await readCandidate(context);
    if (!candidate.ok)
      return failure("validation-failure", candidate.diagnostics);
    let snippets: SnippetsArtifact | undefined;
    const snippetsFile = candidate.candidate.files.find(
      (file) => file.name === candidate.candidate.manifest.files.snippets,
    );
    if (snippetsFile !== undefined) {
      try {
        snippets = parseSnippetsArtifact(snippetsFile.text);
      } catch {
        return failure("validation-failure", [
          createDiagnostic(
            "CANDIDATE_INVALID",
            `artifact#/${snippetsFile.name}`,
          ),
        ]);
      }
    }
    return {
      ok: true,
      source: {
        artifact: candidate.candidate.artifact,
        kind: "candidate",
        version: CANDIDATE_SOURCE,
        ...(candidate.candidate.content === undefined
          ? {}
          : { content: candidate.candidate.content }),
        ...(candidate.candidate.navigation === undefined
          ? {}
          : { navigation: candidate.candidate.navigation }),
        ...(snippets === undefined ? {} : { snippets }),
      },
    };
  }
  const store = await releaseStore(context);
  if (store === undefined) {
    return failure("validation-failure", [
      createDiagnostic("VERSION_NOT_FOUND", cliPath(pointer)),
    ]);
  }
  const catalogResult = await readCatalog(store);
  if (!catalogResult.ok) return catalogResult;
  const catalog = catalogResult.catalog;
  const version =
    source === CURRENT_SOURCE ? catalog?.current : (source as string);
  if (
    catalog === undefined ||
    version === undefined ||
    findRelease(catalog, version) === undefined
  ) {
    return failure("validation-failure", [
      createDiagnostic("VERSION_NOT_FOUND", cliPath(pointer)),
    ]);
  }
  return await readRelease(store, version, pointer);
}

function qualityDiagnostics(
  diagnostics: readonly QualityDiagnostic[],
): readonly Diagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: QUALITY_MESSAGES[diagnostic.code],
    path: `config#/quality${diagnostic.path}`,
    severity: "error" as const,
  }));
}

/**
 * `specistry check`: evaluates the selected documentation against the project's
 * quality policy. Read-only — nothing is written, rebuilt, or promoted.
 */
export async function checkProject(
  options: CheckOptions = {},
): Promise<CheckResult> {
  const contextResult = await createBuildContext(options);
  if (!contextResult.ok) return contextResult;
  const { context } = contextResult;

  const policyResult = parsePolicy(context.config.quality);
  if (policyResult.diagnostics.length > 0) {
    return failure(
      "validation-failure",
      qualityDiagnostics(policyResult.diagnostics),
    );
  }

  const targetName = options.version ?? CANDIDATE_SOURCE;
  const targetResult = await resolveSource(context, targetName, "/version");
  if (!targetResult.ok) return targetResult;
  if (context.signal.aborted) {
    return failure("internal-failure", [createDiagnostic("CANCELLED")]);
  }

  let comparison:
    | { artifact: DocumentationArtifact; diff: ContractDiff; from: string }
    | undefined;
  if (options.from !== undefined) {
    const baseResult = await resolveSource(context, options.from, "/from");
    if (!baseResult.ok) return baseResult;
    const base = baseResult.source;
    comparison = {
      artifact: base.artifact,
      diff: diffArtifacts(
        {
          artifact: base.artifact,
          routes: operationRoutes(base.artifact),
          version: base.version,
        },
        {
          artifact: targetResult.source.artifact,
          routes: operationRoutes(targetResult.source.artifact),
          version: targetResult.source.version,
        },
      ),
      from: base.version,
    };
  }

  const source = targetResult.source;
  const facts = collectFacts({
    artifact: source.artifact,
    target: {
      kind: source.kind,
      ...(source.kind === "release" ? { version: source.version } : {}),
    },
    ...(source.content === undefined ? {} : { content: source.content }),
    ...(source.navigation === undefined
      ? {}
      : { navigation: source.navigation }),
    ...(source.snippets === undefined ? {} : { snippets: source.snippets }),
    ...(comparison === undefined ? {} : { comparison }),
  });

  let quality: QualityEvaluation;
  try {
    quality = evaluateQuality(facts, { policy: policyResult.policy });
  } catch (error) {
    // A rule that throws must never look like a clean report (SPEC-011 §74).
    void error;
    return failure("internal-failure", [createDiagnostic("INTERNAL_ERROR")]);
  }

  if (quality.summary.gate === "failed") {
    return {
      context,
      diagnostics: [],
      ok: false,
      outcome: "quality-failure",
      quality,
    };
  }
  return { context, diagnostics: [], ok: true, outcome: "success", quality };
}

/**
 * `specistry diff`: the public view of the SPEC-010 structured diff. It
 * classifies nothing, writes nothing, and never touches the private
 * candidate review file or the changelog.
 */
export async function diffDocumentation(
  options: DiffCommandOptions,
): Promise<DiffCommandResult> {
  const contextResult = await createBuildContext(options);
  if (!contextResult.ok) return contextResult;
  const { context } = contextResult;
  const fromResult = await resolveSource(context, options.from, "/from");
  if (!fromResult.ok) return fromResult;
  const toResult = await resolveSource(
    context,
    options.to ?? CANDIDATE_SOURCE,
    "/to",
  );
  if (!toResult.ok) return toResult;
  if (context.signal.aborted) {
    return failure("internal-failure", [createDiagnostic("CANCELLED")]);
  }
  const diff = diffArtifacts(
    {
      artifact: fromResult.source.artifact,
      routes: operationRoutes(fromResult.source.artifact),
      version: fromResult.source.version,
    },
    {
      artifact: toResult.source.artifact,
      routes: operationRoutes(toResult.source.artifact),
      version: toResult.source.version,
    },
  );
  const diagnostics: Diagnostic[] = diff.truncated
    ? [createDiagnostic("DIFF_TRUNCATED", cliPath("/to"))]
    : [];
  return { context, diagnostics, diff, ok: true, outcome: "success" };
}
