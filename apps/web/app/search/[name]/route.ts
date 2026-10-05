import { NextResponse, type NextRequest } from "next/server";

import { loadReaderArtifact } from "../../../lib/reader/artifact";
import {
  loadReaderRelease,
  readerMode,
  releaseForSearch,
} from "../../../lib/reader/release";

/**
 * Serves the validated search artifact under its content-addressed name so
 * browsers may cache it forever: a rebuilt index gets a new name, and the
 * page always references the current one. Any other name is a 404; the body
 * is exactly the JSON the server validated against the manifest digest.
 */
const NAME = /^index\.[a-f0-9]{16}\.json$/;

export async function GET(
  _request: NextRequest,
  context: Readonly<{ params: Promise<{ name: string }> }>,
): Promise<NextResponse> {
  const { name } = await context.params;
  if (!NAME.test(name)) return new NextResponse(null, { status: 404 });
  // Release mode (SPEC-010 §36–§38): the name identifies exactly one
  // release's index by digest; that release's bytes are served and no other.
  const search =
    (await readerMode()) === "candidate"
      ? (await loadReaderArtifact()).search
      : await releaseSearch(name);
  if (search === undefined || search.path !== `/search/${name}`) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(search.json, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    status: 200,
  });
}

async function releaseSearch(name: string) {
  const version = await releaseForSearch(name);
  if (version === undefined) return undefined;
  return (await loadReaderRelease(version)).search;
}
