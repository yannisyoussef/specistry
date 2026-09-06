/**
 * Authored-content rules (SPEC-011 §32). SPEC-006 already fails a build on
 * a broken link, a missing asset, or an unknown component, so nothing here
 * repeats correctness. What is left is the metadata a reader and a search
 * result depend on.
 */

import type { QualityRule } from "../contracts.js";
import { hasText } from "./text.js";

export const pageDescription: QualityRule = {
  category: "content",
  defaultSeverity: "info",
  evaluate(facts, emit) {
    for (const entry of facts.pages) {
      if (hasText(entry.page.description)) continue;
      emit({
        message:
          "The page has no description; search results and link previews fall back to its opening text.",
        source: entry.page.sourcePath,
        target: {
          identity: entry.identity,
          kind: "page",
          label: entry.label,
        },
      });
    }
  },
  id: "page-description",
  summary:
    "An authored page carries a description for search results, previews, and metadata.",
  title: "Authored page has a description",
};

export const CONTENT_RULES: readonly QualityRule[] = [pageDescription];
