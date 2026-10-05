import type { MetadataRoute } from "next";

import { loadReaderFor } from "../lib/reader/release";
import { siteUrl } from "../lib/reader/metadata";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { index } = await loadReaderFor("/");
  const base = siteUrl(index);
  return {
    rules: { allow: "/", disallow: ["/theme"], userAgent: "*" },
    ...(base === undefined
      ? {}
      : { sitemap: new URL("/sitemap.xml", base).href }),
  };
}
