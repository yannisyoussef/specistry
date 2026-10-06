/**
 * Normalized quality facts (SPEC-011 §9). Facts are an index over the
 * canonical documentation artifact, the authored content artifact, the
 * navigation artifact, the snippets artifact, and — when a comparison base
 * was resolved — the structured diff plus the base index. Every entity
 * carries the stable identity findings and suppressions are written
 * against. No parser object, YAML node, Markdown AST, React element, or
 * browser value ever reaches a rule.
 */

import type {
  ApiService,
  DocumentationArtifact,
  Operation,
  SchemaNode,
  SecurityScheme,
} from "@specistry/model";
import type {
  ContentArtifact,
  ContentPage,
  NavigationArtifact,
} from "@specistry/content";
import { flattenNavigation, selectVersion } from "@specistry/content";
import type {
  ChangeAspect,
  ContractDiff,
  DiffCandidate,
} from "@specistry/release";
import type { SdkDeclaration, SnippetsArtifact } from "@specistry/snippets";

import type { FactTarget } from "./contracts.js";

export interface ServiceFacts {
  /** The service id; also the identity of service-level findings. */
  readonly identity: string;
  readonly label: string;
  readonly service: ApiService;
}

export interface OperationFacts {
  /** `<service id>~<operation id>`, the canonical operation identity. */
  readonly identity: string;
  readonly serviceId: string;
  /** `GET /inboxes/{id}` — route-independent and safe to display. */
  readonly label: string;
  readonly operation: Operation;
}

export interface SchemaFacts {
  /** `<service id>~<schema id>`; registry schemas only. */
  readonly identity: string;
  readonly serviceId: string;
  readonly label: string;
  readonly schema: SchemaNode;
}

export interface SecuritySchemeFacts {
  /** `<service id>~<scheme id>`. */
  readonly identity: string;
  readonly serviceId: string;
  readonly label: string;
  readonly scheme: SecurityScheme;
  /** How many operations of the service can be called with this scheme. */
  readonly usedBy: number;
}

export interface PageFacts {
  /** The public route, which is the authored page's stable identity. */
  readonly identity: string;
  readonly label: string;
  readonly page: ContentPage;
  /** True when the navigation reaches the page. */
  readonly navigable: boolean;
}

export interface SdkFacts {
  readonly identity: string;
  readonly label: string;
  readonly declaration: SdkDeclaration;
  /** Operation identities that declare an example for this SDK. */
  readonly documented: ReadonlySet<string>;
}

/** Everything a rule may read about one documentation set. */
export interface FactIndex {
  readonly services: readonly ServiceFacts[];
  readonly operations: readonly OperationFacts[];
  readonly schemas: readonly SchemaFacts[];
  readonly securitySchemes: readonly SecuritySchemeFacts[];
  readonly operationsByIdentity: ReadonlyMap<string, OperationFacts>;
  readonly schemasByIdentity: ReadonlyMap<string, SchemaFacts>;
  readonly servicesByIdentity: ReadonlyMap<string, ServiceFacts>;
}

export interface ComparisonFacts {
  /** The base identifier exactly as the author named it. */
  readonly from: string;
  readonly diff: ContractDiff;
  readonly base: FactIndex;
  /**
   * `operation-changed` candidates by operation identity, indexed once so a
   * rule never scans every candidate for every operation.
   */
  readonly changed: ReadonlyMap<string, ChangedOperation>;
}

export interface ChangedOperation {
  readonly candidate: DiffCandidate;
  /** Change details by aspect, in diff order; an aspect with no detail maps to `""`. */
  readonly aspects: ReadonlyMap<ChangeAspect, readonly string[]>;
}

export interface QualityFacts extends FactIndex {
  readonly target: FactTarget;
  readonly pages: readonly PageFacts[];
  readonly sdks: readonly SdkFacts[];
  readonly comparison?: ComparisonFacts;
}

export interface FactsInput {
  readonly target: FactTarget;
  readonly artifact: DocumentationArtifact;
  readonly content?: ContentArtifact;
  readonly navigation?: NavigationArtifact;
  readonly snippets?: SnippetsArtifact;
  readonly comparison?: {
    readonly from: string;
    readonly diff: ContractDiff;
    readonly artifact: DocumentationArtifact;
  };
}

