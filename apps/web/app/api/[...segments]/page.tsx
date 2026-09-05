import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";

import { GroupPage, ServicePage } from "../../../components/reader/list-pages";
import { OperationPage } from "../../../components/reader/operation-page";
import { loadReaderArtifact } from "../../../lib/reader/artifact";
import {
  groupMetadata,
  operationMetadata,
  serviceMetadata,
  siteUrl,
  type PageMetadata,
} from "../../../lib/reader/metadata";
import { createOperationView } from "../../../lib/reader/operation-view";
import { resolveRoute, type RouteTarget } from "../../../lib/reader/projection";

type Params = Readonly<{ params: Promise<{ segments: string[] }> }>;

// Metadata and the page resolve the same route once per request.
const resolveSegments = cache(
  async (key: string): Promise<RouteTarget | undefined> => {
    const { artifact, index } = await loadReaderArtifact();
    return resolveRoute(index, artifact, key === "" ? [] : key.split("/"));
  },
);

async function resolve(params: Params["params"]): Promise<RouteTarget> {
  const { segments } = await params;
  const target = await resolveSegments(segments.join("/"));
  // Unknown routes are normally rewritten to the 404 page by proxy.ts; this
  // remains the fallback when the proxy did not run.
  if (target === undefined) notFound();
  return target;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const target = await resolve(params);
  const { index } = await loadReaderArtifact();
  let metadata: PageMetadata;
  switch (target.kind) {
    case "service":
      metadata = serviceMetadata(index, target.service);
      break;
    case "group":
      metadata = groupMetadata(index, target.service, target.group);
      break;
    case "operation":
      metadata = operationMetadata(
        index,
        target.service,
        target.summary,
        target.operation.description,
      );
      break;
  }
  return {
    ...(siteUrl(index) === undefined
      ? {}
      : { alternates: { canonical: metadata.path } }),
    description: metadata.description,
    title: metadata.title,
  };
}

export default async function ApiRoute({ params }: Params) {
  const target = await resolve(params);
  const { index } = await loadReaderArtifact();
  switch (target.kind) {
    case "service":
      return (
        <ServicePage
          operationCount={index.operationCount}
          service={target.service}
        />
      );
    case "group":
      return (
        <GroupPage
          group={target.group}
          service={target.service}
          singleService={index.singleService}
        />
      );
    case "operation":
      return <OperationPage view={createOperationView(target)} />;
  }
}
