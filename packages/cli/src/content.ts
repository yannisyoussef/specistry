import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  apiRoutes,
  buildNavigation,
  compileContent,
  serializeContentArtifact,
  serializeNavigationArtifact,
  type BlockNode,
  type ContentPage,
  type MediaNode,
  type NavigationConfigNode,
} from "@specistry/content";
import {
  createCanonicalId,
  parseDocumentationArtifact,
  serializeDocumentationArtifact,
  type AuthoredPageMetadata,
} from "@specistry/model";

import type { BuildContext, Diagnostic, SourceSummary } from "./contracts.js";
import {
  createDiagnostic,
  fromContentDiagnostic,
  sortDiagnostics,
  sourcePath,
} from "./diagnostics.js";
import { isPathWithin, resolveExistingProjectPath } from "./path-policy.js";

/**
 * Authored-content build step (SPEC-006). Discovers Markdown sources under
 * the configured docs root, compiles them through `@specistry/content`, validates
 * the configured navigation, confines and copies image assets and branding
 * files, and folds page metadata into the canonical documentation artifact.
 * Everything here is deterministic and offline; nothing executes author text.
 */

export interface StagedAsset {
  /** File name inside the artifact `assets/` directory. */
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface ContentBuildOutput {
  readonly ok: true;
  readonly diagnostics: readonly Diagnostic[];
  /** Present only when the project has authored pages. */
  readonly contentJson?: string;
  readonly navigationJson?: string;
  readonly documentationJson: string;
  readonly assets: readonly StagedAsset[];
  readonly branding?: {
    readonly logo?: string;
    readonly favicon?: string;
    readonly accent?: string;
  };
  readonly pages: number;
  readonly sources: readonly SourceSummary[];
}

export interface ContentBuildFailure {
  readonly ok: false;
  readonly diagnostics: readonly Diagnostic[];
}

export const MAX_DOCS_FILES = 5_000;
export const MAX_ASSET_BYTES = 2 * 1_024 * 1_024;
export const MAX_TOTAL_ASSET_BYTES = 20 * 1_024 * 1_024;
export const MAX_BRANDING_BYTES = 512 * 1_024;
const SOURCE_EXTENSIONS = new Set([".md", ".mdx"]);

export async function buildContent(
  context: BuildContext,
  artifactJson: string,
): Promise<ContentBuildOutput | ContentBuildFailure> {
  const diagnostics: Diagnostic[] = [];
  const docsRoot = context.paths.docs;
  const docsRelative = toPosix(path.relative(context.projectRoot, docsRoot));
  const discovered = await discoverSources(docsRoot, diagnostics, docsRelative);
  const artifact = parseDocumentationArtifact(artifactJson);
  const routes = new Set(apiRoutes(artifact));

  const sources: SourceSummary[] = [];
  const compiled = await compileContent(
    discovered.map((entry) => {
      sources.push({
        bytes: Buffer.byteLength(entry.text, "utf8"),
        path: entry.projectPath,
        sha256: createHash("sha256").update(entry.text).digest("hex"),
      });
      return {
        path: entry.projectPath,
        relativePath: entry.relativePath,
        text: entry.text,
      };
    }),
    { apiRoutes: routes },
  );
  for (const diagnostic of compiled.diagnostics) {
    diagnostics.push(fromContentDiagnostic(diagnostic));
  }

  const navigation = buildNavigation(
    context.config.navigation as readonly NavigationConfigNode[] | undefined,
    compiled.pages.map((entry) => entry.page),
  );
  for (const diagnostic of navigation.diagnostics) {
    diagnostics.push(fromContentDiagnostic(diagnostic));
  }

  const assets = new Map<string, StagedAsset>();
  let totalAssetBytes = 0;
  const pages: ContentPage[] = [];
  for (const entry of compiled.pages) {
    const replacements = new Map<string, string>();
    const pageDirectory = path.posix.dirname(
      entry.page.sourcePath.slice(docsRelative.length + 1),
    );
    for (const reference of entry.assets) {
      const relative = path.posix.normalize(
        path.posix.join(
          pageDirectory === "." ? "" : pageDirectory,
          reference.path,
        ),
      );
      const location = {
        column: reference.location.column,
        line: reference.location.line,
      };
      if (
        relative.startsWith("../") ||
        relative === ".." ||
        path.posix.isAbsolute(relative)
      ) {
        diagnostics.push(
          createDiagnostic(
            "CONTENT_ASSET_OUTSIDE_ROOT",
            sourcePath(entry.page.sourcePath, ""),
            location,
          ),
        );
        continue;
      }
      const resolved = await resolveExistingProjectPath(
        docsRoot,
        relative,
        "file",
      );
      if (!resolved.ok) {
        diagnostics.push(
          createDiagnostic(
            resolved.kind === "missing"
              ? "CONTENT_ASSET_NOT_FOUND"
              : resolved.kind === "outside"
                ? "CONTENT_ASSET_OUTSIDE_ROOT"
                : "CONTENT_ASSET_INVALID",
            sourcePath(entry.page.sourcePath, ""),
            location,
          ),
        );
        continue;
      }
      const bytes = await readFile(resolved.path);
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        diagnostics.push(
          createDiagnostic(
            "CONTENT_ASSET_TOO_LARGE",
            sourcePath(entry.page.sourcePath, ""),
            location,
          ),
        );
        continue;
      }
      const extension = imageExtension(bytes);
      if (extension === undefined) {
        diagnostics.push(
          createDiagnostic(
            "CONTENT_ASSET_UNSUPPORTED",
            sourcePath(entry.page.sourcePath, ""),
            location,
          ),
        );
        continue;
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const name = `${sha256.slice(0, 16)}.${extension}`;
      if (!assets.has(name)) {
        totalAssetBytes += bytes.byteLength;
        if (totalAssetBytes > MAX_TOTAL_ASSET_BYTES) {
          diagnostics.push(
            createDiagnostic(
              "CONTENT_ASSET_TOO_LARGE",
              sourcePath(entry.page.sourcePath, ""),
              location,
            ),
          );
          continue;
        }
        assets.set(name, { bytes, name, sha256 });
      }
      replacements.set(reference.path, `assets/${name}`);
    }
    pages.push({
      ...entry.page,
      body: rewriteImages(entry.page.body, replacements),
    });
  }

  const branding = await stageBranding(context, assets, diagnostics);

  const sorted = sortDiagnostics(diagnostics);
  if (sorted.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics: sorted, ok: false };
  }
  if (pages.length === 0) {
    return {
      assets: [...assets.values()].sort((left, right) =>
        compare(left.name, right.name),
      ),
      ...(branding === undefined ? {} : { branding }),
      diagnostics: sorted,
      documentationJson: artifactJson,
      ok: true,
      pages: 0,
      sources,
    };
  }
  const version = artifact.model.versions[0];
  const documentation =
    version === undefined
      ? artifact
      : {
          ...artifact,
          model: {
            ...artifact.model,
            versions: [
              { ...version, pages: pages.map(pageMetadata) },
              ...artifact.model.versions.slice(1),
            ],
          },
        };
  return {
    assets: [...assets.values()].sort((left, right) =>
      compare(left.name, right.name),
    ),
    ...(branding === undefined ? {} : { branding }),
    contentJson: serializeContentArtifact({ contentVersion: 1, pages }),
    diagnostics: sorted,
    documentationJson: serializeDocumentationArtifact(documentation),
    navigationJson: serializeNavigationArtifact({
      items: navigation.items,
      navigationVersion: 1,
    }),
    ok: true,
    pages: pages.length,
    sources,
  };
}