/** `<service id>~<entity id>`, the identity every rule and suppression uses. */
export function identityOf(serviceId: string, entityId: string): string {
  return `${serviceId}~${entityId}`;
}

export function operationLabel(operation: Operation): string {
  return `${operation.method} ${operation.path}`;
}

function indexArtifact(artifact: DocumentationArtifact): FactIndex {
  const version = selectVersion(artifact);
  const services: ServiceFacts[] = [];
  const operations: OperationFacts[] = [];
  const schemas: SchemaFacts[] = [];
  const securitySchemes: SecuritySchemeFacts[] = [];
  for (const service of version?.services ?? []) {
    services.push({
      identity: service.id,
      label: service.name,
      service,
    });
    for (const operation of service.operations) {
      operations.push({
        identity: identityOf(service.id, operation.id),
        label: operationLabel(operation),
        operation,
        serviceId: service.id,
      });
    }
    for (const [id, schema] of Object.entries(service.schemas)) {
      schemas.push({
        identity: identityOf(service.id, id),
        label: schemaLabel(id, schema),
        schema,
        serviceId: service.id,
      });
    }
    for (const [id, scheme] of Object.entries(service.securitySchemes)) {
      securitySchemes.push({
        identity: identityOf(service.id, id),
        label: id,
        scheme,
        serviceId: service.id,
        usedBy: service.operations.filter((operation) =>
          operation.security.some((requirement) =>
            requirement.schemes.some((use) => use.schemeId === id),
          ),
        ).length,
      });
    }
  }
  return {
    operations,
    operationsByIdentity: byIdentity(operations),
    schemas,
    schemasByIdentity: byIdentity(schemas),
    securitySchemes,
    services,
    servicesByIdentity: byIdentity(services),
  };
}

function schemaLabel(id: string, schema: SchemaNode): string {
  return schema.name ?? schema.title ?? id;
}

function byIdentity<T extends { readonly identity: string }>(
  entries: readonly T[],
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const entry of entries) map.set(entry.identity, entry);
  return map;
}

/**
 * Builds the fact index rules evaluate. Pure: the same artifacts always
 * produce the same facts in the same order (canonical artifact order).
 */
export function collectFacts(input: FactsInput): QualityFacts {
  const index = indexArtifact(input.artifact);
  const navigable = new Set(
    flattenNavigation(input.navigation?.items ?? []).map(
      (entry) => entry.route,
    ),
  );
  const pages: PageFacts[] = (input.content?.pages ?? []).map((page) => ({
    identity: page.route,
    label: page.title,
    navigable: navigable.has(page.route),
    page,
  }));
  const sdks: SdkFacts[] = (input.snippets?.sdks ?? []).map((declaration) => ({
    declaration,
    documented: documentedOperations(input.snippets, declaration.id),
    identity: declaration.id,
    label: declaration.label,
  }));
  const comparison =
    input.comparison === undefined
      ? undefined
      : {
          base: indexArtifact(input.comparison.artifact),
          changed: indexChanges(input.comparison.diff),
          diff: input.comparison.diff,
          from: input.comparison.from,
        };
  return {
    ...index,
    pages,
    sdks,
    target: input.target,
    ...(comparison === undefined ? {} : { comparison }),
  };
}

/**
 * Operation identities with an authored example for one SDK. The snippets
 * artifact keys operations as `<service>~<operation>`, the same identity the
 * canonical index uses, so no translation is needed.
 */
function documentedOperations(
  snippets: SnippetsArtifact | undefined,
  sdkId: string,
): ReadonlySet<string> {
  const documented = new Set<string>();
  for (const [key, examples] of Object.entries(snippets?.sdkExamples ?? {})) {
    if (examples.some((example) => example.sdk === sdkId)) documented.add(key);
  }
  return documented;
}

function indexChanges(
  diff: ContractDiff,
): ReadonlyMap<string, ChangedOperation> {
  const changed = new Map<string, ChangedOperation>();
  for (const candidate of diff.candidates) {
    if (candidate.kind !== "operation-changed") continue;
    const aspects = new Map<ChangeAspect, string[]>();
    for (const change of candidate.changes ?? []) {
      const details = aspects.get(change.aspect) ?? [];
      details.push(change.detail ?? "");
      aspects.set(change.aspect, details);
    }
    changed.set(candidate.identity, { aspects, candidate });
  }
  return changed;
}
