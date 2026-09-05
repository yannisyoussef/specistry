import type {
  ApiService,
  DocumentationArtifact,
  DocumentationVersion,
  HttpMethod,
  Operation,
} from "@specra/model";

import { identifierSlug, methodPathSlug, slugify, uniqueSlugs } from "./slug";

/**
 * Reader projection: the route identity and navigation grouping derived once
 * from a canonical artifact. It adds presentation grouping (services, groups,
 * ordered operations, slugs, hrefs) and nothing else; canonical semantics stay
 * in the model. Everything here is deterministic for a given artifact.
 */

export const API_ROOT = "/api";
export const UNTAGGED_GROUP_NAME = "Operations";
export const UNTAGGED_GROUP_SLUG = "operations";

export interface ReaderProject {
  readonly name: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
}

export interface ReaderIndex {
  readonly project: ReaderProject;
  readonly version: Pick<DocumentationVersion, "id" | "label" | "status">;
  readonly services: readonly ReaderService[];
  /** With one service, group and operation routes omit the service segment. */
  readonly singleService: boolean;
  readonly operationCount: number;
}

export interface ReaderService {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description?: string;
  readonly href: string;
  readonly groups: readonly ReaderGroup[];
  readonly operationCount: number;
}

export interface ReaderGroup {
  readonly slug: string;
  readonly name: string;
  readonly href: string;
  /** Operations whose canonical route lives in this group. */
  readonly operations: readonly ReaderOperationSummary[];
  /** Every operation tagged with this group, including ones canonical elsewhere. */
  readonly listed: readonly ReaderOperationSummary[];
}

export interface ReaderOperationSummary {
  readonly id: string;
  readonly slug: string;
  readonly href: string;
  readonly title: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly deprecated: boolean;
  readonly groupSlug: string;
  readonly serviceSlug: string;
}

export type RouteTarget =
  | { readonly kind: "service"; readonly service: ReaderService }
  | {
      readonly kind: "group";
      readonly service: ReaderService;
      readonly group: ReaderGroup;
    }
  | {
      readonly kind: "operation";
      readonly service: ReaderService;
      readonly group: ReaderGroup;
      readonly summary: ReaderOperationSummary;
      readonly operation: Operation;
      readonly model: ApiService;
    };

const METHOD_ORDER: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
];

/** Builds the reader index for the current documentation version. */
export function createReaderIndex(
  artifact: DocumentationArtifact,
): ReaderIndex {
  const version = selectVersion(artifact);
  const services = version.services;
  const singleService = services.length === 1;
  const serviceSlugs = uniqueSlugs(
    services.map((service) => slugify(serviceLabel(service), "service")),
  );
  const projected = services.map((service, index) =>
    projectService(service, serviceSlugs[index] ?? "service", singleService),
  );
  const { project } = artifact.model;
  return {
    operationCount: projected.reduce(
      (total, service) => total + service.operationCount,
      0,
    ),
    project: {
      name: project.name,
      ...(project.description === undefined
        ? {}
        : { description: project.description }),
      ...(project.canonicalUrl === undefined
        ? {}
        : { canonicalUrl: project.canonicalUrl }),
    },
    services: projected,
    singleService,
    version: { id: version.id, label: version.label, status: version.status },
  };
}

/** Resolves `/api/<segments>` against the index; `undefined` means 404. */
export function resolveRoute(
  index: ReaderIndex,
  artifact: DocumentationArtifact,
  segments: readonly string[],
): RouteTarget | undefined {
  if (segments.some((segment) => !isSafeSegment(segment))) return undefined;
  const version = selectVersion(artifact);
  let rest = segments;
  let service: ReaderService | undefined;
  if (index.singleService) {
    service = index.services[0];
  } else {
    const [serviceSlug, ...others] = segments;
    service = index.services.find((entry) => entry.slug === serviceSlug);
    rest = others;
    if (service !== undefined && rest.length === 0) {
      return { kind: "service", service };
    }
  }
  if (service === undefined) return undefined;
  const [groupSlug, operationSlug, ...extra] = rest;
  if (groupSlug === undefined || extra.length > 0) return undefined;
  const group = service.groups.find((entry) => entry.slug === groupSlug);
  if (group === undefined) return undefined;
  if (operationSlug === undefined) return { kind: "group", group, service };
  const summary = group.operations.find(
    (entry) => entry.slug === operationSlug,
  );
  if (summary === undefined) return undefined;
  const model = version.services.find((entry) => entry.id === service.id);
  const operation = model?.operations.find((entry) => entry.id === summary.id);
  if (model === undefined || operation === undefined) return undefined;
  return { group, kind: "operation", model, operation, service, summary };
}

