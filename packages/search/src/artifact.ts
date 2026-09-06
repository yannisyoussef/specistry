import {
  SEARCH_ENGINE,
  SEARCH_FORMAT_VERSION,
  type SearchArtifact,
  type SearchDocument,
  type SearchKind,
  type SearchMethod,
} from "./types.js";

/**
 * Strict, dependency-free parsing of the search artifact, used by the reader
 * server (integrity, before serving) and by the browser (before loading the
 * engine). Every string is bounded and every route must be a reader route,
 * so a malformed or hostile artifact fails closed rather than rendering.
 */

const MAX_ARTIFACT_BYTES = 64 * 1_024 * 1_024;
const MAX_DOCUMENTS = 200_000;
const MAX_STRING = 2_000;
const ROUTE =
  /^\/(?:docs(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){1,4}|api(?:\/[a-z0-9]+(?:-[a-z0-9]+)*){0,3})?(?:#[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const KINDS: ReadonlySet<string> = new Set([
  "group",
  "operation",
  "page",
  "section",
  "service",
]);
const METHODS: ReadonlySet<string> = new Set([
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
  "TRACE",
]);

export class SearchArtifactError extends Error {
  public readonly path: string;

  public constructor(message: string, path: string) {
    super(message);
    this.name = "SearchArtifactError";
    this.path = path;
  }
}

export function serializeSearchArtifact(artifact: SearchArtifact): string {
  return `${JSON.stringify(sortKeys(artifact))}\n`;
}

export function parseSearchArtifact(text: string): SearchArtifact {
  if (text.length > MAX_ARTIFACT_BYTES) {
    throw new SearchArtifactError(
      "Search artifact exceeds the size ceiling.",
      "/",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new SearchArtifactError("Search artifact is not valid JSON.", "/");
  }
  return parseSearchArtifactValue(value);
}

export function parseSearchArtifactValue(value: unknown): SearchArtifact {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["documents", "engine", "index", "searchVersion"])
  ) {
    throw new SearchArtifactError(
      "Search artifact shape is not recognized.",
      "/",
    );
  }
  if (value.searchVersion !== SEARCH_FORMAT_VERSION) {
    throw new SearchArtifactError(
      `Unsupported search artifact version; expected ${SEARCH_FORMAT_VERSION}.`,
      "/searchVersion",
    );
  }
  if (value.engine !== SEARCH_ENGINE) {
    throw new SearchArtifactError("Unsupported search engine.", "/engine");
  }
  if (
    !Array.isArray(value.documents) ||
    value.documents.length > MAX_DOCUMENTS
  ) {
    throw new SearchArtifactError("Invalid document list.", "/documents");
  }
  if (!isRecord(value.index)) {
    throw new SearchArtifactError("Invalid serialized index.", "/index");
  }
  const documents = value.documents.map((entry, index) =>
    parseDocument(entry, index, `/documents/${index}`),
  );
  return {
    documents,
    engine: SEARCH_ENGINE,
    index: value.index,
    searchVersion: SEARCH_FORMAT_VERSION,
  };
}

function parseDocument(
  value: unknown,
  position: number,
  path: string,
): SearchDocument {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "context",
      "deprecated",
      "excerpt",
      "group",
      "id",
      "kind",
      "method",
      "path",
      "route",
      "subtitle",
      "title",
    ])
  ) {
    throw new SearchArtifactError("Document shape is not recognized.", path);
  }
  if (value.id !== position) {
    throw new SearchArtifactError(
      "Document id must equal its position.",
      `${path}/id`,
    );
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !KINDS.has(kind)) {
    throw new SearchArtifactError("Invalid document kind.", `${path}/kind`);
  }
  const route = requireString(value.route, `${path}/route`);
  if (!ROUTE.test(route)) {
    throw new SearchArtifactError("Invalid document route.", `${path}/route`);
  }
  if (!Array.isArray(value.context) || value.context.length > 8) {
    throw new SearchArtifactError(
      "Invalid document context.",
      `${path}/context`,
    );
  }
  const method = value.method;
  if (
    method !== undefined &&
    (typeof method !== "string" || !METHODS.has(method))
  ) {
    throw new SearchArtifactError("Invalid document method.", `${path}/method`);
  }
  if (value.deprecated !== undefined && typeof value.deprecated !== "boolean") {
    throw new SearchArtifactError(
      "Invalid deprecated flag.",
      `${path}/deprecated`,
    );
  }
  return {
    context: value.context.map((entry, index) =>
      requireString(entry, `${path}/context/${index}`),
    ),
    ...(value.deprecated === undefined ? {} : { deprecated: value.deprecated }),
    excerpt: requireString(value.excerpt, `${path}/excerpt`, true),
    group: requireString(value.group, `${path}/group`),
    id: position,
    kind: kind as SearchKind,
    ...(method === undefined ? {} : { method: method as SearchMethod }),
    ...(value.path === undefined
      ? {}
      : { path: requireString(value.path, `${path}/path`) }),
    route,
    ...(value.subtitle === undefined
      ? {}
      : { subtitle: requireString(value.subtitle, `${path}/subtitle`) }),
    title: requireString(value.title, `${path}/title`),
  };
}

function requireString(
  value: unknown,
  path: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_STRING ||
    (!allowEmpty && value.length === 0)
  ) {
    throw new SearchArtifactError("Expected a bounded string.", path);
  }
  return value;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: object, allowed: readonly string[]): boolean {
  const permitted = new Set(allowed);
  return Object.keys(value).every((key) => permitted.has(key));
}
