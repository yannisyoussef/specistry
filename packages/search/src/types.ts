/**
 * Specra search contract (SPEC-007, ADR-013). The build projects the canonical
 * API model, the authored content model, and the navigation order into
 * source-independent search documents, indexes them once, and writes one
 * deterministic artifact. The browser loads that artifact lazily and queries
 * it locally; queries never leave the reader. Display data and index data are
 * kept apart so the result payload is small and the engine stays replaceable.
 */

export const SEARCH_FORMAT_VERSION = 1 as const;
/** The engine whose serialized index the artifact carries. */
export const SEARCH_ENGINE = "minisearch/7" as const;
export const SEARCH_ARTIFACT_FILENAME = "search.json";

/**
 * Result kinds map one-to-one onto stable reader destinations. `service`
 * appears only for multi-service projects. There is deliberately no schema
 * or SDK kind: schemas have no global route yet and SDK documentation does
 * not exist before SPEC-008; both can be added as new kinds later.
 */
export type SearchKind = "group" | "operation" | "page" | "section" | "service";

export type SearchMethod =
  "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT" | "TRACE";

/** What the palette renders; every string is plain text, every route is a validated reader route. */
export interface SearchDocument {
  /** Position in the artifact; deterministic because documents are in reading order. */
  readonly id: number;
  readonly kind: SearchKind;
  /** Reader route, with a heading anchor for sections. */
  readonly route: string;
  readonly title: string;
  /** Mono second line: `POST /v1/inboxes`, or the page title for a section. */
  readonly subtitle?: string;
  /** Hierarchy shown for disambiguation, e.g. `["Guides", "Getting started"]`. */
  readonly context: readonly string[];
  readonly method?: SearchMethod;
  readonly path?: string;
  /** Bounded plain-text excerpt, never markup. */
  readonly excerpt: string;
  /** Diversity key: the page route or the group route; results are capped per group. */
  readonly group: string;
  readonly deprecated?: boolean;
}

/** What the index sees; kept out of the display payload. */
export interface SearchIndexRecord {
  readonly id: number;
  readonly title: string;
  readonly headings: string;
  readonly path: string;
  readonly method: string;
  readonly identifiers: string;
  readonly context: string;
  readonly body: string;
}

export interface SearchProjection {
  readonly documents: readonly SearchDocument[];
  readonly records: readonly SearchIndexRecord[];
}

export interface SearchArtifact {
  readonly searchVersion: typeof SEARCH_FORMAT_VERSION;
  readonly engine: typeof SEARCH_ENGINE;
  readonly documents: readonly SearchDocument[];
  /** The engine's own serialized index (MiniSearch `toJSON`). */
  readonly index: unknown;
}

export interface SearchStatistics {
  readonly documents: number;
  readonly terms: number;
}

/** Limits applied to user queries and result lists. */
export const QUERY_LIMITS = {
  maxCharacters: 200,
  maxTerms: 12,
  maxResults: 12,
  /** At most this many results share one diversity group (page or API group). */
  maxPerGroup: 3,
  /** Prefix matching applies to terms at least this long. */
  prefixMinLength: 2,
  /** Fuzzy matching applies to terms at least this long. */
  fuzzyMinLength: 4,
} as const;

/** Bounds applied while projecting sources, so a hostile page cannot inflate the index. */
export const PROJECTION_LIMITS = {
  excerptCharacters: 240,
  bodyCharacters: 20_000,
  sectionBodyCharacters: 4_000,
  identifiers: 64,
  contextCharacters: 200,
  titleCharacters: 200,
} as const;
