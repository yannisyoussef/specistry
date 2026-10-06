import type {
  DocumentationArtifact,
  DocumentationVersion,
  HttpMethod,
  Operation,
  TagDefinition,
} from "@specistry/model";

/**
 * API reference route identity (ADR-010), shared by the reader (which renders
 * the routes) and the content build (which validates authored links against
 * them). Slugs are a public contract: deterministic, locale-independent, and
 * derived only from canonical data.
 */

export const API_ROOT = "/api";
export const UNTAGGED_GROUP_NAME = "Operations";
export const UNTAGGED_GROUP_SLUG = "operations";
const MAX_SLUG_LENGTH = 80;

export interface ApiOperationRoute {
  readonly id: string;
  readonly slug: string;
  readonly href: string;
}

export interface ApiGroupRoute {
  readonly name: string;
  readonly slug: string;
  readonly href: string;
  readonly untagged: boolean;
  readonly description?: string;
  /** Operations whose canonical route lives in this group, in reading order. */
  readonly operations: readonly ApiOperationRoute[];
  /** Every operation listed under the group, including ones canonical elsewhere. */
  readonly listedIds: readonly string[];
}

export interface ApiServiceRoute {
  readonly id: string;
  readonly slug: string;
  readonly href: string;
  readonly groups: readonly ApiGroupRoute[];
}

export interface ApiRouteTree {
  readonly version: DocumentationVersion;
  readonly singleService: boolean;
  readonly services: readonly ApiServiceRoute[];
}

/** Lower-case ASCII slug: letters, digits, and single hyphens. */
export function slugify(text: string, fallback = "item"): string {
  const ascii = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const bounded =
    ascii.length <= MAX_SLUG_LENGTH ? ascii : truncateAtWord(ascii);
  return bounded.length === 0 ? fallback : bounded;
}

function truncateAtWord(slug: string): string {
  const cut = slug.slice(0, MAX_SLUG_LENGTH);
  const boundary = cut.lastIndexOf("-");
  return (
    boundary > MAX_SLUG_LENGTH / 2 ? cut.slice(0, boundary) : cut
  ).replace(/-+$/g, "");
}

/** Slug for a contract identifier such as an `operationId`. */
export function identifierSlug(
  identifier: string,
  fallback = "operation",
): string {
  const spaced = identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return slugify(spaced, fallback);
}

/** Slug for a method and path pair when no contract identifier exists. */
export function methodPathSlug(method: string, path: string): string {
  return slugify(`${method} ${path.replace(/[{}]/g, "")}`, "operation");
}

/** Makes slugs unique in one namespace with `-2`, `-3`, … in canonical order. */
export function uniqueSlugs(candidates: readonly string[]): readonly string[] {
  const taken = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    let slug = candidate;
    let suffix = 2;
    while (taken.has(slug)) {
      slug = `${candidate}-${suffix}`;
      suffix += 1;
    }
    taken.add(slug);
    result.push(slug);
  }
  return result;
}

/** Deep-link fragment for a response status. */
export function responseAnchor(status: {
  readonly kind: "code" | "default" | "range";
  readonly code?: number;
  readonly range?: string;
}): string {
  if (status.kind === "code") return `response-${status.code ?? 0}`;
  if (status.kind === "range")
    return `response-${(status.range ?? "").toLowerCase()}`;
  return "response-default";
}

/** Deep-link fragment for a media type block. */
export function mediaTypeAnchor(prefix: string, mediaType: string): string {
  return `${prefix}-${slugify(mediaType, "media")}`;
}

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

/** The current documentation version, or the first one. */
export function selectVersion(
  artifact: DocumentationArtifact,
): DocumentationVersion {
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

/** Builds the route tree: services, groups, and operations with slugs and hrefs. */
export interface ApiRouteOptions {
  /** Root of the reference routes; `/api` or a versioned `/api/<version>` (SPEC-010). */
  readonly apiRoot?: string;
}

export function buildApiRouteTree(
  artifact: DocumentationArtifact,
  options: ApiRouteOptions = {},
): ApiRouteTree {
  const apiRoot = options.apiRoot ?? API_ROOT;
  const version = selectVersion(artifact);
  const services = version.services;
  const singleService = services.length === 1;
  const serviceSlugs = uniqueSlugs(
    services.map((service) => slugify(service.name, "service")),
  );
  return {
    services: services.map((service, index) => {
      const slug = serviceSlugs[index] ?? "service";
      const href = singleService ? apiRoot : `${apiRoot}/${slug}`;
      return {
        groups: buildGroups(service.operations, service.tags ?? [], href),
        href,
        id: service.id,
        slug,
      };
    }),
    singleService,
    version,
  };
}

/** Every route of the API reference, in reading order. */
export function apiRoutes(
  artifact: DocumentationArtifact,
  options: ApiRouteOptions = {},
): readonly string[] {
  const tree = buildApiRouteTree(artifact, options);
  const routes = [options.apiRoot ?? API_ROOT];
  for (const service of tree.services) {
    if (!tree.singleService) routes.push(service.href);
    for (const group of service.groups) {
      routes.push(group.href);
      for (const operation of group.operations) routes.push(operation.href);
    }
  }
  return routes;
}

interface GroupIdentity {
  readonly name: string;
  readonly untagged: boolean;
  readonly description?: string;
}

function buildGroups(
  operations: readonly Operation[],
  declared: readonly TagDefinition[],
  serviceHref: string,
): readonly ApiGroupRoute[] {
  const identities = collectGroups(operations, declared);
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
  for (const operation of sortOperations(operations)) {
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
  return identities.map((identity, index): ApiGroupRoute => {
    const slug = groupSlugs[index] ?? "group";
    const href = `${serviceHref}/${slug}`;
    const members = canonical.get(index) ?? [];
    const operationSlugs = uniqueSlugs(members.map(operationSlugCandidate));
    return {
      ...(identity.description === undefined
        ? {}
        : { description: identity.description }),
      href,
      listedIds: (listed.get(index) ?? []).map((operation) => operation.id),
      name: identity.name,
      operations: members.map((operation, position) => {
        const operationSlug = operationSlugs[position] ?? "operation";
        return {
          href: `${href}/${operationSlug}`,
          id: operation.id,
          slug: operationSlug,
        };
      }),
      slug,
      untagged: identity.untagged,
    };
  });
}

/**
 * Group identities: declared tags in declaration order (only those an
 * operation uses), then undeclared tags in case-insensitive canonical order,
 * then the untagged group when needed.
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

/** Canonical navigation order: path, conventional method order, canonical id. */
export function sortOperations(
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
export function compareText(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a !== b) return a < b ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
}
