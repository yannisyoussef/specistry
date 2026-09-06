import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { findOperation, OPERATIONS, SERVICE } from "./fixtures.test-helper.js";
import { generateAll } from "./generate.js";
import { projectOperation } from "./projection.js";
import type { Selection } from "./resolve.js";
import { PROTOCOL_LANGUAGES, SNIPPET_LIMITS } from "./types.js";

/**
 * Golden snippets (SPEC-008 §110, §155): the exact generated text for every
 * fixture operation in all six languages is committed under `goldens/`.
 * Formatting is part of the contract, so a change here is reviewed as a
 * user-visible change: run with `UPDATE_SNIPPET_GOLDENS=1` to rewrite.
 */

const goldenRoot = fileURLToPath(new URL("../goldens/", import.meta.url));
const update = process.env.UPDATE_SNIPPET_GOLDENS === "1";

export interface GoldenCase {
  readonly name: string;
  readonly contractId: string;
  readonly selection?: Selection;
  readonly environments?: readonly {
    readonly id: string;
    readonly label: string;
    readonly baseUrl: string;
  }[];
}

export const GOLDEN_CASES: readonly GoldenCase[] = [
  ...OPERATIONS.map((operation) => ({
    contractId: operation.contractId as string,
    name: operation.contractId as string,
  })),
  {
    contractId: "compoundAuth",
    name: "compoundAuth.oidc",
    selection: { auth: "1" },
  },
  {
    contractId: "compoundAuth",
    name: "compoundAuth.anonymous",
    selection: { auth: "2" },
  },
  { contractId: "postJson", name: "postJson.bearer", selection: { auth: "1" } },
  {
    contractId: "submitForm",
    name: "submitForm.json",
    selection: { body: "application/json" },
  },
  {
    contractId: "postJson",
    name: "postJson.local",
    selection: { environment: "local" },
  },
  {
    contractId: "postJson",
    environments: [
      {
        baseUrl: "https://sandbox.example.com/v2",
        id: "sandbox",
        label: "Sandbox",
      },
    ],
    name: "postJson.configured",
  },
  {
    contractId: "hostile",
    name: "hostile.text",
    selection: { body: "text/plain" },
  },
];

export function generateCase(goldenCase: GoldenCase) {
  const { projection } = projectOperation(
    SERVICE,
    findOperation(goldenCase.contractId),
  );
  return generateAll(
    projection,
    goldenCase.environments ?? [],
    goldenCase.selection ?? {},
  );
}

describe("golden snippets", () => {
  for (const goldenCase of GOLDEN_CASES) {
    for (const language of PROTOCOL_LANGUAGES) {
      it(`${goldenCase.name} · ${language}`, () => {
        const set = generateCase(goldenCase);
        const snippet = set.snippets.find(
          (candidate) => candidate.language === language,
        );
        expect(snippet).toBeDefined();
        if (snippet === undefined) return;
        const file = path.join(
          goldenRoot,
          `${goldenCase.name}.${language}.txt`,
        );
        if (update || !existsSync(file)) {
          mkdirSync(goldenRoot, { recursive: true });
          writeFileSync(file, `${snippet.code}\n`, "utf8");
        }
        expect(`${snippet.code}\n`).toBe(readFileSync(file, "utf8"));
        // Tokens and text can never disagree.
        expect(
          snippet.lines
            .map((line) => line.map((token) => token.text).join(""))
            .join("\n"),
        ).toBe(snippet.code);
        expect(snippet.lines.length).toBeLessThanOrEqual(
          SNIPPET_LIMITS.maxCodeLines,
        );
        expect(snippet.code.length).toBeLessThanOrEqual(
          SNIPPET_LIMITS.maxCodeCharacters,
        );
      });
    }
  }

  it("is deterministic across repeated generation", () => {
    for (const goldenCase of GOLDEN_CASES) {
      const first = generateCase(goldenCase).snippets.map(
        (snippet) => snippet.code,
      );
      const second = generateCase(goldenCase).snippets.map(
        (snippet) => snippet.code,
      );
      expect(second).toEqual(first);
    }
  });

  it("never embeds a credential-looking value", () => {
    const canaries = ["hunter2", "sk_live_", "eyJhbGci", "AKIA", "Bearer ey"];
    for (const goldenCase of GOLDEN_CASES) {
      for (const snippet of generateCase(goldenCase).snippets) {
        for (const canary of canaries)
          expect(snippet.code).not.toContain(canary);
      }
    }
  });
});
