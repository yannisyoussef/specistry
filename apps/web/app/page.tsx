import type { Metadata } from "next";

import { HomePage } from "../components/reader/list-pages";
import { loadReaderArtifact } from "../lib/reader/artifact";
import { homeMetadata, siteUrl } from "../lib/reader/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { index } = await loadReaderArtifact();
  const metadata = homeMetadata(index);
  return {
    ...(siteUrl(index) === undefined
      ? {}
      : { alternates: { canonical: metadata.path } }),
    description: metadata.description,
    title: metadata.title,
  };
}

export default async function Home() {
  const { index } = await loadReaderArtifact();
  return <HomePage index={index} />;
}
