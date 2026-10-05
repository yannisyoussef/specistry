import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { ChangelogPage } from "../../../components/reader/changelog-page";
import { DocsPage } from "../../../components/reader/content/docs-page";
import {
  loadReaderArtifact,
  type ReaderArtifact,
} from "../../../lib/reader/artifact";
import { DOCS_ROOT, findPage } from "../../../lib/reader/content";
import { pageMetadata, siteName, siteUrl } from "../../../lib/reader/metadata";
import {
  loadReaderRelease,
  loadReleaseMetadata,
  readerMode,
  versionOfPath,
} from "../../../lib/reader/release";

type Params = Readonly<{ params: Promise<{ slug?: string[] }> }>;

/** Segments are route slugs; anything else is not a page. */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHANGELOG_SEGMENT = "changelog";

type Resolved =
  | {
      readonly kind: "page";
      readonly reader: ReaderArtifact;
      readonly page: NonNullable<ReturnType<typeof findPage>>;
    }
  | {
      readonly kind: "changelog";
      readonly reader: ReaderArtifact;
      readonly version: string;
    };

/**
 * `/docs/<slug...>` in candidate mode, `/docs/<version>[/<slug...>]` in
 * release mode (SPEC-010 §20–§24). An explicit version that is not a
 * retained release is a 404, never the current release; the proxy already
 * redirected the mutable aliases before this route runs.
 */
async function resolve(params: Params["params"]): Promise<Resolved> {
  const { slug = [] } = await params;
  if ((await readerMode()) === "candidate") {
    const reader = await loadReaderArtifact();
    if (slug.length === 0) redirect("/");
    if (slug.length > 4 || slug.some((segment) => !SEGMENT.test(segment))) {
      notFound();
    }
    const page = findPage(reader.content, `${DOCS_ROOT}/${slug.join("/")}`);
    if (page === undefined) notFound();
    return { kind: "page", page, reader };
  }
  const version = await versionOfPath(`/docs/${slug.join("/")}`);
  if (version === undefined || slug[0] !== version) notFound();
  const rest = slug.slice(1);
  if (rest.length > 4 || rest.some((segment) => !SEGMENT.test(segment))) {
    notFound();
  }
  const reader = await loadReaderRelease(version);
  if (rest.length === 1 && rest[0] === CHANGELOG_SEGMENT) {
    const meta = await loadReleaseMetadata(version);
    if (meta.changelog === undefined) notFound();
    return { kind: "changelog", reader, version };
  }
  const route =
    rest.length === 0
      ? reader.roots.home
      : `${reader.roots.docs}/${rest.join("/")}`;
  const page = findPage(reader.content, route);
  if (page === undefined) {
    // An API-only release has no authored home: its release root is the
    // reference index, which lives under the API root.
    if (rest.length === 0) redirect(reader.roots.api);
    notFound();
  }
  return { kind: "page", page, reader };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const resolved = await resolve(params);
  const { index } = resolved.reader;
  if (resolved.kind === "changelog") {
    const path = `${resolved.reader.roots.docs}/changelog`;
    return {
      ...(siteUrl(index) === undefined
        ? {}
        : { alternates: { canonical: path } }),
      description: `Release notes for ${resolved.reader.version?.label ?? resolved.version}.`,
      title: `Changelog · ${resolved.reader.version?.label ?? resolved.version} | ${siteName(index)}`,
    };
  }
  const metadata = pageMetadata(index, resolved.page);
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
  const resolved = await resolve(params);
  if (resolved.kind === "changelog") {
    const meta = await loadReleaseMetadata(resolved.version);
    if (meta.changelog === undefined || resolved.reader.version === undefined)
      notFound();
    return (
      <ChangelogPage
        changelog={meta.changelog}
        roots={resolved.reader.roots}
        version={resolved.reader.version}
      />
    );
  }
  const { content } = resolved.reader;
  if (content === undefined) notFound();
  return <DocsPage content={content} page={resolved.page} />;
}
