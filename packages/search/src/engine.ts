import MiniSearch, { type Options, type SearchResult } from "minisearch";

import { tokenize } from "./tokenize.js";
import {
  QUERY_LIMITS,
  type SearchDocument,
  type SearchIndexRecord,
  type SearchKind,
} from "./types.js";

/**
 * The single place that knows about MiniSearch. Build and browser share the
 * same options, so a serialized index loads with exactly the tokenizer and
 * fields that produced it. Ranking policy (SPEC-007 §31): exact title and
 * endpoint matches dominate, then headings and identifiers, then context and
 * body; prefix matches count below exact ones and fuzzy matches below prefix
 * ones; kind priority and reading order break ties deterministically.
 */

export const INDEX_FIELDS = [
  "title",
  "headings",
  "path",
  "method",
  "identifiers",
  "context",
  "body",
] as const;

export const FIELD_BOOSTS: Readonly<
  Record<(typeof INDEX_FIELDS)[number], number>
> = {
  body: 1,
  context: 1.5,
  headings: 3,
  identifiers: 2,
  // A method term in a query almost always means "this endpoint".
  method: 8,
  path: 4,
  title: 5,
};

/** Higher wins when scores tie: the most actionable destination first. */
export const KIND_PRIORITY: Readonly<Record<SearchKind, number>> = {
  group: 2,
  operation: 5,
  page: 4,
  section: 3,
  service: 1,
};

export const ENGINE_OPTIONS: Options<SearchIndexRecord> = {
  fields: [...INDEX_FIELDS],
  idField: "id",
  // Identity: tokenize already produces normalized terms, and MiniSearch
  // applies processTerm to queries too, so both sides stay identical.
  processTerm: (term) => term,
  searchOptions: {
    boost: { ...FIELD_BOOSTS },
    combineWith: "AND",
    fuzzy: (term) => (term.length >= QUERY_LIMITS.fuzzyMinLength ? 0.2 : false),
    maxFuzzy: 2,
    prefix: (term) => term.length >= QUERY_LIMITS.prefixMinLength,
    weights: { fuzzy: 0.3, prefix: 0.6 },
  },
  storeFields: [],
  tokenize: (text) => tokenize(text),
};

export function createEngine(): MiniSearch<SearchIndexRecord> {
  return new MiniSearch<SearchIndexRecord>(ENGINE_OPTIONS);
}

export function loadEngine(serialized: unknown): MiniSearch<SearchIndexRecord> {
  return MiniSearch.loadJS(
    serialized as Parameters<typeof MiniSearch.loadJS>[0],
    ENGINE_OPTIONS,
  );
}

export interface RankedHit {
  readonly id: number;
  readonly score: number;
  /** Query terms that matched, in query order. */
  readonly terms: readonly string[];
}

/**
 * Deterministic ordering over engine hits: score (rounded so floating-point
 * noise cannot reorder equal work), kind priority, then reading order.
 */
export function rankHits(
  hits: readonly SearchResult[],
  documents: readonly SearchDocument[],
): RankedHit[] {
  const ranked = hits
    .map((hit) => ({
      id: Number(hit.id),
      score: Math.round(hit.score * 1_000) / 1_000,
      terms: hit.terms,
    }))
    .filter((hit) => documents[hit.id] !== undefined);
  ranked.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    const leftKind = KIND_PRIORITY[(documents[left.id] as SearchDocument).kind];
    const rightKind =
      KIND_PRIORITY[(documents[right.id] as SearchDocument).kind];
    if (leftKind !== rightKind) return rightKind - leftKind;
    return left.id - right.id;
  });
  return ranked;
}

/**
 * Diversity: a page with many matching headings, or a group with many
 * operations, may take at most `maxPerGroup` slots so other sources stay
 * visible; the bounded list is then cut to `maxResults`.
 */
export function diversify(
  ranked: readonly RankedHit[],
  documents: readonly SearchDocument[],
  limits: { readonly maxPerGroup: number; readonly maxResults: number },
): RankedHit[] {
  const perGroup = new Map<string, number>();
  const kept: RankedHit[] = [];
  for (const hit of ranked) {
    const document = documents[hit.id] as SearchDocument;
    const count = perGroup.get(document.group) ?? 0;
    if (count >= limits.maxPerGroup) continue;
    perGroup.set(document.group, count + 1);
    kept.push(hit);
    if (kept.length >= limits.maxResults) break;
  }
  return kept;
}
