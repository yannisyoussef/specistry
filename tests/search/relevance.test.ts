import { readFileSync } from "node:fs";
import path from "node:path";

import { createSearchClient } from "@specra/search/client";
import { parseSearchArtifact } from "@specra/search";
import { describe, expect, it } from "vitest";

import corpus from "./relevance.json" with { type: "json" };

/**
 * Relevance regression corpus (SPEC-007 §33, §123): golden queries against
 * the committed TestInbox search artifact, the exact bytes `specra build`
 * wrote. Ranking changes must change this file deliberately.
 */

interface Case {
  readonly query: string;
  readonly top?: string;
  readonly first?: readonly string[];
  readonly firstPrefix?: readonly string[];
  readonly within?: { readonly n: number; readonly routes: readonly string[] };
}

const artifact = parseSearchArtifact(
  readFileSync(
    path.join(
      process.cwd(),
      "tests",
      "fixtures",
      "reader",
      "testinbox",
      ".specra",
      "artifacts",
      "search.json",
    ),
    "utf8",
  ),
);
const client = createSearchClient(artifact, () => 0);

describe("relevance corpus", () => {
  for (const entry of corpus.queries as readonly Case[]) {
    it(`ranks "${entry.query}" as expected`, () => {
      const routes = client
        .search(entry.query)
        .hits.map((hit) => hit.document.route);
      const shown = routes.slice(0, 6).join(" | ");
      if (entry.top !== undefined) {
        expect(routes[0], shown).toBe(entry.top);
      }
      if (entry.first !== undefined) {
        expect(entry.first, shown).toContain(routes[0]);
      }
      if (entry.firstPrefix !== undefined) {
        expect(
          entry.firstPrefix.some((prefix) => routes[0]?.startsWith(prefix)),
          shown,
        ).toBe(true);
      }
      if (entry.within !== undefined) {
        const head = routes.slice(0, entry.within.n);
        for (const route of entry.within.routes) {
          expect(
            head,
            `${route} not within ${entry.within.n}: ${shown}`,
          ).toContain(route);
        }
      }
    });
  }

  it("keeps the same order across repeated queries and fresh clients", () => {
    const again = createSearchClient(artifact, () => 0);
    for (const entry of corpus.queries as readonly Case[]) {
      expect(
        again.search(entry.query).hits.map((hit) => hit.document.id),
      ).toEqual(client.search(entry.query).hits.map((hit) => hit.document.id));
    }
  });
});
