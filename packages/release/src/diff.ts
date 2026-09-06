import { createHash } from "node:crypto";

import type {
  ApiService,
  DocumentationArtifact,
  Operation,
  Parameter,
  Response,
  SchemaNode,
} from "@specra/model";
import { selectVersion } from "@specra/content";

import { sortKeys } from "./manifest.js";

/**
 * Structured contract-diff candidates (SPEC-010 §76–§85, §118). Two
 * canonical artifacts are compared by stable identity only: services by
 * id, groups by tag name within a service, operations by canonical
 * operation id (the declared `operationId`, or the method-and-path
 * identity the model derives without one), schemas by registry id. An
 * entity whose identity changed is reported as removed plus added; nothing
 * is inferred from similarity. Records describe structure, never values:
 * a changed example or schema is a digest change, an enum is a count. No
 * breaking-change label or score exists here; SPEC-011 owns that policy.
 * Output is deterministic: sorted, bounded, and free of timestamps.
 */

export const DIFF_FORMAT_VERSION = 1 as const;
export const DIFF_CANDIDATES_FILENAME = "diff.json";
export const MAX_DIFF_CANDIDATES = 10_000;
export const MAX_CHANGES_PER_CANDIDATE = 200;
const MAX_DETAIL_LENGTH = 200;

export type CandidateKind =
  | "group-added"
  | "group-removed"
  | "operation-added"
  | "operation-changed"
  | "operation-removed"
  | "schema-added"
  | "schema-changed"
  | "schema-removed"
  | "service-added"
  | "service-removed";

export type ChangeAspect =
  | "deprecated"
  | "description"
  | "method"
  | "parameter-added"
  | "parameter-changed"
  | "parameter-removed"
  | "path"
  | "request-media-added"
  | "request-media-removed"
  | "request-required"
  | "request-schema"
  | "response-added"
  | "response-media-added"
  | "response-media-removed"
  | "response-removed"
  | "response-schema"
  | "security"
  | "tags"
  | "title";

export interface CandidateChange {
  readonly aspect: ChangeAspect;
  /** A contract identifier (parameter, status, media type), never a value. */
  readonly detail?: string;
}

export interface DiffCandidate {
  /** `<from>..<to>:<kind>:<identity>`; stable across runs. */
  readonly id: string;
  readonly kind: CandidateKind;
  readonly service: string;
  /** Semantic identity: service id, `service~group`, `service~operation`, `service~schema`. */
  readonly identity: string;
  /** Route-independent description for review: method and path template, or a name. */
  readonly label: string;
  readonly changes?: readonly CandidateChange[];
  /** Canonical routes affected, unversioned (`/api/...`); scoped by the reader. */
  readonly route?: { readonly from?: string; readonly to?: string };
}

export interface ContractDiff {
  readonly diffFormat: typeof DIFF_FORMAT_VERSION;
  readonly from: string;
  readonly to: string;
  readonly candidates: readonly DiffCandidate[];
  readonly truncated: boolean;
  readonly counts: Readonly<Record<CandidateKind, number>>;
}

export interface DiffInput {
  readonly version: string;
  readonly artifact: DocumentationArtifact;
  /** Unversioned operation hrefs by `service~operation`, for route candidates. */
  readonly routes?: ReadonlyMap<string, string> | undefined;
}

const KIND_ORDER: readonly CandidateKind[] = [
  "service-removed",
  "service-added",
  "group-removed",
  "group-added",
  "operation-removed",
  "operation-added",
  "operation-changed",
  "schema-removed",
  "schema-added",
  "schema-changed",
];

export interface DiffOptions {
  /** Candidate budget; defaults to `MAX_DIFF_CANDIDATES`. */
  readonly maxCandidates?: number;
}

