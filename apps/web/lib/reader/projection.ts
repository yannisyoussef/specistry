import {
  API_ROOT,
  buildApiRouteTree,
  UNTAGGED_GROUP_NAME,
  UNTAGGED_GROUP_SLUG,
} from "@specistry/content";
import type {
  ApiService,
  DocumentationArtifact,
  DocumentationVersion,
  HttpMethod,
  Operation,
} from "@specistry/model";

/**
 * Reader projection: the route identity and navigation grouping derived once
 * from a canonical artifact. Route identity (slugs, hrefs, group order) comes
 * from the shared route tree in `@specistry/content` so authored links and the
 * reader agree; this module adds the presentation data the shell and pages
 * need (names, descriptions, operation summaries). Deterministic for a given
 * artifact.
 */

export { API_ROOT, UNTAGGED_GROUP_NAME, UNTAGGED_GROUP_SLUG };

export interface ReaderProject {
  readonly name: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
}

export interface ReaderIndex {
  readonly project: ReaderProject;
  /** Root of the reference routes: `/api`, or `/api/<version>` for a release. */
  readonly apiRoot: string;
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
  readonly groupSlug: string;
  readonly serviceSlug: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly title: string;
  readonly deprecated: boolean;
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

/** Builds the reader index for the current documentation version. */
export function createReaderIndex(
  artifact: DocumentationArtifact,
  apiRoot: string = API_ROOT,
): ReaderIndex {
  const tree = buildApiRouteTree(artifact, { apiRoot });
  const { version } = tree;
  const projected = tree.services.map((route): ReaderService => {
    const service = version.services.find((entry) => entry.id === route.id);
    if (service === undefined) throw new Error("Route tree service mismatch.");
    const byId = new Map<string, Operation>(
      service.operations.map((operation) => [operation.id, operation]),
    );
    const summaries = new Map<string, ReaderOperationSummary>();
    const groups = route.groups.map((group): ReaderGroup => {
      const operations = group.operations.flatMap((entry) => {
        const operation = byId.get(entry.id);
        if (operation === undefined) return [];
        const summary: ReaderOperationSummary = {
          deprecated: operation.deprecated,
          groupSlug: group.slug,
          href: entry.href,
          id: operation.id,
          method: operation.method,
          path: operation.path,
          serviceSlug: route.slug,
          slug: entry.slug,
          title: operation.title,
        };
        summaries.set(operation.id, summary);
        return [summary];
      });
      return {
        ...(group.description === undefined
          ? {}
          : { description: group.description }),
        href: group.href,
        listed: [],
        name: group.name,
        operations,
        slug: group.slug,
      };
    });
    const withListed = groups.map((group, index): ReaderGroup => ({
      ...group,
      listed: (route.groups[index]?.listedIds ?? []).flatMap((id) => {
        const summary = summaries.get(id);
        return summary === undefined ? [] : [summary];
      }),
    }));
    return {
      ...(service.description === undefined
        ? {}
        : { description: service.description }),
      groups: withListed,
      href: route.href,
      id: service.id,
      name: service.name,
      operationCount: service.operations.length,
      slug: route.slug,
    };
  });
  const { project } = artifact.model;
  return {
    apiRoot,
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
    singleService: tree.singleService,
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
  const version = buildApiRouteTree(artifact, {
    apiRoot: index.apiRoot,
  }).version;
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

/** Route segments are slugs; anything else is rejected before lookup. */
function isSafeSegment(segment: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(segment);
}
