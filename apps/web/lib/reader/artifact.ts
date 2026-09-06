import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ContentArtifactError,
  parseContentArtifact,
  parseNavigationArtifact,
} from "@specra/content";
import {
  ARTIFACT_MANIFEST_FILENAME,
  CanonicalModelError,
  parseArtifactManifest,
  parseDocumentationArtifact,
  type ArtifactManifest,
  type DocumentationArtifact,
} from "@specra/model";

import { createHash } from "node:crypto";

import { parseSearchArtifact } from "@specra/search";

import { createReaderContent, type ReaderContent } from "./content";
import { createReaderIndex, type ReaderIndex } from "./projection";

/**
 * The reader's only input: the artifact directory written by `specra build`.
 * Both files are validated through the model's contracts before anything is
 * rendered, and the result is memoized per process so every route shares one
 * validated artifact. Failures are actionable build/start errors; the reader
 * never renders an empty site in place of a broken artifact.
 */

export const ARTIFACT_DIRECTORY = ".specra/artifacts";
export const PROJECT_ROOT_VARIABLE = "SPECRA_PROJECT_ROOT";

export interface ReaderArtifact {
  readonly artifact: DocumentationArtifact;
  readonly manifest: ArtifactManifest;
  readonly index: ReaderIndex;
  /** Authored content and navigation; absent for API-only projects. */
  readonly content?: ReaderContent;
  /** The validated search artifact, served content-addressed (SPEC-007). */
  readonly search?: ReaderSearch;
  /** Project-relative artifact directory; never an absolute machine path. */
  readonly directory: string;
}

export interface ReaderSearch {
  /** Public path: `/search/index.<sha256 prefix>.json`, immutable. */
  readonly path: string;
  readonly json: string;
  readonly documents: number;
}

export class ReaderArtifactError extends Error {
  public constructor(
    message: string,
    public readonly hint: string,
  ) {
    super(`${message} ${hint}`);
    this.name = "ReaderArtifactError";
  }
}

const cache = new Map<string, Promise<ReaderArtifact>>();

/** Absolute project root the reader serves, from the environment or the cwd. */
export function projectRoot(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configured = environment[PROJECT_ROOT_VARIABLE];
  return path.resolve(
    configured === undefined || configured.length === 0
      ? process.cwd()
      : configured,
  );
}

/** Loads, validates, and memoizes the artifact for the configured project. */
export function loadReaderArtifact(
  root: string = projectRoot(),
): Promise<ReaderArtifact> {
  const existing = cache.get(root);
  if (existing !== undefined) return existing;
  const loading = readReaderArtifact(root).catch((error: unknown) => {
    cache.delete(root);
    throw error;
  });
  cache.set(root, loading);
  return loading;
}

/** Clears the memoized artifact; used by tests that switch projects. */
export function resetReaderArtifactCache(): void {
  cache.clear();
}

export async function readReaderArtifact(
  root: string,
): Promise<ReaderArtifact> {
  const directory = path.join(root, ARTIFACT_DIRECTORY);
  const hint = `Run \`specra build\` in the project (${PROJECT_ROOT_VARIABLE} currently resolves to the ${
    process.env[PROJECT_ROOT_VARIABLE] ? "configured root" : "working directory"
  }) and rebuild the reader.`;
  const manifestText = await readArtifactFile(
    directory,
    ARTIFACT_MANIFEST_FILENAME,
    hint,
  );
  let manifest: ArtifactManifest;
  try {
    manifest = parseArtifactManifest(manifestText);
  } catch (error) {
    throw new ReaderArtifactError(
      `The artifact manifest in ${ARTIFACT_DIRECTORY} is not a supported Specra manifest (${describe(error)}).`,
      hint,
    );
  }
  const documentationText = await readArtifactFile(
    directory,
    manifest.files.documentation,
    hint,
  );
  let artifact: DocumentationArtifact;
  try {
    artifact = parseDocumentationArtifact(documentationText);
  } catch (error) {
    throw new ReaderArtifactError(
      `The canonical artifact ${ARTIFACT_DIRECTORY}/${manifest.files.documentation} failed model validation (${describe(error)}).`,
      hint,
    );
  }
  if (artifact.model.project.id !== manifest.project.id) {
    throw new ReaderArtifactError(
      `The artifact manifest describes project "${manifest.project.id}" but the canonical artifact belongs to "${artifact.model.project.id}".`,
      hint,
    );
  }
  const operations = artifact.model.versions.reduce(
    (total, version) =>
      total +
      version.services.reduce(
        (count, service) => count + service.operations.length,
        0,
      ),
    0,
  );
  if (operations !== manifest.statistics.operations) {
    throw new ReaderArtifactError(
      `The artifact manifest reports ${manifest.statistics.operations} operations but the canonical artifact contains ${operations}.`,
      hint,
    );
  }
  const content = await readContent(directory, manifest, hint);
  const search = await readSearch(directory, manifest, hint);
  return {
    artifact,
    ...(content === undefined ? {} : { content }),
    directory: ARTIFACT_DIRECTORY,
    index: createReaderIndex(artifact),
    manifest,
    ...(search === undefined ? {} : { search }),
  };
}

