import { NextResponse } from "next/server";

import { rootSitemap } from "../../lib/reader/sitemap";

/** Rendered per request so the site origin comes from the serving environment. */
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return new NextResponse(await rootSitemap(), {
    headers: {
      "cache-control": "public, max-age=3600",
      "content-type": "application/xml; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
    status: 200,
  });
}
