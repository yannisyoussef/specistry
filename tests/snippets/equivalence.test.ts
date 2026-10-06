import { readFileSync } from "node:fs";
import path from "node:path";

import { parseDocumentationArtifact } from "@specistry/model";
import {
  generateAll,
  projectArtifact,
  PROTOCOL_LANGUAGES,
  type EnvironmentProjection,
} from "@specistry/snippets";
import { describe, expect, it } from "vitest";

import {
  GOLDEN_CASES,
  generateCase,
} from "../../packages/snippets/src/generate.test.js";
import { extract, normalizeExpected } from "./extract.test-helper.js";

/**
 * Cross-language semantic matrix (SPEC-008 §111, §156): every generated
 * example is parsed back into method, URL, headers, and body and compared
 * with the resolved request it was generated from, for the golden fixture
 * matrix and for every TestInbox operation under every selection.
 */

describe("cross-language request equivalence", () => {
  for (const goldenCase of GOLDEN_CASES) {
    it(`${goldenCase.name} means the same request in all six languages`, () => {
      const set = generateCase(goldenCase);
      const expected = normalizeExpected(set.request);
      for (const snippet of set.snippets) {
        expect(
          extract(snippet.language, snippet.code),
          snippet.language,
        ).toEqual(expected);
      }
    });
  }

  it("holds for every TestInbox operation, environment, body, and auth alternative", () => {
    const artifact = parseDocumentationArtifact(
      readFileSync(
        path.join(
          process.cwd(),
          "tests/fixtures/reader/testinbox/.specistry/artifacts/documentation.json",
        ),
        "utf8",
      ),
    );
    const { operations } = projectArtifact(artifact);
    const configured: readonly EnvironmentProjection[] = [
      { baseUrl: "http://127.0.0.1:47391", id: "local", label: "Local" },
    ];
    let checked = 0;
    for (const [id, projection] of Object.entries(operations)) {
      const bodies =
        projection.bodies.length === 0
          ? [undefined]
          : projection.bodies.map((body) => body.mediaType);
      const auths =
        projection.auth.length === 0
          ? [undefined]
          : projection.auth.map((_, index) => String(index));
      for (const environments of [[], configured]) {
        for (const body of bodies) {
          for (const auth of auths) {
            const set = generateAll(projection, environments, { auth, body });
            const expected = normalizeExpected(set.request);
            for (const language of PROTOCOL_LANGUAGES) {
              const snippet = set.snippets.find(
                (candidate) => candidate.language === language,
              );
              expect(snippet).toBeDefined();
              expect(
                extract(language, snippet?.code ?? ""),
                `${id} ${language} ${body} ${auth}`,
              ).toEqual(expected);
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
