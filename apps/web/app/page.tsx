import type { Metadata } from "next";

import { DocsPage } from "../components/reader/content/docs-page";
import { HomePage } from "../components/reader/list-pages";
import { loadReaderArtifact } from "../lib/reader/artifact";
import { homeMetadata, pageMetadata, siteUrl } from "../lib/reader/metadata";

/**
 * The homepage is the authored `docs/index.*` page when the project has one;
 * otherwise the generated API-reference entry from SPEC-004.
 */
export async function generateMetadata(): Promise<Metadata> {
  const { content, index } = await loadReaderArtifact();
  const metadata =
    content?.home === undefined
      ? homeMetadata(index)
      : pageMetadata(index, content.home);
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

export default async function Home() {
  const { content, index } = await loadReaderArtifact();
  if (content?.home !== undefined) {
    return <DocsPage content={content} page={content.home} />;
  }
  return <HomePage index={index} />;
}
