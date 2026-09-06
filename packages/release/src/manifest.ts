import { createHash } from "node:crypto";

import { validateVersionId } from "./version.js";

/**
 * The release manifest (`release.json`, SPEC-010 §12–§13): the exact
 * component set frozen in one immutable documentation release, each
 * component named with its format version, byte size, and SHA-256, plus the
 * content-addressed assets the release references. The aggregate digest is
 * derived from the component set alone, so equal content yields equal
 * identity and the reader can prove every component belongs together
 * without trusting file names. No paths, timestamps, or process data.
 */

export const RELEASE_FORMAT_VERSION = 1 as const;
export const RELEASE_MANIFEST_FILENAME = "release.json";

export const RELEASE_COMPONENT_NAMES = [
  "documentation",
  "manifest",
  "content",
  "navigation",
  "search",
  "snippets",
  "playground",
  "routes",
  "redirects",
  "changelog",
] as const;

export type ReleaseComponentName = (typeof RELEASE_COMPONENT_NAMES)[number];

export interface ReleaseComponent {
  /** File name inside the release directory (no path separators). */
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** The component's own format version, for compatibility checks. */
  readonly format: number;
}

export interface ReleaseAsset {
  /** `assets/<16 hex>.<ext>`, content-addressed. */
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface ReleaseManifest {
  readonly releaseFormat: typeof RELEASE_FORMAT_VERSION;
  readonly version: string;
  readonly project: { readonly id: string; readonly name: string };
  readonly components: Readonly<
    Partial<Record<ReleaseComponentName, ReleaseComponent>>
  >;
  readonly assets: readonly ReleaseAsset[];
  /** Aggregate identity of `components` and `assets`. */
  readonly digest: string;
}

export class ReleaseContractError extends Error {
  public constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ReleaseContractError";
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const FILE_NAME = /^[a-z][a-z0-9-]*\.json$/;
const ASSET_PATH = /^assets\/[a-f0-9]{16}\.(?:png|jpg|webp|gif|svg|ico)$/;
const MAX_ASSETS = 10_000;

/** SHA-256 of canonical JSON of the component set and asset list. */
export function computeReleaseDigest(
  input: Pick<ReleaseManifest, "assets" | "components">,
): string {
  const canonical = JSON.stringify(
    sortKeys({
      assets: [...input.assets].sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      ),
      components: input.components,
    }),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export function createReleaseManifest(
  input: Omit<ReleaseManifest, "digest" | "releaseFormat">,
): ReleaseManifest {
  const manifest = {
    assets: [...input.assets].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    ),
    components: input.components,
    project: input.project,
    releaseFormat: RELEASE_FORMAT_VERSION,
    version: input.version,
  };
  return { ...manifest, digest: computeReleaseDigest(manifest) };
}

export function serializeReleaseManifest(manifest: ReleaseManifest): string {
  return `${JSON.stringify(sortKeys(manifest), null, 2)}\n`;
}

export function parseReleaseManifest(text: string): ReleaseManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ReleaseContractError("Release manifest is not valid JSON.", "/");
  }
  return parseReleaseManifestValue(value);
}

