import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  MAX_SDK_EXAMPLE_CHARACTERS,
  parseSdkExamplesFile,
  type SdkConfig,
  type SdkExampleRecord,
} from "@specra/config";
import { highlightCode, normalizeLanguage } from "@specra/content";
import { parseDocumentationArtifact, type Operation } from "@specra/model";
import {
  operationKey,
  projectArtifact,
  serializeSnippetsArtifact,
  validateBaseUrl,
  type EnvironmentProjection,
  type SdkDeclaration,
  type SdkExample,
} from "@specra/snippets";

import type { BuildContext, Diagnostic } from "./contracts.js";
import {
  artifactPath,
  configPath,
  createDiagnostic,
  sortDiagnostics,
  sourcePath,
} from "./diagnostics.js";
import { resolveExistingProjectPath } from "./path-policy.js";

/**
 * Code samples build step (SPEC-008). Two independent inputs meet here and
 * never mix: the canonical artifact is projected into protocol request
 * projections (the reader generates cURL/HTTP/JavaScript/TypeScript/Java/
 * Python from them), and the consumer's explicit SDK examples are validated,
 * resolved to canonical operation identity, highlighted, and carried through
 * as authored text. Nothing is inferred and nothing is executed. `specra
 * validate` runs the same step so mapping diagnostics appear without a
 * build; `specra build` writes the result as `snippets.json`.
 */

export interface SnippetsBuildOutput {
  readonly ok: true;
  readonly json: string;
  readonly operations: number;
  readonly sdkExamples: number;
  readonly diagnostics: readonly Diagnostic[];
  /** Searchable SDK terms per `operationKey(serviceId, operationId)`. */
  readonly operationTerms: ReadonlyMap<string, readonly string[]>;
}

