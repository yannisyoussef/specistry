/**
 * Language-neutral, locale-independent tokenization shared by the build-time
 * indexer and the browser query engine. Matching is done on a normalized form
 * (NFKC, lower case, combining marks removed) so `création` matches
 * `creation`; display text is never normalized. API-shaped text is split on
 * its own boundaries: `/v1/inboxes/{id}` yields `v1`, `inboxes`, `id`;
 * `inboxId`, `inbox_id`, and `inbox-id` all yield `inbox`, `id`, and the
 * joined form `inboxid`, so both the parts and the identifier are findable.
 * No stemming and no stop words: those are English assumptions.
 */

const MAX_TOKEN_LENGTH = 64;
const MAX_TOKENS = 5_000;
/** Letters and digits in any script; everything else separates terms. */
const SEPARATORS = /[^\p{L}\p{N}]+/u;
/** camelCase / PascalCase / ACRONYMWord boundaries. */
const CAMEL = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;
const MARKS = /\p{M}+/gu;

/** The matching form of a term: NFKC, lower case, no combining marks. */
export function normalizeTerm(term: string): string {
  return term
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(MARKS, "")
    .slice(0, MAX_TOKEN_LENGTH);
}

/** Tokens for indexing or querying; deterministic for equal input. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const pieces = text.normalize("NFKC").split(SEPARATORS);
  for (const piece of pieces) {
    if (piece.length === 0) continue;
    const parts = piece.split(CAMEL).filter((part) => part.length > 0);
    if (parts.length > 1) {
      for (const part of parts) {
        const token = normalizeTerm(part);
        if (token.length > 0) tokens.push(token);
      }
    }
    const joined = normalizeTerm(piece);
    if (joined.length > 0) tokens.push(joined);
    if (tokens.length >= MAX_TOKENS) break;
  }
  return tokens.slice(0, MAX_TOKENS);
}

/** Bounded query terms: the tokenizer plus the query limits. */
export function queryTerms(
  query: string,
  limits: { readonly maxCharacters: number; readonly maxTerms: number },
): string[] {
  const bounded = query.slice(0, limits.maxCharacters);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of tokenize(bounded)) {
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= limits.maxTerms) break;
  }
  return terms;
}

/** Collapses whitespace and bounds a display string; never changes case. */
export function boundedText(text: string, maxCharacters: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxCharacters) return collapsed;
  const cut = collapsed.slice(0, maxCharacters - 1);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > maxCharacters / 2 ? cut.slice(0, boundary) : cut}…`;
}
