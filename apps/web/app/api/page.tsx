import type { Metadata } from "next";

import { ReferencePage } from "../../components/reader/list-pages";
import { loadReaderArtifact } from "../../lib/reader/artifact";
import { referenceMetadata } from "../../lib/reader/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { index } = await loadReaderArtifact();
  const metadata = referenceMetadata(index);
  return {
    alternates: { canonical: metadata.path },
    description: metadata.description,
    title: metadata.title,
  };
}

export default async function Reference() {
  const { index } = await loadReaderArtifact();
  return <ReferencePage index={index} />;
}
