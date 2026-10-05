import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import {
  GroupPage,
  ReferencePage,
  ServicePage,
} from "../../../components/reader/list-pages";
import { OperationPage } from "../../../components/reader/operation-page";
import { SchemaFocusPage } from "../../../components/reader/schema/schema-focus-page";
import {
  loadReaderArtifact,
  type ReaderArtifact,
} from "../../../lib/reader/artifact";
import { createCodeView, type CodeView } from "../../../lib/reader/code-view";
import {
  groupMetadata,
  operationMetadata,
  serviceMetadata,
  siteUrl,
  type PageMetadata,
} from "../../../lib/reader/metadata";
import {
  createOperationView,
  type OperationView,
  type SchemaBlockRef,
} from "../../../lib/reader/operation-view";
import { createPlaygroundView } from "../../../lib/reader/playground-view";
import { resolveRoute, type RouteTarget } from "../../../lib/reader/projection";
import {
  loadReaderRelease,
  readerMode,
  versionOfPath,
  versionSwitchTargets,
} from "../../../lib/reader/release";
import { referenceMetadata } from "../../../lib/reader/metadata";
import {
  createSchemaView,
  LOCATOR_PATTERN,
  resolveLocator,
  type LocatorTarget,
  type SchemaView,
} from "../../../lib/reader/schema-view";

