import type {
  ApiService,
  DocumentationArtifact,
  DocumentationVersion,
  HttpMethod,
  Operation,
  TagDefinition,
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
  /** Contract-declared tag description, when the source provided one. */
  readonly description?: string;
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
    services.map((service) => slugify(service.name, "service")),
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

function projectService(
  service: ApiService,
  slug: string,
  singleService: boolean,
): ReaderService {
  const serviceHref = singleService ? API_ROOT : `${API_ROOT}/${slug}`;
  const identities = collectGroups(service.operations, service.tags ?? []);
  const groupSlugs = uniqueSlugs(
    identities.map((identity) =>
      identity.untagged ? UNTAGGED_GROUP_SLUG : slugify(identity.name, "group"),
    ),
  );
  const canonical = new Map<number, Operation[]>();
  const listed = new Map<number, Operation[]>();
  const indexOfTag = new Map<string, number>();
  let untaggedIndex = -1;
  identities.forEach((identity, index) => {
    canonical.set(index, []);
    listed.set(index, []);
    if (identity.untagged) untaggedIndex = index;
    else indexOfTag.set(identity.name, index);
  });
  for (const operation of sortOperations(service.operations)) {
    const primary =
      operation.tags.length === 0
        ? untaggedIndex
        : (indexOfTag.get(operation.tags[0] ?? "") ?? untaggedIndex);
    canonical.get(primary)?.push(operation);
    const memberships =
      operation.tags.length === 0
        ? [untaggedIndex]
        : operation.tags.map((tag) => indexOfTag.get(tag) ?? untaggedIndex);
    for (const index of memberships) listed.get(index)?.push(operation);
  }
  const summaries = new Map<string, ReaderOperationSummary>();
  const groups = identities.map((identity, index): ReaderGroup => {
    const groupSlug = groupSlugs[index] ?? "group";
    const href = `${serviceHref}/${groupSlug}`;
    const members = canonical.get(index) ?? [];
    const operationSlugs = uniqueSlugs(members.map(operationSlugCandidate));
    const operations = members.map(
      (operation, position): ReaderOperationSummary => {
        const operationSlug = operationSlugs[position] ?? "operation";
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
    return {
      ...(identity.description === undefined
        ? {}
        : { description: identity.description }),
      href,
      listed: [],
      name: identity.name,
      operations,
      slug: groupSlug,
    };
  });
  const withListed = groups.map((group, index): ReaderGroup => ({
    ...group,
    listed: (listed.get(index) ?? []).flatMap((operation) => {
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

interface GroupIdentity {
  readonly name: string;
  readonly untagged: boolean;
  readonly description?: string;
}

/**
 * Group identities: contract-declared tags in declaration order (only those an
 * operation uses), then undeclared tags in case-insensitive canonical order,
 * then the untagged group when needed. A real tag named like the untagged
 * group keeps its own identity; only its slug gains a collision suffix.
 */
function collectGroups(
  operations: readonly Operation[],
  declared: readonly TagDefinition[],
): readonly GroupIdentity[] {
  const used = new Set<string>();
  let untagged = false;
  for (const operation of operations) {
    if (operation.tags.length === 0) untagged = true;
    for (const tag of operation.tags) used.add(tag);
  }
  const groups: GroupIdentity[] = [];
  const placed = new Set<string>();
  for (const tag of declared) {
    if (!used.has(tag.name) || placed.has(tag.name)) continue;
    placed.add(tag.name);
    groups.push({
      name: tag.name,
      untagged: false,
      ...(tag.description === undefined
        ? {}
        : { description: tag.description }),
    });
  }
  const undeclared = [...used].filter((name) => !placed.has(name));
  undeclared.sort(compareText);
  for (const name of undeclared) groups.push({ name, untagged: false });
  if (untagged) groups.push({ name: UNTAGGED_GROUP_NAME, untagged: true });
  return groups;
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

/** Locale-independent order that folds case before comparing code units. */
function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Route segments are slugs; anything else is rejected before lookup. */
function isSafeSegment(segment: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(segment);
}