export function diffArtifacts(
  from: DiffInput,
  to: DiffInput,
  options: DiffOptions = {},
): ContractDiff {
  const limit = Math.min(
    MAX_DIFF_CANDIDATES,
    Math.max(1, options.maxCandidates ?? MAX_DIFF_CANDIDATES),
  );
  const before = new Map(
    selectVersion(from.artifact).services.map((service) => [
      service.id as string,
      service,
    ]),
  );
  const after = new Map(
    selectVersion(to.artifact).services.map((service) => [
      service.id as string,
      service,
    ]),
  );
  const candidates: DiffCandidate[] = [];
  const prefix = `${from.version}..${to.version}`;
  const push = (candidate: Omit<DiffCandidate, "id">) => {
    candidates.push({
      id: `${prefix}:${candidate.kind}:${candidate.identity}`,
      ...candidate,
    });
  };
  for (const [id, service] of sorted(before)) {
    if (!after.has(id))
      push({
        identity: id,
        kind: "service-removed",
        label: service.name,
        service: id,
      });
  }
  for (const [id, service] of sorted(after)) {
    if (!before.has(id))
      push({
        identity: id,
        kind: "service-added",
        label: service.name,
        service: id,
      });
  }
  for (const [id, previous] of sorted(before)) {
    const next = after.get(id);
    if (next === undefined) continue;
    diffService(id, previous, next, from.routes, to.routes, push);
  }
  candidates.sort(compareCandidates);
  const truncated = candidates.length > limit;
  const bounded = truncated ? candidates.slice(0, limit) : candidates;
  const counts = Object.fromEntries(
    KIND_ORDER.map((kind) => [kind, 0]),
  ) as Record<CandidateKind, number>;
  for (const candidate of bounded) counts[candidate.kind] += 1;
  return {
    candidates: bounded,
    counts,
    diffFormat: DIFF_FORMAT_VERSION,
    from: from.version,
    to: to.version,
    truncated,
  };
}

function diffService(
  serviceId: string,
  before: ApiService,
  after: ApiService,
  fromRoutes: ReadonlyMap<string, string> | undefined,
  toRoutes: ReadonlyMap<string, string> | undefined,
  push: (candidate: Omit<DiffCandidate, "id">) => void,
): void {
  const groupsBefore = groupNames(before);
  const groupsAfter = groupNames(after);
  for (const name of [...groupsBefore].sort(compareText)) {
    if (!groupsAfter.has(name)) {
      push({
        identity: `${serviceId}~${name}`,
        kind: "group-removed",
        label: name,
        service: serviceId,
      });
    }
  }
  for (const name of [...groupsAfter].sort(compareText)) {
    if (!groupsBefore.has(name)) {
      push({
        identity: `${serviceId}~${name}`,
        kind: "group-added",
        label: name,
        service: serviceId,
      });
    }
  }
  const operationsBefore = new Map(
    before.operations.map((operation) => [operation.id as string, operation]),
  );
  const operationsAfter = new Map(
    after.operations.map((operation) => [operation.id as string, operation]),
  );
  for (const [id, operation] of sorted(operationsBefore)) {
    if (operationsAfter.has(id)) continue;
    const key = `${serviceId}~${id}`;
    const from = fromRoutes?.get(key);
    push({
      identity: key,
      kind: "operation-removed",
      label: `${operation.method} ${operation.path}`,
      ...(from === undefined ? {} : { route: { from } }),
      service: serviceId,
    });
  }
  for (const [id, operation] of sorted(operationsAfter)) {
    if (operationsBefore.has(id)) continue;
    const key = `${serviceId}~${id}`;
    const to = toRoutes?.get(key);
    push({
      identity: key,
      kind: "operation-added",
      label: `${operation.method} ${operation.path}`,
      ...(to === undefined ? {} : { route: { to } }),
      service: serviceId,
    });
  }
  for (const [id, previous] of sorted(operationsBefore)) {
    const next = operationsAfter.get(id);
    if (next === undefined) continue;
    const changes = diffOperation(previous, next, before, after);
    if (changes.length === 0) continue;
    const key = `${serviceId}~${id}`;
    const from = fromRoutes?.get(key);
    const to = toRoutes?.get(key);
    const routeChanged = from !== undefined && to !== undefined && from !== to;
    push({
      changes: changes.slice(0, MAX_CHANGES_PER_CANDIDATE),
      identity: key,
      kind: "operation-changed",
      label: `${next.method} ${next.path}`,
      ...(routeChanged ? { route: { from, to } } : {}),
      service: serviceId,
    });
  }
  const schemasBefore = new Map(Object.entries(before.schemas));
  const schemasAfter = new Map(Object.entries(after.schemas));
  for (const [id] of sorted(schemasBefore)) {
    if (!schemasAfter.has(id))
      push({
        identity: `${serviceId}~${id}`,
        kind: "schema-removed",
        label: id,
        service: serviceId,
      });
  }
  for (const [id] of sorted(schemasAfter)) {
    if (!schemasBefore.has(id))
      push({
        identity: `${serviceId}~${id}`,
        kind: "schema-added",
        label: id,
        service: serviceId,
      });
  }
  for (const [id, schema] of sorted(schemasBefore)) {
    const next = schemasAfter.get(id);
    if (next === undefined) continue;
    if (schemaDigest(schema) !== schemaDigest(next)) {
      push({
        identity: `${serviceId}~${id}`,
        kind: "schema-changed",
        label: id,
        service: serviceId,
      });
    }
  }
}

