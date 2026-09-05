import { randomBytes } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ARTIFACT_DOCUMENTATION_FILENAME,
  ARTIFACT_MANIFEST_FILENAME,
  ARTIFACT_MANIFEST_FORMAT,
  DOCUMENT_MODEL_VERSION,
  serializeArtifactManifest,
  type ArtifactManifest,
} from "@specra/model";

import {
  ARTIFACT_DIRECTORY,
  type ArtifactSummary,
  type IngestionSummary,
} from "./contracts.js";
import { isPathWithin, resolveFutureProjectPath } from "./path-policy.js";

export interface ArtifactWriteRequest {
  readonly projectRoot: string;
  readonly artifactRoot: string;
  readonly documentationJson: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly ingestion: IngestionSummary;
  readonly warnings: number;
}

export type ArtifactWriteResult =
  | { readonly ok: true; readonly artifacts: ArtifactSummary }
  | { readonly ok: false };

/**
 * Writes the canonical artifact atomically: files are staged in a sibling
 * directory under `.specra`, the previous artifact directory (if any) is moved
 * aside, the staged directory is renamed into place, and the old one is
 * removed. Confinement is revalidated immediately before touching the
 * filesystem, and an existing `artifacts` entry that is a symlink fails
 * closed. Every artifact byte is deterministic: no timestamps, identifiers,
 * or absolute paths are written.
 */
export async function writeArtifacts(
  request: ArtifactWriteRequest,
): Promise<ArtifactWriteResult> {
  const target = await confinedArtifactRoot(
    request.projectRoot,
    request.artifactRoot,
  );
  if (target === undefined) return { ok: false };
  const parent = path.dirname(target);
  const suffix = randomBytes(6).toString("hex");
  const staging = path.join(parent, `artifacts.staging-${suffix}`);
  const previous = path.join(parent, `artifacts.previous-${suffix}`);
  const manifest = renderManifest(request);
  try {
    await mkdir(parent, { recursive: true });
    await mkdir(staging);
    await writeFile(
      path.join(staging, ARTIFACT_DOCUMENTATION_FILENAME),
      request.documentationJson,
      "utf8",
    );
    await writeFile(
      path.join(staging, ARTIFACT_MANIFEST_FILENAME),
      manifest,
      "utf8",
    );
    const existing = await entryKind(target);
    if (existing === "symlink" || existing === "file") {
      await rm(staging, { force: true, recursive: true });
      return { ok: false };
    }
    if (existing === "directory") await rename(target, previous);
    try {
      await rename(staging, target);
    } catch (error) {
      if (existing === "directory") await rename(previous, target);
      throw error;
    }
    if (existing === "directory")
      await rm(previous, { force: true, recursive: true });
    return {
      artifacts: {
        bytes:
          Buffer.byteLength(request.documentationJson, "utf8") +
          Buffer.byteLength(manifest, "utf8"),
        directory: ARTIFACT_DIRECTORY,
        files: [ARTIFACT_DOCUMENTATION_FILENAME, ARTIFACT_MANIFEST_FILENAME],
      },
      ok: true,
    };
  } catch {
    await rm(staging, { force: true, recursive: true }).catch(() => undefined);
    return { ok: false };
  }
}

/**
 * Removes a stale artifact directory after a failed build so it can never be
 * mistaken for the output of the current input. Only a confined, non-symlink
 * directory at the fixed artifact root is ever removed.
 */
export async function removeStaleArtifacts(
  projectRoot: string,
  artifactRoot: string,
): Promise<boolean> {
  const target = await confinedArtifactRoot(projectRoot, artifactRoot);
  if (target === undefined) return false;
  const existing = await entryKind(target);
  if (existing === "missing") return true;
  if (existing !== "directory") return false;
  try {
    await rm(target, { force: true, recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function confinedArtifactRoot(
  projectRoot: string,
  artifactRoot: string,
): Promise<string | undefined> {
  const resolved = await resolveFutureProjectPath(
    projectRoot,
    ARTIFACT_DIRECTORY,
  );
  if (!resolved.ok || resolved.path !== artifactRoot) return undefined;
  if (!isPathWithin(projectRoot, resolved.path)) return undefined;
  // No component of the lexical artifact path may be a symlink: writing
  // through one would replace whatever the link points at, even when that
  // target is confined.
  const segments = ARTIFACT_DIRECTORY.split("/");
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const lexical = path.join(projectRoot, ...segments.slice(0, depth));
    if ((await entryKind(lexical)) === "symlink") return undefined;
  }
  return resolved.path;
}

async function entryKind(
  target: string,
): Promise<"directory" | "file" | "missing" | "symlink"> {
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) return "symlink";
    return metadata.isDirectory() ? "directory" : "file";
  } catch {
    return "missing";
  }
}

function renderManifest(request: ArtifactWriteRequest): string {
  const manifest: ArtifactManifest = {
    artifactFormat: ARTIFACT_MANIFEST_FORMAT,
    diagnostics: { errors: 0, warnings: request.warnings },
    files: { documentation: ARTIFACT_DOCUMENTATION_FILENAME },
    generator: "specra",
    modelVersion: DOCUMENT_MODEL_VERSION,
    project: { id: request.project.id, name: request.project.name },
    sources: request.ingestion.sources.map((source) => ({
      bytes: source.bytes,
      path: source.path,
      sha256: source.sha256,
    })),
    statistics: request.ingestion.statistics,
  };
  return serializeArtifactManifest(manifest);
}
