import { parseSearchArtifactValue, SearchArtifactError } from "./artifact.js";
import { diversify, loadEngine, rankHits } from "./engine.js";
import { normalizeTerm, queryTerms, tokenize } from "./tokenize.js";
import {
  QUERY_LIMITS,
  type SearchArtifact,
  type SearchDocument,
  type SearchKind,
} from "./types.js";

/**
 * Browser-safe query engine (SPEC-007). It receives the parsed search
 * artifact, hydrates the prebuilt index, and answers queries locally: no
 * network, no telemetry, no parser. Results carry plain-text segments for
 * highlighting so the palette never builds HTML from indexed strings.
 */

export { SearchArtifactError, parseSearchArtifactValue };
export { QUERY_LIMITS };
export type { SearchArtifact, SearchDocument, SearchKind };

/** A slice of display text; `match` marks a matched term. */
export interface TextSegment {
  readonly text: string;
  readonly match: boolean;
}

export interface SearchHit {
  readonly document: SearchDocument;
  readonly score: number;
  readonly title: readonly TextSegment[];
}

export interface SearchResponse {
  readonly query: string;
  readonly terms: readonly string[];
  readonly hits: readonly SearchHit[];
  /** Milliseconds spent in the engine, for the palette footer. */
  readonly elapsedMs: number;
}

export interface SearchClient {
  readonly documents: readonly SearchDocument[];
  search(query: string): SearchResponse;
}

export function createSearchClient(
  artifact: SearchArtifact,
  now: () => number = () => Date.now(),
): SearchClient {
  const engine = loadEngine(artifact.index);
  const { documents } = artifact;
  return {
    documents,
    search(query: string): SearchResponse {
      const started = now();
      const terms = queryTerms(query, QUERY_LIMITS);
      if (terms.length === 0) {
        return { elapsedMs: 0, hits: [], query, terms };
      }
      // Any term may match (a document matching more terms scores higher
      // under BM25, and title/path/method boosts keep exact endpoints on
      // top). Fuzziness is only tried when exact and prefix matching finds
      // nothing, so typos are tolerated without adding noise to clean queries.
      const text = terms.join(" ");
      const exact = engine.search(text, { combineWith: "OR", fuzzy: false });
      const raw =
        exact.length > 0 ? exact : engine.search(text, { combineWith: "OR" });
      const ranked = diversify(
        rankHits(raw, documents),
        documents,
        QUERY_LIMITS,
      );
      const hits = ranked.map((hit): SearchHit => {
        const document = documents[hit.id] as SearchDocument;
        return {
          document,
          score: hit.score,
          title: highlight(document.title, hit.terms),
        };
      });
      return { elapsedMs: Math.max(0, now() - started), hits, query, terms };
    },
  };
}

/**
 * Splits display text into matched and unmatched segments by comparing each
 * display token's normalized form against the matched terms (exact or
 * prefix). No regular expression is built from the query.
 */
export function highlight(
  text: string,
  terms: readonly string[],
): readonly TextSegment[] {
  if (terms.length === 0 || text.length === 0) return [{ match: false, text }];
  const segments: TextSegment[] = [];
  const matcher = /[\p{L}\p{N}]+/gu;
  let last = 0;
  for (const found of text.matchAll(matcher)) {
    const start = found.index;
    const word = found[0];
    if (start > last)
      segments.push({ match: false, text: text.slice(last, start) });
    const forms = new Set([normalizeTerm(word), ...tokenize(word)]);
    const matched = terms.some((term) =>
      [...forms].some((form) => form === term || form.startsWith(term)),
    );
    segments.push({ match: matched, text: word });
    last = start + word.length;
  }
  if (last < text.length)
    segments.push({ match: false, text: text.slice(last) });
  return mergeSegments(segments);
}

function mergeSegments(segments: readonly TextSegment[]): TextSegment[] {
  const merged: TextSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.match === segment.match) {
      merged[merged.length - 1] = {
        match: previous.match,
        text: previous.text + segment.text,
      };
    } else {
      merged.push(segment);
    }
  }
  return merged;
}