function diffOperation(
  before: Operation,
  after: Operation,
  serviceBefore: ApiService,
  serviceAfter: ApiService,
): CandidateChange[] {
  const changes: CandidateChange[] = [];
  if (before.method !== after.method)
    changes.push({
      aspect: "method",
      detail: detail(`${before.method} -> ${after.method}`),
    });
  if (before.path !== after.path)
    changes.push({
      aspect: "path",
      detail: detail(`${before.path} -> ${after.path}`),
    });
  if (before.title !== after.title) changes.push({ aspect: "title" });
  if ((before.description ?? "") !== (after.description ?? ""))
    changes.push({ aspect: "description" });
  if (before.deprecated !== after.deprecated)
    changes.push({
      aspect: "deprecated",
      detail: after.deprecated ? "deprecated" : "reinstated",
    });
  if (before.tags.join("\u0000") !== after.tags.join("\u0000"))
    changes.push({ aspect: "tags" });
  const parametersBefore = new Map(
    before.parameters.map((parameter) => [parameterKey(parameter), parameter]),
  );
  const parametersAfter = new Map(
    after.parameters.map((parameter) => [parameterKey(parameter), parameter]),
  );
  for (const [key] of sorted(parametersBefore)) {
    if (!parametersAfter.has(key))
      changes.push({ aspect: "parameter-removed", detail: detail(key) });
  }
  for (const [key] of sorted(parametersAfter)) {
    if (!parametersBefore.has(key))
      changes.push({ aspect: "parameter-added", detail: detail(key) });
  }
  for (const [key, parameter] of sorted(parametersBefore)) {
    const next = parametersAfter.get(key);
    if (
      next !== undefined &&
      parameterDigest(parameter, serviceBefore) !==
        parameterDigest(next, serviceAfter)
    ) {
      changes.push({ aspect: "parameter-changed", detail: detail(key) });
    }
  }
  if (
    (before.requestBody?.required ?? false) !==
    (after.requestBody?.required ?? false)
  ) {
    changes.push({ aspect: "request-required" });
  }
  const mediaBefore = new Map(
    (before.requestBody?.content ?? []).map((content) => [
      content.mediaType,
      content,
    ]),
  );
  const mediaAfter = new Map(
    (after.requestBody?.content ?? []).map((content) => [
      content.mediaType,
      content,
    ]),
  );
  for (const [type] of sorted(mediaBefore)) {
    if (!mediaAfter.has(type))
      changes.push({ aspect: "request-media-removed", detail: detail(type) });
  }
  for (const [type] of sorted(mediaAfter)) {
    if (!mediaBefore.has(type))
      changes.push({ aspect: "request-media-added", detail: detail(type) });
  }
  for (const [type, content] of sorted(mediaBefore)) {
    const next = mediaAfter.get(type);
    if (
      next !== undefined &&
      schemaDigest(content.schema, serviceBefore) !==
        schemaDigest(next.schema, serviceAfter)
    ) {
      changes.push({ aspect: "request-schema", detail: detail(type) });
    }
  }
  const responsesBefore = new Map(
    before.responses.map((response) => [statusKey(response), response]),
  );
  const responsesAfter = new Map(
    after.responses.map((response) => [statusKey(response), response]),
  );
  for (const [status] of sorted(responsesBefore)) {
    if (!responsesAfter.has(status))
      changes.push({ aspect: "response-removed", detail: status });
  }
  for (const [status] of sorted(responsesAfter)) {
    if (!responsesBefore.has(status))
      changes.push({ aspect: "response-added", detail: status });
  }
  for (const [status, response] of sorted(responsesBefore)) {
    const next = responsesAfter.get(status);
    if (next === undefined) continue;
    const bodiesBefore = new Map(
      response.bodies.map((body) => [body.mediaType, body]),
    );
    const bodiesAfter = new Map(
      next.bodies.map((body) => [body.mediaType, body]),
    );
    for (const [type] of sorted(bodiesBefore)) {
      if (!bodiesAfter.has(type))
        changes.push({
          aspect: "response-media-removed",
          detail: detail(`${status} ${type}`),
        });
    }
    for (const [type] of sorted(bodiesAfter)) {
      if (!bodiesBefore.has(type))
        changes.push({
          aspect: "response-media-added",
          detail: detail(`${status} ${type}`),
        });
    }
    for (const [type, body] of sorted(bodiesBefore)) {
      const nextBody = bodiesAfter.get(type);
      if (
        nextBody !== undefined &&
        schemaDigest(body.schema, serviceBefore) !==
          schemaDigest(nextBody.schema, serviceAfter)
      ) {
        changes.push({
          aspect: "response-schema",
          detail: detail(`${status} ${type}`),
        });
      }
    }
  }
  if (securityDigest(before) !== securityDigest(after))
    changes.push({ aspect: "security" });
  return changes;
}

