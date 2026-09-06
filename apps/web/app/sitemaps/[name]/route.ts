import { NextResponse, type NextRequest } from "next/server";

import { partitionSitemap } from "../../../lib/reader/sitemap";

export const dynamic = "force-dynamic";

/** One release partition: `<version>.xml` or `<version>-<part>.xml`. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:-\d{1,4})?\.xml$/;

export async function GET(
  _request: NextRequest,
  context: Readonly<{ params: Promise<{ name: string }> }>,
): Promise<NextResponse> {
  const { name } = await context.params;
  if (!NAME.test(name)) return new NextResponse(null, { status: 404 });
  const body = await partitionSitemap(name);
  if (body === undefined) return new NextResponse(null, { status: 404 });
  return new NextResponse(body, {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    status: 200,
  });
}
