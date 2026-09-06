import type { MetadataRoute } from "next";

import { loadReaderArtifact } from "../lib/reader/artifact";
import { authoredPaths } from "../lib/reader/content";
import { indexablePaths, siteUrl } from "../lib/reader/metadata";

/**
 * Every indexable documentation route, in deterministic order. Entries are
 * absolute only when the site origin is known (`SPECRA_SITE_URL` or the
 * artifact's canonical URL); without it the sitemap is intentionally empty
 * rather than pointing at a guessed host.
 */
// Rendered per request like every documentation route, so the site origin is
// read from the serving environment rather than baked in at build time.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { content, index } = await loadReaderArtifact();
  const base = siteUrl(index);
  if (base === undefined) return [];
  return indexablePaths(index, authoredPaths(content)).map((path) => ({
    url: new URL(path, base).href,
  }));
}