interface DiscoveredSource {
  readonly projectPath: string;
  readonly relativePath: string;
  readonly text: string;
}

async function discoverSources(
  docsRoot: string,
  diagnostics: Diagnostic[],
  docsRelative: string,
): Promise<readonly DiscoveredSource[]> {
  const found: DiscoveredSource[] = [];
  const pending = [""];
  let count = 0;
  while (pending.length > 0) {
    const directory = pending.pop() as string;
    let entries: Dirent[];
    try {
      entries = await readdir(path.join(docsRoot, directory), {
        withFileTypes: true,
      });
    } catch {
      continue;
    }
    entries.sort((left, right) => compare(left.name, right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relative =
        directory === "" ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        pending.push(relative);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        continue;
      count += 1;
      const projectPath = `${docsRelative}/${relative}`;
      if (count > MAX_DOCS_FILES) {
        diagnostics.push(
          createDiagnostic(
            "CONTENT_BUDGET_EXCEEDED",
            sourcePath(projectPath, ""),
          ),
        );
        return found;
      }
      const resolved = await resolveExistingProjectPath(
        docsRoot,
        relative,
        "file",
      );
      if (!resolved.ok || !isPathWithin(docsRoot, resolved.path)) {
        diagnostics.push(
          createDiagnostic(
            "CONTENT_SOURCE_OUTSIDE_ROOT",
            sourcePath(projectPath, ""),
          ),
        );
        continue;
      }
      found.push({
        projectPath,
        relativePath: relative,
        text: await readFile(resolved.path, "utf8"),
      });
    }
  }
  return found;
}

async function stageBranding(
  context: BuildContext,
  assets: Map<string, StagedAsset>,
  diagnostics: Diagnostic[],
): Promise<ContentBuildOutput["branding"]> {
  const configured = context.paths.branding;
  const accent = context.config.branding?.accent?.toLowerCase();
  const stage = async (
    file: string | undefined,
    label: "favicon" | "logo",
  ): Promise<string | undefined> => {
    if (file === undefined) return undefined;
    const bytes = await readFile(file);
    const extension =
      imageExtension(bytes) ?? vectorOrIconExtension(bytes, label);
    if (bytes.byteLength > MAX_BRANDING_BYTES) {
      diagnostics.push(
        createDiagnostic(
          "CONTENT_ASSET_TOO_LARGE",
          `config#/branding/${label}`,
        ),
      );
      return undefined;
    }
    if (extension === undefined) {
      diagnostics.push(
        createDiagnostic(
          "CONTENT_ASSET_UNSUPPORTED",
          `config#/branding/${label}`,
        ),
      );
      return undefined;
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const name = `${sha256.slice(0, 16)}.${extension}`;
    assets.set(name, { bytes, name, sha256 });
    return `assets/${name}`;
  };
  const logo = await stage(configured?.logo, "logo");
  const favicon = await stage(configured?.favicon, "favicon");
  if (logo === undefined && favicon === undefined && accent === undefined) {
    return undefined;
  }
  return {
    ...(accent === undefined ? {} : { accent }),
    ...(favicon === undefined ? {} : { favicon }),
    ...(logo === undefined ? {} : { logo }),
  };
}

/** Image type from content, never from the extension the author typed. */
export function imageExtension(
  bytes: Uint8Array,
): "gif" | "jpg" | "png" | "webp" | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }
  return undefined;
}