export function parseReleaseManifestValue(value: unknown): ReleaseManifest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "assets",
      "components",
      "digest",
      "project",
      "releaseFormat",
      "version",
    ])
  ) {
    throw new ReleaseContractError(
      "Release manifest shape is not recognized.",
      "/",
    );
  }
  if (value.releaseFormat !== RELEASE_FORMAT_VERSION) {
    throw new ReleaseContractError(
      "Release manifest format is unsupported.",
      "/releaseFormat",
    );
  }
  if (typeof value.version !== "string" || validateVersionId(value.version)) {
    throw new ReleaseContractError(
      "Release version id is invalid.",
      "/version",
    );
  }
  if (
    !isRecord(value.project) ||
    !hasOnlyKeys(value.project, ["id", "name"]) ||
    !isText(value.project.id, 128) ||
    !isText(value.project.name, 200)
  ) {
    throw new ReleaseContractError(
      "Release project record is invalid.",
      "/project",
    );
  }
  if (!isRecord(value.components)) {
    throw new ReleaseContractError(
      "Release components must be an object.",
      "/components",
    );
  }
  const components: Partial<Record<ReleaseComponentName, ReleaseComponent>> =
    {};
  const files = new Set<string>();
  for (const [name, component] of Object.entries(value.components)) {
    if (!(RELEASE_COMPONENT_NAMES as readonly string[]).includes(name)) {
      throw new ReleaseContractError(
        "Release component name is unknown.",
        `/components/${name}`,
      );
    }
    if (
      !isRecord(component) ||
      !hasOnlyKeys(component, ["bytes", "file", "format", "sha256"]) ||
      typeof component.file !== "string" ||
      !FILE_NAME.test(component.file) ||
      !isCount(component.bytes) ||
      !isCount(component.format) ||
      typeof component.sha256 !== "string" ||
      !SHA256.test(component.sha256)
    ) {
      throw new ReleaseContractError(
        "Release component record is invalid.",
        `/components/${name}`,
      );
    }
    if (files.has(component.file)) {
      throw new ReleaseContractError(
        "Two release components name the same file.",
        `/components/${name}/file`,
      );
    }
    files.add(component.file);
    components[name as ReleaseComponentName] = {
      bytes: component.bytes,
      file: component.file,
      format: component.format,
      sha256: component.sha256,
    };
  }
  if (
    components.documentation === undefined ||
    components.manifest === undefined ||
    components.routes === undefined
  ) {
    throw new ReleaseContractError(
      "A release needs documentation, manifest, and routes components.",
      "/components",
    );
  }
  if (
    (components.content === undefined) !==
    (components.navigation === undefined)
  ) {
    throw new ReleaseContractError(
      "Content and navigation components come together.",
      "/components",
    );
  }
  if (!Array.isArray(value.assets) || value.assets.length > MAX_ASSETS) {
    throw new ReleaseContractError(
      "Release assets must be a bounded list.",
      "/assets",
    );
  }
  const assets: ReleaseAsset[] = [];
  const assetPaths = new Set<string>();
  value.assets.forEach((asset, index) => {
    if (
      !isRecord(asset) ||
      !hasOnlyKeys(asset, ["bytes", "path", "sha256"]) ||
      typeof asset.path !== "string" ||
      !ASSET_PATH.test(asset.path) ||
      !isCount(asset.bytes) ||
      typeof asset.sha256 !== "string" ||
      !SHA256.test(asset.sha256) ||
      assetPaths.has(asset.path)
    ) {
      throw new ReleaseContractError(
        "Release asset record is invalid or duplicated.",
        `/assets/${index}`,
      );
    }
    assetPaths.add(asset.path);
    assets.push({ bytes: asset.bytes, path: asset.path, sha256: asset.sha256 });
  });
  for (let index = 1; index < assets.length; index += 1) {
    const previous = assets[index - 1]?.path ?? "";
    const current = assets[index]?.path ?? "";
    if (previous > current) {
      throw new ReleaseContractError(
        "Release assets must be sorted by path.",
        `/assets/${index}`,
      );
    }
  }
  if (typeof value.digest !== "string" || !SHA256.test(value.digest)) {
    throw new ReleaseContractError("Release digest is invalid.", "/digest");
  }
  const manifest: ReleaseManifest = {
    assets,
    components,
    digest: value.digest,
    project: {
      id: value.project.id as string,
      name: value.project.name as string,
    },
    releaseFormat: RELEASE_FORMAT_VERSION,
    version: value.version,
  };
  if (computeReleaseDigest(manifest) !== manifest.digest) {
    throw new ReleaseContractError(
      "Release digest does not match its components.",
      "/digest",
    );
  }
  return manifest;
}

// --- helpers --------------------------------------------------------------

export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function isText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
