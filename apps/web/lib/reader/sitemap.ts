import { loadReaderArtifact } from "./artifact";
import { authoredPaths } from "./content";
import { indexablePaths, siteUrl } from "./metadata";
import {
  loadReaderCatalog,
  loadReaderFor,
  loadReleaseMetadata,
  readerMode,
} from "./release";

/**
 * Sitemaps (SPEC-010 §70–§75). Candidate mode keeps one `urlset` of the
 * indexable routes. Release mode serves a deterministic `sitemapindex`
 * with one partitioned sitemap per retained release, built from the small
 * route tables only: canonical versioned URLs, never the mutable aliases
 * (`/`, `/docs`, `/api`) and never a non-indexable route. Entries are
 * absolute only when the site origin is known; otherwise the documents are
 * intentionally empty rather than guessing a host.
 */

/** Sitemap protocol limit is 50,000; partitions stay well under it. */
export const SITEMAP_PARTITION_SIZE = 45_000;

export interface SitemapPartition {
  readonly name: string;
  readonly version: string;
  readonly part: number;
}

export async function sitemapPartitions(): Promise<
  readonly SitemapPartition[]
> {
  const reader = await loadReaderCatalog();
  if (reader === undefined) return [];
  const partitions: SitemapPartition[] = [];
  for (const release of reader.catalog.releases) {
    const meta = await loadReleaseMetadata(release.version);
    const count = meta.routes.routes.filter((route) => route.indexable).length;
    const parts = Math.max(1, Math.ceil(count / SITEMAP_PARTITION_SIZE));
    for (let part = 0; part < parts; part += 1) {
      partitions.push({
        name:
          parts === 1
            ? `${release.version}.xml`
            : `${release.version}-${part + 1}.xml`,
        part,
        version: release.version,
      });
    }
  }
  return partitions;
}

/** `/sitemap.xml`: a urlset (candidate mode) or a sitemap index (release mode). */
export async function rootSitemap(): Promise<string> {
  if ((await readerMode()) === "candidate") {
    const { content, index } = await loadReaderArtifact();
    const base = siteUrl(index);
    if (base === undefined) return urlset([]);
    return urlset(
      indexablePaths(index, authoredPaths(content)).map(
        (path) => new URL(path, base).href,
      ),
    );
  }
  const { index } = await loadReaderFor("/");
  const base = siteUrl(index);
  if (base === undefined) return sitemapIndex([]);
  const partitions = await sitemapPartitions();
  return sitemapIndex(
    partitions.map(
      (partition) => new URL(`/sitemaps/${partition.name}`, base).href,
    ),
  );
}

/** `/sitemaps/<name>`: the canonical routes of one release partition. */
export async function partitionSitemap(
  name: string,
): Promise<string | undefined> {
  if ((await readerMode()) === "candidate") return undefined;
  const partitions = await sitemapPartitions();
  const partition = partitions.find((entry) => entry.name === name);
  if (partition === undefined) return undefined;
  const { index } = await loadReaderFor("/");
  const base = siteUrl(index);
  if (base === undefined) return urlset([]);
  const meta = await loadReleaseMetadata(partition.version);
  const paths = meta.routes.routes
    .filter((route) => route.indexable)
    .map((route) => route.path)
    .slice(
      partition.part * SITEMAP_PARTITION_SIZE,
      (partition.part + 1) * SITEMAP_PARTITION_SIZE,
    );
  return urlset(paths.map((path) => new URL(path, base).href));
}

function urlset(urls: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((url) => `<url><loc>${escapeXml(url)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
}

function sitemapIndex(urls: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((url) => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`)
    .join("\n")}\n</sitemapindex>\n`;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}