function groupNames(service: ApiService): Set<string> {
  const names = new Set<string>();
  for (const operation of service.operations)
    for (const tag of operation.tags) names.add(tag);
  return names;
}

function parameterKey(parameter: Parameter): string {
  return `${parameter.location}:${parameter.name}`;
}

function statusKey(response: Response): string {
  const status = response.status;
  if (status.kind === "code") return String(status.code);
  if (status.kind === "range") return status.range;
  return "default";
}

/**
 * A structural digest of a schema: references are followed into the
 * service registry (bounded), so a change inside a referenced schema is
 * visible where it is used, but values inside examples are excluded.
 */
function schemaDigest(
  schema: SchemaNode | undefined,
  service?: ApiService,
): string {
  if (schema === undefined) return "none";
  const seen = new Set<string>();
  const expand = (node: unknown, depth: number): unknown => {
    if (depth > 12 || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item) => expand(item, depth + 1));
    const record = node as Record<string, unknown>;
    if (
      record.kind === "ref" &&
      typeof record.schemaId === "string" &&
      service !== undefined
    ) {
      const id = record.schemaId;
      if (seen.has(id) || !Object.hasOwn(service.schemas, id))
        return { ref: id };
      seen.add(id);
      return { ref: id, target: expand(service.schemas[id], depth + 1) };
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (
        key === "examples" ||
        key === "defaultValue" ||
        key === "constValue"
      ) {
        out[key] =
          value === undefined
            ? undefined
            : `digest:${createHash("sha256")
                .update(JSON.stringify(sortKeys(value)))
                .digest("hex")
                .slice(0, 16)}`;
        continue;
      }
      if (key === "enumValues" && Array.isArray(value)) {
        out[key] = {
          count: value.length,
          digest: createHash("sha256")
            .update(JSON.stringify(sortKeys(value)))
            .digest("hex")
            .slice(0, 16),
        };
        continue;
      }
      out[key] = expand(value, depth + 1);
    }
    return out;
  };
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(expand(schema, 0))))
    .digest("hex");
}

function parameterDigest(parameter: Parameter, service: ApiService): string {
  const { examples, ...rest } = parameter as Parameter & { examples: unknown };
  void examples;
  const shape: Record<string, unknown> = { ...rest };
  if ("schema" in parameter)
    shape.schema = schemaDigest(parameter.schema, service);
  if ("content" in parameter)
    shape.content = {
      mediaType: parameter.content.mediaType,
      schema: schemaDigest(parameter.content.schema, service),
    };
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(shape)))
    .digest("hex");
}

function securityDigest(operation: Operation): string {
  const alternatives = operation.security.map((requirement) =>
    requirement.schemes
      .map((use) => `${use.schemeId}(${[...use.scopes].sort().join(",")})`)
      .sort()
      .join("+"),
  );
  return alternatives.sort().join("|");
}

function detail(text: string): string {
  const clean = text.replace(
    /[\u0000-\u001f\u007f-\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
  return clean.length > MAX_DETAIL_LENGTH
    ? `${clean.slice(0, MAX_DETAIL_LENGTH - 1)}…`
    : clean;
}

function sorted<T>(map: ReadonlyMap<string, T>): readonly [string, T][] {
  return [...map.entries()].sort(([left], [right]) => compareText(left, right));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareCandidates(left: DiffCandidate, right: DiffCandidate): number {
  return (
    compareText(left.service, right.service) ||
    KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
    compareText(left.identity, right.identity)
  );
}

export function serializeContractDiff(diff: ContractDiff): string {
  return `${JSON.stringify(sortKeys(diff), null, 2)}\n`;
}
