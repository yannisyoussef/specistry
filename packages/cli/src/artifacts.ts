import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ARTIFACT_ASSETS_DIRECTORY,
  ARTIFACT_CONTENT_FILENAME,
  ARTIFACT_NAVIGATION_FILENAME,
} from "@specra/content";
import {
  SEARCH_ARTIFACT_FILENAME,
  SEARCH_FORMAT_VERSION,
} from "@specra/search";
import {
  ARTIFACT_DOCUMENTATION_FILENAME,
  ARTIFACT_MANIFEST_FILENAME,
  ARTIFACT_MANIFEST_FORMAT,
  DOCUMENT_MODEL_VERSION,
  serializeArtifactManifest,
  type ArtifactBranding,
  type ArtifactManifest,
} from "@specra/model";

import {
  ARTIFACT_DIRECTORY,
  type ArtifactSummary,
  type IngestionSummary,
  type SourceSummary,
} from "./contracts.js";
import type { StagedAsset } from "./content.js";
import { isPathWithin, resolveFutureProjectPath } from "./path-policy.js";

export interface ArtifactWriteRequest {
  readonly projectRoot: string;
  readonly artifactRoot: string;
  readonly documentationJson: string;
  /** Authored content artifacts; both present or both absent. */
  readonly contentJson?: string;
  readonly navigationJson?: string;
  readonly assets?: readonly StagedAsset[];
  readonly branding?: ArtifactBranding;
  readonly pages?: number;
  /** Authored source records appended to the manifest sources. */
  readonly contentSources?: readonly SourceSummary[];
  /** The search artifact (SPEC-007); every build carries one. */
  readonly search: { readonly json: string; readonly documents: number };
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
    if (
      request.contentJson !== undefined &&
      request.navigationJson !== undefined
    ) {
      await writeFile(
        path.join(staging, ARTIFACT_CONTENT_FILENAME),
        request.contentJson,
        "utf8",
      );
      await writeFile(
        path.join(staging, ARTIFACT_NAVIGATION_FILENAME),
        request.navigationJson,
        "utf8",
      );
    }
    await writeFile(
      path.join(staging, SEARCH_ARTIFACT_FILENAME),
      request.search.json,
      "utf8",
    );
    if (request.assets !== undefined && request.assets.length > 0) {
      const assetsDirectory = path.join(staging, ARTIFACT_ASSETS_DIRECTORY);
      await mkdir(assetsDirectory);
      for (const asset of request.assets) {
        await writeFile(path.join(assetsDirectory, asset.name), asset.bytes);
      }
    }
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
    const files = [ARTIFACT_DOCUMENTATION_FILENAME, ARTIFACT_MANIFEST_FILENAME];
    let bytes =
      Buffer.byteLength(request.documentationJson, "utf8") +
      Buffer.byteLength(manifest, "utf8");
    if (
      request.contentJson !== undefined &&
      request.navigationJson !== undefined
    ) {
      files.push(ARTIFACT_CONTENT_FILENAME, ARTIFACT_NAVIGATION_FILENAME);
      bytes +=
        Buffer.byteLength(request.contentJson, "utf8") +
        Buffer.byteLength(request.navigationJson, "utf8");
    }
    files.push(SEARCH_ARTIFACT_FILENAME);
    bytes += Buffer.byteLength(request.search.json, "utf8");
    for (const asset of request.assets ?? []) {
      files.push(`${ARTIFACT_ASSETS_DIRECTORY}/${asset.name}`);
      bytes += asset.bytes.byteLength;
    }
    return {
      artifacts: { bytes, directory: ARTIFACT_DIRECTORY, files },
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
  const hasContent =
    request.contentJson !== undefined && request.navigationJson !== undefined;
  const assets = [...(request.assets ?? [])]
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .map((asset) => ({
      bytes: asset.bytes.byteLength,
      path: `${ARTIFACT_ASSETS_DIRECTORY}/${asset.name}`,
      sha256: asset.sha256,
    }));
  const sources = [
    ...request.ingestion.sources,
    ...(request.contentSources ?? []),
  ]
    .map((source) => ({
      bytes: source.bytes,
      path: source.path,
      sha256: source.sha256,
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    );
  const manifest: ArtifactManifest = {
    artifactFormat: ARTIFACT_MANIFEST_FORMAT,
    ...(assets.length === 0 ? {} : { assets }),
    ...(request.branding === undefined ? {} : { branding: request.branding }),
    diagnostics: { errors: 0, warnings: request.warnings },
    files: {
      documentation: ARTIFACT_DOCUMENTATION_FILENAME,
      ...(hasContent
        ? {
            content: ARTIFACT_CONTENT_FILENAME,
            navigation: ARTIFACT_NAVIGATION_FILENAME,
          }
        : {}),
      search: SEARCH_ARTIFACT_FILENAME,
    },
    search: {
      bytes: Buffer.byteLength(request.search.json, "utf8"),
      documents: request.search.documents,
      sha256: createHash("sha256").update(request.search.json).digest("hex"),
      version: SEARCH_FORMAT_VERSION,
    },
    generator: "specra",
    modelVersion: DOCUMENT_MODEL_VERSION,
    project: { id: request.project.id, name: request.project.name },
    sources,
    statistics: {
      ...request.ingestion.statistics,
      ...(request.pages === undefined ? {} : { pages: request.pages }),
    },
  };
  return serializeArtifactManifest(manifest);
}
