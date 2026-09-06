import { NextResponse, type NextRequest } from "next/server";

import { loadReaderArtifact } from "../../../lib/reader/artifact";

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
  const { search } = await loadReaderArtifact();
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