/** Every operation summary in canonical navigation order. */
export function listOperations(
  index: ReaderIndex,
): readonly ReaderOperationSummary[] {
  return index.services.flatMap((service) =>
    service.groups.flatMap((group) => group.operations),
  );
}

function selectVersion(artifact: DocumentationArtifact): DocumentationVersion {
  const versions = artifact.model.versions;
  const current =
    versions.find((version) => version.status === "current") ?? versions[0];
  if (current === undefined) {
    throw new Error(
      "The canonical artifact contains no documentation version.",
    );
  }
  return current;
}

function serviceLabel(service: ApiService): string {
  // Service ids are derived from the configured document path; strip the file
  // extension so a single-file project reads as `openapi`, not `openapi-yaml`.
  return service.id.replace(/\.(json|ya?ml)$/i, "");
}

function projectService(
  service: ApiService,
  slug: string,
  singleService: boolean,
): ReaderService {
  const serviceHref = singleService ? API_ROOT : `${API_ROOT}/${slug}`;
  const groupNames = collectGroupNames(service.operations);
  const groupSlugs = uniqueSlugs(
    groupNames.map((name) =>
      name === UNTAGGED_GROUP_NAME
        ? UNTAGGED_GROUP_SLUG
        : slugify(name, "group"),
    ),
  );
  const slugByName = new Map(
    groupNames.map((name, index) => [name, groupSlugs[index] ?? "group"]),
  );
  const canonical = new Map<string, Operation[]>();
  const listed = new Map<string, Operation[]>();
  for (const name of groupNames) {
    canonical.set(name, []);
    listed.set(name, []);
  }
  for (const operation of sortOperations(service.operations)) {
    const primary = operation.tags[0] ?? UNTAGGED_GROUP_NAME;
    canonical.get(primary)?.push(operation);
    for (const tag of operation.tags.length === 0
      ? [primary]
      : operation.tags) {
      listed.get(tag)?.push(operation);
    }
  }
  const summaries = new Map<string, ReaderOperationSummary>();
  const groups = groupNames.map((name): ReaderGroup => {
    const groupSlug = slugByName.get(name) ?? "group";
    const href = `${serviceHref}/${groupSlug}`;
    const members = canonical.get(name) ?? [];
    const operationSlugs = uniqueSlugs(members.map(operationSlugCandidate));
    const operations = members.map(
      (operation, index): ReaderOperationSummary => {
        const operationSlug = operationSlugs[index] ?? "operation";
        const summary: ReaderOperationSummary = {
          deprecated: operation.deprecated,
          groupSlug,
          href: `${href}/${operationSlug}`,
          id: operation.id,
          method: operation.method,
          path: operation.path,
          serviceSlug: slug,
          slug: operationSlug,
          title: operation.title,
        };
        summaries.set(operation.id, summary);
        return summary;
      },
    );
    return { href, listed: [], name, operations, slug: groupSlug };
  });
  const withListed = groups.map((group): ReaderGroup => ({
    ...group,
    listed: (listed.get(group.name) ?? []).flatMap((operation) => {
      const summary = summaries.get(operation.id);
      return summary === undefined ? [] : [summary];
    }),
  }));
  return {
    ...(service.description === undefined
      ? {}
      : { description: service.description }),
    groups: withListed,
    href: serviceHref,
    id: service.id,
    name: service.name,
    operationCount: service.operations.length,
    slug,
  };
}

/** Group names in first-appearance order of canonical operation order; untagged last. */
function collectGroupNames(
  operations: readonly Operation[],
): readonly string[] {
  const names: string[] = [];
  let untagged = false;
  for (const operation of sortOperations(operations)) {
    if (operation.tags.length === 0) {
      untagged = true;
      continue;
    }
    for (const tag of operation.tags) {
      if (!names.includes(tag)) names.push(tag);
    }
  }
  names.sort(compareText);
  if (untagged) names.push(UNTAGGED_GROUP_NAME);
  return names;
}

/**
 * Canonical navigation order: by path, then by conventional method order, then
 * by canonical id. Source order is not presentation-significant for operations,
 * so this keeps routes and sidebars stable across re-ordered documents.
 */
function sortOperations(
  operations: readonly Operation[],
): readonly Operation[] {
  return [...operations].sort(
    (left, right) =>
      compareText(left.path, right.path) ||
      METHOD_ORDER.indexOf(left.method) - METHOD_ORDER.indexOf(right.method) ||
      compareText(left.id, right.id),
  );
}

function operationSlugCandidate(operation: Operation): string {
  return operation.contractId === undefined
    ? methodPathSlug(operation.method, operation.path)
    : identifierSlug(operation.contractId);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Route segments are slugs; anything else is rejected before lookup. */
function isSafeSegment(segment: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(segment);
}