/**
 * Branding files may also be SVG (served only as an `<img>` source, where
 * scripts never run) or ICO for the favicon. The SVG check reads the leading
 * bytes for an `<svg` or XML prologue and rejects anything with a script tag.
 */
function vectorOrIconExtension(
  bytes: Uint8Array,
  label: "favicon" | "logo",
): "ico" | "svg" | undefined {
  if (
    label === "favicon" &&
    bytes.length >= 4 &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 1 &&
    bytes[3] === 0
  ) {
    return "ico";
  }
  const head = Buffer.from(bytes.subarray(0, 512)).toString("utf8").trimStart();
  if (/^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) {
    const text = Buffer.from(bytes).toString("utf8");
    if (
      /<script|on[a-z]+\s*=|javascript:|<foreignObject|<use[^>]+href\s*=\s*["']?(?:https?:|\/\/)/i.test(
        text,
      )
    ) {
      return undefined;
    }
    return "svg";
  }
  return undefined;
}

function rewriteMedia(
  node: MediaNode,
  replacements: ReadonlyMap<string, string>,
): MediaNode {
  const poster = replacements.get(node.poster);
  return poster === undefined ? node : { ...node, poster };
}

function rewriteImages(
  blocks: readonly BlockNode[],
  replacements: ReadonlyMap<string, string>,
): readonly BlockNode[] {
  const visit = (nodes: readonly BlockNode[]): readonly BlockNode[] =>
    nodes.map((node): BlockNode => {
      switch (node.kind) {
        case "image": {
          const src = replacements.get(node.src);
          return src === undefined ? node : { ...node, src };
        }
        case "media":
          return rewriteMedia(node, replacements);
        case "hero":
          return node.media === undefined
            ? node
            : { ...node, media: rewriteMedia(node.media, replacements) };
        case "blockquote":
        case "callout":
          return { ...node, children: visit(node.children) };
        case "list":
          return {
            ...node,
            items: node.items.map((item) => ({
              ...item,
              children: visit(item.children),
            })),
          };
        case "steps":
          return {
            ...node,
            steps: node.steps.map((step) => ({
              ...step,
              children: visit(step.children),
            })),
          };
        case "tabs":
          return {
            ...node,
            tabs: node.tabs.map((tab) => ({
              ...tab,
              children: visit(tab.children),
            })),
          };
        default:
          return node;
      }
    });
  return visit(blocks);
}

/** Page metadata for the canonical model; ids are route-derived and unique. */
function pageMetadata(page: ContentPage): AuthoredPageMetadata {
  const id =
    page.slug === "" ? "home~" : `docs~${page.slug.replaceAll("/", "~")}`;
  return {
    ...(page.description === undefined
      ? {}
      : { description: page.description }),
    headings: page.headings.map((heading) => ({
      depth: heading.depth,
      id: heading.id,
      text: heading.text,
    })),
    id: createCanonicalId("page", id),
    slug: page.route,
    sourcePath: page.sourcePath,
    title: page.title,
  };
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