export interface SnippetsBuildFailure {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

const MAX_EXAMPLES_FILE_BYTES = 4 * 1_024 * 1_024;

interface OperationRef {
  readonly operation: Operation;
  /** `operationKey(serviceId, operationId)`: the artifact key. */
  readonly key: string;
  readonly serviceId: string;
  readonly serviceName: string;
  /** JSON pointer into the canonical artifact, for diagnostics. */
  readonly pointer: string;
}

export async function buildSnippets(
  context: BuildContext,
  documentationJson: string,
): Promise<SnippetsBuildOutput | SnippetsBuildFailure> {
  const diagnostics: Diagnostic[] = [];
  const artifact = parseDocumentationArtifact(documentationJson);
  const refs = new Map<string, OperationRef>();
  artifact.model.versions.forEach((version, versionIndex) => {
    version.services.forEach((service, serviceIndex) => {
      service.operations.forEach((operation, operationIndex) => {
        const key = operationKey(service.id, operation.id);
        refs.set(key, {
          key,
          operation,
          pointer: `/model/versions/${versionIndex}/services/${serviceIndex}/operations/${operationIndex}`,
          serviceId: service.id,
          serviceName: service.name,
        });
      });
    });
  });

  const projected = projectArtifact(artifact);
  for (const diagnostic of projected.diagnostics) {
    const ref = refs.get(diagnostic.key);
    diagnostics.push(
      createDiagnostic(
        diagnostic.code,
        artifactPath(ref === undefined ? "" : ref.pointer),
      ),
    );
  }

  const environments: EnvironmentProjection[] = [];
  for (const [id, environment] of Object.entries(context.config.environments)) {
    const baseUrl = validateBaseUrl(environment.baseUrl);
    // The config schema already enforced the policy; this only normalizes.
    if (baseUrl === undefined) continue;
    environments.push({ baseUrl, id, label: environment.label ?? id });
  }

  const sdks: SdkDeclaration[] = [];
  const sdkExamples = new Map<string, SdkExample[]>();
  const operationTerms = new Map<string, string[]>();
  const seenIds = new Set<string>();
  const configuredSdks = context.config.sdks as readonly SdkConfig[];
  for (const [sdkIndex, sdk] of configuredSdks.entries()) {
    const sdkPointer = `sdks.${sdkIndex}`;
    if (seenIds.has(sdk.id)) {
      diagnostics.push(
        createDiagnostic("SDK_ID_DUPLICATE", configPath(`${sdkPointer}.id`)),
      );
      continue;
    }
    seenIds.add(sdk.id);
    sdks.push({
      coverage: sdk.coverage,
      id: sdk.id,
      label: sdk.label,
      language: sdk.language,
      ...(sdk.package === undefined ? {} : { package: sdk.package }),
    });
    const examples = await loadExamples(context, sdk, sdkPointer, diagnostics);
    const covered = new Set<string>();
    for (const { example, location } of examples) {
      const target = resolveTarget(example, refs);
      if (target === "not-found" || target === "ambiguous") {
        diagnostics.push(
          createDiagnostic(
            target === "not-found"
              ? "SDK_EXAMPLE_TARGET_NOT_FOUND"
              : "SDK_EXAMPLE_TARGET_AMBIGUOUS",
            location,
          ),
        );
        continue;
      }
      if (covered.has(target.key)) {
        diagnostics.push(createDiagnostic("SDK_EXAMPLE_DUPLICATE", location));
        continue;
      }
      const code = await loadCode(context, example, location, diagnostics);
      if (code === undefined) continue;
      covered.add(target.key);
      const lines = await highlightCode(code, normalizeLanguage(sdk.language));
      const list = sdkExamples.get(target.key) ?? [];
      list.push({
        code,
        lines,
        sdk: sdk.id,
        ...(example.title === undefined ? {} : { title: example.title }),
        ...(example.description === undefined
          ? {}
          : { description: example.description }),
      });
      sdkExamples.set(target.key, list);
      // The SDK label makes "typescript sdk create inbox" find the
      // operation; package names are not indexed because their tokens
      // (`email.testinbox:sdk`) would outrank real matches.
      const terms = operationTerms.get(target.key) ?? [];
      terms.push(sdk.label);
      operationTerms.set(target.key, terms);
    }
    if (sdk.coverage === "complete") {
      for (const ref of refs.values()) {
        if (covered.has(ref.key)) continue;
        diagnostics.push(
          createDiagnostic("SDK_EXAMPLE_MISSING", artifactPath(ref.pointer)),
        );
      }
    }
  }

  const sorted = sortDiagnostics(diagnostics);
  if (sorted.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics: sorted, ok: false };
  }
  const json = serializeSnippetsArtifact({
    environments,
    operations: projected.operations,
    sdkExamples: Object.fromEntries(
      [...sdkExamples.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    ),
    sdks,
    snippetsVersion: 1,
  });
  return {
    diagnostics: sorted,
    json,
    ok: true,
    operationTerms,
    operations: Object.keys(projected.operations).length,
    sdkExamples: [...sdkExamples.values()].reduce(
      (total, list) => total + list.length,
      0,
    ),
  };
}

interface LocatedExample {
  readonly example: SdkExampleRecord;
  /** Diagnostic path of the example record. */
  readonly location: string;
}

/** Inline examples, or the records of the configured JSON file, confined to the project. */
async function loadExamples(
  context: BuildContext,
  sdk: SdkConfig,
  sdkPointer: string,
  diagnostics: Diagnostic[],
): Promise<readonly LocatedExample[]> {
  if (typeof sdk.examples !== "string") {
    return sdk.examples.map((example, index) => ({
      example,
      location: configPath(`${sdkPointer}.examples.${index}`),
    }));
  }
  const configured = sdk.examples;
  const resolved = await resolveExistingProjectPath(
    context.projectRoot,
    configured,
    "file",
  );
  const location = configPath(`${sdkPointer}.examples`);
  if (!resolved.ok) {
    diagnostics.push(createDiagnostic("SDK_EXAMPLE_FILE_INVALID", location));
    return [];
  }
  let parsed;
  try {
    const bytes = await readFile(resolved.path);
    if (bytes.byteLength > MAX_EXAMPLES_FILE_BYTES) throw new Error("size");
    parsed = parseSdkExamplesFile(JSON.parse(bytes.toString("utf8")));
  } catch {
    diagnostics.push(createDiagnostic("SDK_EXAMPLE_FILE_INVALID", location));
    return [];
  }
  const projectRelative = toPosix(
    path.relative(context.projectRoot, resolved.path),
  );
  return parsed.examples.map((example, index) => ({
    example,
    location: sourcePath(projectRelative, `/examples/${index}`),
  }));
}

/** Inline code or the confined, bounded, UTF-8 contents of the example file. */
async function loadCode(
  context: BuildContext,
  example: SdkExampleRecord,
  location: string,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  let code = example.code;
  if (code === undefined && example.file !== undefined) {
    const resolved = await resolveExistingProjectPath(
      context.projectRoot,
      example.file,
      "file",
    );
    if (!resolved.ok) {
      diagnostics.push(createDiagnostic("SDK_EXAMPLE_FILE_INVALID", location));
      return undefined;
    }
    const bytes = await readFile(resolved.path);
    if (bytes.byteLength > MAX_SDK_EXAMPLE_CHARACTERS * 4) {
      diagnostics.push(
        createDiagnostic("SDK_EXAMPLE_CODE_TOO_LARGE", location),
      );
      return undefined;
    }
    code = bytes.toString("utf8");
  }
  const normalized = (code ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
  if (normalized.trim().length === 0) {
    diagnostics.push(createDiagnostic("SDK_EXAMPLE_CODE_EMPTY", location));
    return undefined;
  }
  if (normalized.length > MAX_SDK_EXAMPLE_CHARACTERS) {
    diagnostics.push(createDiagnostic("SDK_EXAMPLE_CODE_TOO_LARGE", location));
    return undefined;
  }
  return normalized;
}

/**
 * Resolves an authored target to canonical operation identity. A contract
 * id must be unique across services; method + path may be disambiguated by
 * the service's title or canonical id.
 */
function resolveTarget(
  example: SdkExampleRecord,
  refs: ReadonlyMap<string, OperationRef>,
): OperationRef | "ambiguous" | "not-found" {
  const target = example.operation;
  const matches = [...refs.values()].filter((ref) => {
    if (typeof target === "string") {
      return ref.operation.contractId === target;
    }
    if (
      ref.operation.method !== target.method ||
      ref.operation.path !== target.path
    ) {
      return false;
    }
    return (
      target.service === undefined ||
      target.service === ref.serviceId ||
      target.service === ref.serviceName
    );
  });
  if (matches.length === 0) return "not-found";
  if (matches.length > 1) return "ambiguous";
  return matches[0] as OperationRef;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