/**
 * Search is optional in the manifest (older artifacts), but when the manifest
 * names it the file must parse, match the recorded digest and size, and
 * carry the recorded document count; a stale or tampered index never pairs
 * with fresh content. The reader serves the bytes it validated here.
 */
async function readSearch(
  directory: string,
  manifest: ArtifactManifest,
  hint: string,
): Promise<ReaderSearch | undefined> {
  if (manifest.files.search === undefined || manifest.search === undefined) {
    return undefined;
  }
  const text = await readArtifactFile(directory, manifest.files.search, hint);
  const sha256 = createHash("sha256").update(text).digest("hex");
  if (
    sha256 !== manifest.search.sha256 ||
    Buffer.byteLength(text, "utf8") !== manifest.search.bytes
  ) {
    throw new ReaderArtifactError(
      `The search artifact ${ARTIFACT_DIRECTORY}/${manifest.files.search} does not match the digest recorded in the manifest.`,
      hint,
    );
  }
  try {
    const artifact = parseSearchArtifact(text);
    if (artifact.documents.length !== manifest.search.documents) {
      throw new ReaderArtifactError(
        `The artifact manifest reports ${manifest.search.documents} search documents but the search artifact contains ${artifact.documents.length}.`,
        hint,
      );
    }
    return {
      documents: artifact.documents.length,
      json: text,
      path: `/search/index.${sha256.slice(0, 16)}.json`,
    };
  } catch (error) {
    if (error instanceof ReaderArtifactError) throw error;
    throw new ReaderArtifactError(
      `The search artifact ${ARTIFACT_DIRECTORY}/${manifest.files.search} failed validation (${describe(error)}).`,
      hint,
    );
  }
}

/**
 * Authored content is optional: the manifest names `content.json` and
 * `navigation.json` together or not at all. Both are validated strictly and
 * cross-checked against the manifest's page count before any page renders.
 */
async function readContent(
  directory: string,
  manifest: ArtifactManifest,
  hint: string,
): Promise<ReaderContent | undefined> {
  if (
    manifest.files.content === undefined ||
    manifest.files.navigation === undefined
  ) {
    if (
      manifest.statistics.pages !== undefined &&
      manifest.statistics.pages > 0
    ) {
      throw new ReaderArtifactError(
        `The artifact manifest reports ${manifest.statistics.pages} authored pages but names no content artifact.`,
        hint,
      );
    }
    return undefined;
  }
  const contentText = await readArtifactFile(
    directory,
    manifest.files.content,
    hint,
  );
  const navigationText = await readArtifactFile(
    directory,
    manifest.files.navigation,
    hint,
  );
  try {
    const content = parseContentArtifact(contentText);
    const navigation = parseNavigationArtifact(navigationText);
    if (
      manifest.statistics.pages !== undefined &&
      manifest.statistics.pages !== content.pages.length
    ) {
      throw new ReaderArtifactError(
        `The artifact manifest reports ${manifest.statistics.pages} authored pages but the content artifact contains ${content.pages.length}.`,
        hint,
      );
    }
    return createReaderContent(content.pages, navigation, manifest.branding);
  } catch (error) {
    if (error instanceof ReaderArtifactError) throw error;
    throw new ReaderArtifactError(
      `The authored content artifacts in ${ARTIFACT_DIRECTORY} failed validation (${describe(error)}).`,
      hint,
    );
  }
}

async function readArtifactFile(
  directory: string,
  name: string,
  hint: string,
): Promise<string> {
  try {
    return await readFile(path.join(directory, name), "utf8");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown";
    throw new ReaderArtifactError(
      code === "ENOENT"
        ? `No canonical artifact was found at ${ARTIFACT_DIRECTORY}/${name}.`
        : `The canonical artifact ${ARTIFACT_DIRECTORY}/${name} could not be read (${code}).`,
      hint,
    );
  }
}

function describe(error: unknown): string {
  if (error instanceof ContentArtifactError) return error.message.slice(0, 200);
  if (error instanceof CanonicalModelError) {
    const issues = error.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .slice(0, 3)
      .map(
        (diagnostic) =>
          `${diagnostic.code} at ${diagnostic.location?.path ?? "/"}`,
      );
    const rest = error.diagnostics.length - issues.length;
    return `${error.message.slice(0, 120)} ${issues.join("; ")}${rest > 0 ? `; ${rest} more` : ""}`;
  }
  if (error instanceof Error) return error.message.slice(0, 200);
  return "unknown error";
}
