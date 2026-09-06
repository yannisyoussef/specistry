import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { DocsPage } from "../../../components/reader/content/docs-page";
import { loadReaderArtifact } from "../../../lib/reader/artifact";
import { DOCS_ROOT, findPage } from "../../../lib/reader/content";
import { pageMetadata, siteUrl } from "../../../lib/reader/metadata";

type Params = Readonly<{ params: Promise<{ slug?: string[] }> }>;

/** Segments are route slugs; anything else is not a page. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function resolve(params: Params["params"]) {
  const { slug = [] } = await params;
  const { content } = await loadReaderArtifact();
  if (slug.length === 0) redirect("/");
  if (slug.length > 4 || slug.some((segment) => !SEGMENT.test(segment))) {
    notFound();
  }
  const route = `${DOCS_ROOT}/${slug.join("/")}`;
  const page = findPage(content, route);
  // Unknown authored routes are normally rewritten to the 404 page by
  // proxy.ts; this remains the fallback when the proxy did not run.
  if (page === undefined || content === undefined) notFound();
  return { content, page };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { page } = await resolve(params);
  const { index } = await loadReaderArtifact();
  const metadata = pageMetadata(index, page);
  return {
    ...(siteUrl(index) === undefined
      ? {}
      : { alternates: { canonical: metadata.path } }),
    ...(metadata.description === undefined
      ? {}
      : { description: metadata.description }),
    title: metadata.title,
  };
}

export default async function AuthoredRoute({ params }: Params) {
  const { content, page } = await resolve(params);
  return <DocsPage content={content} page={page} />;
}
