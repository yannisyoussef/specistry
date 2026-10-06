import { readFile } from "node:fs/promises";
import path from "node:path";

import { ARTIFACT_ASSETS_DIRECTORY } from "@specistry/content";
import { NextResponse, type NextRequest } from "next/server";

import {
  ARTIFACT_DIRECTORY,
  loadReaderArtifact,
  projectRoot,
} from "../../../lib/reader/artifact";
import { readerMode, releaseForAsset } from "../../../lib/reader/release";

/**
 * Serves documentation assets copied by `specistry build`. The name must be a
 * content-addressed file the manifest lists, so nothing outside the artifact
 * `assets/` directory can ever be read, and the type comes from the manifest
 * extension the build derived from the file's bytes. SVG (logos only) is
 * served with a policy that forbids scripts, and every asset is immutable.
 */

const ASSET_NAME = /^[a-f0-9]{16}\.(?:png|jpg|webp|gif|svg|ico)$/;

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  gif: "image/gif",
  ico: "image/x-icon",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export async function GET(
  _request: NextRequest,
  context: Readonly<{ params: Promise<{ name: string }> }>,
): Promise<NextResponse> {
  const { name } = await context.params;
  if (!ASSET_NAME.test(name)) return new NextResponse(null, { status: 404 });
  // Assets are content-addressed, so in release mode any retained release
  // that lists the name may serve it (SPEC-010 §68); identical names mean
  // identical bytes, and the size is checked against the release manifest.
  const record =
    (await readerMode()) === "candidate"
      ? candidateAsset(await loadReaderArtifact(), name)
      : await releaseForAsset(name);
  if (record === undefined) return new NextResponse(null, { status: 404 });
  const extension = name.slice(name.lastIndexOf(".") + 1);
  let bytes: Buffer;
  try {
    bytes = await readFile(
      path.join(
        projectRoot(),
        record.directory,
        ARTIFACT_ASSETS_DIRECTORY,
        name,
      ),
    );
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  if (bytes.byteLength !== record.bytes) {
    return new NextResponse(null, { status: 404 });
  }
  // The policy applies when a browser opens the file directly: no scripts,
  // no external loads, and an opaque origin, which neutralizes SVG scripts.
  const headers: Record<string, string> = {
    "cache-control": "public, max-age=31536000, immutable",
    "content-length": String(bytes.byteLength),
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  };
  return new NextResponse(new Uint8Array(bytes), { headers, status: 200 });
}

function candidateAsset(
  reader: Awaited<ReturnType<typeof loadReaderArtifact>>,
  name: string,
): { readonly directory: string; readonly bytes: number } | undefined {
  const record = reader.manifest.assets?.find(
    (asset) => asset.path === `${ARTIFACT_ASSETS_DIRECTORY}/${name}`,
  );
  return record === undefined
    ? undefined
    : { bytes: record.bytes, directory: ARTIFACT_DIRECTORY };
}
