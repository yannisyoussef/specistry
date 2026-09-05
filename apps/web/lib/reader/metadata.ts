import type { ReaderIndex, ReaderOperationSummary } from "./projection";

/**
 * Page metadata rules: every route gets a unique title in the form
 * `<page> | <project> API`, a plain-text description trimmed to a sentence,
 * and a canonical path. Absolute URLs come from `SPECRA_SITE_URL`, then the
 * artifact's `canonicalUrl`, and are otherwise omitted rather than guessed.
 */

export const SITE_URL_VARIABLE = "SPECRA_SITE_URL";
const MAX_DESCRIPTION_LENGTH = 160;

export interface PageMetadata {
  readonly title: string;
  readonly description: string;
  readonly path: string;
}

export function siteName(index: ReaderIndex): string {
  return `${index.project.name} API`;
}

export function homeMetadata(index: ReaderIndex): PageMetadata {
  return {
    description: summarize(
      index.project.description ??
        index.services[0]?.description ??
        `${index.project.name} API reference: ${index.operationCount} documented operations.`,
    ),
    path: "/",
    title: siteName(index),
  };
}

export function referenceMetadata(index: ReaderIndex): PageMetadata {
  return {
    description: summarize(
      `API reference for ${index.project.name}: ${index.operationCount} operations across ${index.services.reduce((total, service) => total + service.groups.length, 0)} groups.`,
    ),
    path: "/api",
    title: `API reference | ${siteName(index)}`,
  };
}

export function serviceMetadata(
  index: ReaderIndex,
  service: ReaderIndex["services"][number],
): PageMetadata {
  return {
    description: summarize(
      service.description ??
        `${service.name}: ${service.operationCount} operations in ${service.groups.length} groups.`,
    ),
    path: service.href,
    title: `${service.name} | ${siteName(index)}`,
  };
}

export function groupMetadata(
  index: ReaderIndex,
  service: ReaderIndex["services"][number],
  group: ReaderIndex["services"][number]["groups"][number],
): PageMetadata {
  const suffix = index.singleService
    ? siteName(index)
    : `${service.name} | ${siteName(index)}`;
  return {
    description: summarize(
      `${group.name} operations: ${group.listed.map((operation) => operation.title).join(", ")}.`,
    ),
    path: group.href,
    title: `${group.name} | ${suffix}`,
  };
}

export function operationMetadata(
  index: ReaderIndex,
  service: ReaderIndex["services"][number],
  summary: ReaderOperationSummary,
  description: string | undefined,
): PageMetadata {
  const suffix = index.singleService
    ? siteName(index)
    : `${service.name} | ${siteName(index)}`;
  return {
    description: summarize(
      description ??
        `${summary.method} ${summary.path} in the ${service.name} API.`,
    ),
    path: summary.href,
    title: `${summary.title} | ${suffix}`,
  };
}

/** First sentence of plain text, whitespace-collapsed, at most 160 characters. */
export function summarize(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const sentence = /^(.{20,}?[.!?])(?:\s|$)/.exec(collapsed)?.[1] ?? collapsed;
  if (sentence.length <= MAX_DESCRIPTION_LENGTH) return sentence;
  const cut = sentence.slice(0, MAX_DESCRIPTION_LENGTH - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > 40 ? cut.slice(0, boundary) : cut}…`;
}

/** Absolute site origin for canonical URLs and the sitemap, when known. */
export function siteUrl(
  index: ReaderIndex,
  environment: NodeJS.ProcessEnv = process.env,
): URL | undefined {
  const candidate =
    environment[SITE_URL_VARIABLE] ?? index.project.canonicalUrl;
  if (candidate === undefined || candidate.length === 0) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/** Every indexable path in deterministic order. */
export function indexablePaths(index: ReaderIndex): readonly string[] {
  const paths = ["/", "/api"];
  for (const service of index.services) {
    if (!index.singleService) paths.push(service.href);
    for (const group of service.groups) {
      paths.push(group.href);
      for (const operation of group.operations) paths.push(operation.href);
    }
  }
  return paths;
}
