import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ReferencePage } from "../../components/reader/list-pages";
import { loadReaderArtifact } from "../../lib/reader/artifact";
import { referenceMetadata, siteUrl } from "../../lib/reader/metadata";
import { loadReaderCatalog, readerMode } from "../../lib/reader/release";

export async function generateMetadata(): Promise<Metadata> {
  const { index } = await loadReaderArtifact();
  const metadata = referenceMetadata(index);
  return {
    ...(siteUrl(index) === undefined
      ? {}
      : { alternates: { canonical: metadata.path } }),
    description: metadata.description,
    title: metadata.title,
  };
}

export default async function Reference() {
  if ((await readerMode()) === "releases") {
    const reader = await loadReaderCatalog();
    redirect(`/api/${reader?.catalog.current ?? ""}`);
  }
  const { index } = await loadReaderArtifact();
  return <ReferencePage index={index} />;
}