type Params = Readonly<{
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

/** Block anchors are reader-generated slugs; anything else is not a block. */
const ANCHOR_PATTERN = /^[a-z0-9][a-z0-9-]{0,160}$/;

interface FocusTarget {
  readonly block: SchemaBlockRef;
  readonly target: LocatorTarget;
  readonly view: SchemaView;
}

/**
 * The focused schema view is selected by two validated query parameters:
 * `schema` (a block anchor on the operation page) and `at` (a structural
 * locator). Both are matched against strict grammars before any lookup; an
 * unknown or malformed pair redirects to the operation itself, so no query
 * value is ever interpreted as a path or echoed.
 */
function resolveFocus(
  operation: OperationView,
  registry: Parameters<typeof createSchemaView>[1]["registry"],
  query: Record<string, string | string[] | undefined>,
): FocusTarget | "invalid" | undefined {
  const anchor = query.schema;
  if (anchor === undefined) return undefined;
  const at = query.at ?? "";
  if (
    typeof anchor !== "string" ||
    typeof at !== "string" ||
    !ANCHOR_PATTERN.test(anchor) ||
    (at !== "" && !LOCATOR_PATTERN.test(at))
  ) {
    return "invalid";
  }
  const block = operation.schemaBlocks.find((entry) => entry.anchor === anchor);
  if (block === undefined) return "invalid";
  const target = resolveLocator(block.node, registry, at);
  if (target === undefined) return "invalid";
  const view = createSchemaView(target.node, {
    ancestors: target.ancestors,
    context: block.context,
    locator: at,
    registry,
  });
  return { block, target, view };
}

/**
 * The artifact set for `/api/<segments>`: the candidate, or in release
 * mode the release named by the first segment (SPEC-010 §20, §22). The
 * remaining segments are the reference route inside that release.
 */
const readerFor = cache(
  async (
    key: string,
  ): Promise<
    { reader: ReaderArtifact; rest: readonly string[] } | undefined
  > => {
    const segments = key === "" ? [] : key.split("/");
    if ((await readerMode()) === "candidate") {
      return { reader: await loadReaderArtifact(), rest: segments };
    }
    const version = await versionOfPath(`/api/${key}`);
    if (version === undefined || segments[0] !== version) return undefined;
    return {
      reader: await loadReaderRelease(version),
      rest: segments.slice(1),
    };
  },
);

// Metadata and the page resolve the same route once per request.
const resolveSegments = cache(
  async (key: string): Promise<RouteTarget | "index" | undefined> => {
    const scoped = await readerFor(key);
    if (scoped === undefined) return undefined;
    if (scoped.rest.length === 0) return "index";
    const { artifact, index } = scoped.reader;
    return resolveRoute(index, artifact, scoped.rest);
  },
);

// Metadata and the page project the operation (and its schema blocks) once.
const operationViewFor = cache(
  (target: RouteTarget & { readonly kind: "operation" }): OperationView =>
    createOperationView(target),
);

/** The Code rail for the operation and the validated `env`/`body`/`auth` query. */
async function codeViewFor(
  key: string,
  operation: OperationView,
  query: Record<string, string | string[] | undefined>,
): Promise<CodeView | undefined> {
  const snippets = (await readerFor(key))?.reader.snippets;
  if (snippets === undefined) return undefined;
  return createCodeView(snippets, operation, {
    auth: query.auth,
    body: query.body,
    env: query.env,
  });
}

async function resolve(params: Params["params"]): Promise<{
  key: string;
  reader: ReaderArtifact;
  target: RouteTarget | "index";
}> {
  const { segments } = await params;
  const key = segments.join("/");
  const target = await resolveSegments(key);
  const scoped = await readerFor(key);
  // Unknown routes are normally rewritten to the 404 page by proxy.ts; this
  // remains the fallback when the proxy did not run.
  if (target === undefined || scoped === undefined) notFound();
  return { key, reader: scoped.reader, target };
}

export async function generateMetadata({
  params,
  searchParams,
}: Params): Promise<Metadata> {
  const { key, reader, target } = await resolve(params);
  const { index } = reader;
  let metadata: PageMetadata;
  if (target === "index") {
    metadata = referenceMetadata(index);
    return {
      ...(siteUrl(index) === undefined
        ? {}
        : { alternates: { canonical: metadata.path } }),
      description: metadata.description,
      title: metadata.title,
    };
  }
  if (target.kind === "operation") {
    const query = await searchParams;
    if (query.schema !== undefined) {
      const operation = operationViewFor(target);
      const focus = resolveFocus(operation, target.model.schemas, query);
      if (focus !== undefined && focus !== "invalid") {
        const base = operationMetadata(
          index,
          target.service,
          target.summary,
          target.operation.description,
        );
        const label =
          focus.target.trail.at(-1)?.label ??
          focus.view.name ??
          focus.block.title;
        return {
          ...(siteUrl(index) === undefined
            ? {}
            : { alternates: { canonical: base.path } }),
          description: base.description,
          robots: { follow: true, index: false },
          title: `${label} · ${base.title}`,
        };
      }
    }
  }
  let customized = false;
  switch (target.kind) {
    case "service":
      metadata = serviceMetadata(index, target.service);
      break;
    case "group":
      metadata = groupMetadata(index, target.service, target.group);
      break;
    case "operation": {
      metadata = operationMetadata(
        index,
        target.service,
        target.summary,
        target.operation.description,
      );
      const code = await codeViewFor(
        key,
        operationViewFor(target),
        await searchParams,
      );
      customized = code?.customized ?? false;
      break;
    }
  }
  return {
    ...(siteUrl(index) === undefined
      ? {}
      : { alternates: { canonical: metadata.path } }),
    description: metadata.description,
    // A non-default code selection is the same page with other examples:
    // the canonical URL is the operation, and it is not indexed twice.
    ...(customized ? { robots: { follow: true, index: false } } : {}),
    title: metadata.title,
  };
}

export default async function ApiRoute({ params, searchParams }: Params) {
  const { key, reader, target } = await resolve(params);
  const { index } = reader;
  if (target === "index") return <ReferencePage index={index} />;
  if (target.kind === "operation") {
    const query = await searchParams;
    if (query.schema !== undefined) {
      const operation = operationViewFor(target);
      const focus = resolveFocus(operation, target.model.schemas, query);
      if (focus === "invalid") redirect(target.summary.href);
      if (focus !== undefined) {
        return (
          <SchemaFocusPage
            apiRoot={index.apiRoot}
            block={focus.block}
            context={focus.block.context}
            operation={operation}
            trail={focus.target.trail}
            view={focus.view}
          />
        );
      }
    }
  }
  switch (target.kind) {
    case "service":
      return (
        <ServicePage
          apiRoot={index.apiRoot}
          operationCount={index.operationCount}
          service={target.service}
        />
      );
    case "group":
      return (
        <GroupPage
          apiRoot={index.apiRoot}
          group={target.group}
          service={target.service}
          singleService={index.singleService}
        />
      );
    case "operation": {
      const view = operationViewFor(target);
      // Historical releases never execute (SPEC-010 §43): only the current
      // release's own policy reaches the island.
      const historical =
        reader.version !== undefined && !reader.version.current;
      let counterpart:
        { currentHref: string; currentLabel: string } | undefined;
      if (historical && reader.version !== undefined) {
        const targets = await versionSwitchTargets(
          view.summary.href,
          reader.version.id,
        );
        const current = targets.find(
          (entry) => entry.id === reader.version?.currentId,
        );
        counterpart = {
          currentHref: current?.href ?? `/docs/${reader.version.currentId}`,
          currentLabel: reader.version.currentLabel,
        };
      }
      return (
        <OperationPage
          apiRoot={index.apiRoot}
          code={await codeViewFor(key, view, await searchParams)}
          historical={counterpart}
          playground={
            historical
              ? undefined
              : createPlaygroundView(reader.playground, view)
          }
          view={view}
        />
      );
    }
  }
}
