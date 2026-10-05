import { readFileSync } from "node:fs";
import path from "node:path";

import { parseContentArtifact, parseNavigationArtifact } from "@specra/content";
import { parseDocumentationArtifact } from "@specra/model";
import { describe, expect, it } from "vitest";

import { parseSearchArtifact, serializeSearchArtifact } from "./artifact.js";
import { createSearchClient, highlight } from "./client.js";
import { diversify, rankHits } from "./engine.js";
import { buildSearch, buildSearchIndex } from "./index.js";
import { blockText, projectSearchDocuments } from "./project.js";
import {
  boundedText,
  normalizeTerm,
  queryTerms,
  tokenize,
} from "./tokenize.js";
import { QUERY_LIMITS, type SearchDocument } from "./types.js";

/**
 * Search core (SPEC-007 §119–122): tokenization, projection, ranking,
 * diversity, limits, artifact validation, and determinism, against the
 * committed TestInbox artifacts and small synthetic inputs.
 */

const fixture = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "reader",
  "testinbox",
  ".specra",
  "artifacts",
);
const read = (name: string) => readFileSync(path.join(fixture, name), "utf8");
const input = {
  artifact: parseDocumentationArtifact(read("documentation.json")),
  navigation: parseNavigationArtifact(read("navigation.json")),
  pages: parseContentArtifact(read("content.json")).pages,
};

describe("tokenization", () => {
  it("splits API-shaped text into parts and joined identifiers", () => {
    expect(tokenize("POST /v1/inboxes/{inboxId}")).toEqual([
      "post",
      "v1",
      "inboxes",
      "inbox",
      "id",
      "inboxid",
    ]);
    expect(tokenize("inbox_id inbox-id InboxID expiresAt")).toEqual([
      "inbox",
      "id",
      "inbox",
      "id",
      "inbox",
      "id",
      "inboxid",
      "expires",
      "at",
      "expiresat",
    ]);
    expect(tokenize("application/json create-inbox HTTPServer")).toEqual([
      "application",
      "json",
      "create",
      "inbox",
      "http",
      "server",
      "httpserver",
    ]);
  });

  it("normalizes Unicode for matching without depending on the locale", () => {
    expect(normalizeTerm("Création")).toBe("creation");
    expect(normalizeTerm("RÉPONSE")).toBe("reponse");
    expect(tokenize("authentification création réponse")).toEqual([
      "authentification",
      "creation",
      "reponse",
    ]);
    // Full-width and composed forms fold to the same terms.
    expect(tokenize("ＡＰＩ ｋｅｙ")).toEqual(["api", "key"]);
    expect(tokenize("é é")).toEqual(["e", "e"]);
    // Non-Latin scripts are preserved, not dropped.
    expect(tokenize("認証 トークン")).toEqual(["認証", "トークン"]);
    // Case folding is plain lower-casing: ß has no lower-case mapping.
    expect(tokenize("Straße")).toEqual(["straße"]);
  });

  it("bounds tokens and queries", () => {
    expect(tokenize("x".repeat(500))[0]?.length).toBe(64);
    expect(tokenize("a ".repeat(10_000)).length).toBe(5_000);
    const terms = queryTerms("inbox ".repeat(30), QUERY_LIMITS);
    expect(terms).toEqual(["inbox"]);
    expect(
      queryTerms(
        Array.from({ length: 30 }, (_, index) => `t${index}`).join(" "),
        QUERY_LIMITS,
      ),
    ).toHaveLength(QUERY_LIMITS.maxTerms);
    expect(queryTerms("", QUERY_LIMITS)).toEqual([]);
    expect(queryTerms("   ---   ", QUERY_LIMITS)).toEqual([]);
    expect(boundedText("  a   b\n c  ", 10)).toBe("a b c");
    expect(boundedText("word ".repeat(20), 24).endsWith("…")).toBe(true);
  });
});

describe("projection", () => {
  const projection = projectSearchDocuments(input);

  it("emits pages, sections, groups, and operations in reading order with stable ids", () => {
    const kinds = projection.documents.map((document) => document.kind);
    expect(
      projection.documents.every((document, index) => document.id === index),
    ).toBe(true);
    expect(projection.records.map((record) => record.id)).toEqual(
      projection.documents.map((document) => document.id),
    );
    expect(kinds[0]).toBe("page");
    expect(projection.documents[0]?.route).toBe("/");
    expect(projection.documents[0]?.context).toEqual(["Guides"]);
    // Sections carry the page as subtitle and link to the heading anchor.
    const bearer = projection.documents.find(
      (document) => document.route === "/docs/authentication#bearer-tokens",
    );
    expect(bearer).toMatchObject({
      context: ["Guides", "Getting started"],
      group: "/docs/authentication",
      kind: "section",
      subtitle: "Authentication",
      title: "Bearer tokens",
    });
    expect(bearer?.excerpt.length).toBeGreaterThan(10);
    expect(bearer?.excerpt.length).toBeLessThanOrEqual(240);
    // The API block sits where the navigation places it, then the trailing section.
    const apiStart = kinds.indexOf("group");
    const resourcesPage = projection.documents.findIndex(
      (document) => document.route === "/docs/troubleshooting",
    );
    expect(apiStart).toBeGreaterThan(0);
    expect(resourcesPage).toBeGreaterThan(apiStart);
    // No service documents for a single-service project; no schema or SDK kinds.
    expect(kinds).not.toContain("service");
    expect(new Set(kinds)).toEqual(
      new Set(["group", "operation", "page", "section"]),
    );
    const create = projection.documents.find(
      (document) => document.route === "/api/inboxes/create-inbox",
    );
    expect(create).toMatchObject({
      context: ["API reference", "Inboxes"],
      group: "/api/inboxes",
      kind: "operation",
      method: "POST",
      path: "/inboxes",
      subtitle: "POST /inboxes",
      title: "Create inbox",
    });
    const createRecord = projection.records[create?.id ?? -1];
    expect(createRecord?.identifiers).toContain("createInbox");
    expect(createRecord?.identifiers).toContain("ttl");
    expect(createRecord?.identifiers).toContain("expiresAt");
    expect(createRecord?.identifiers.split(" ").length).toBeLessThanOrEqual(64);
    // Deprecated operations are flagged for the palette.
    expect(
      projection.documents.find((document) => document.deprecated === true)
        ?.title,
    ).toBe("Mark message read");
  });

  it("indexes prose, inline code, titles, and one-line commands but not code bodies", () => {
    expect(
      blockText({
        kind: "code",
        language: "bash",
        lines: [],
        value: "npm install @testinbox/client",
      }),
    ).toContain("npm install @testinbox/client");
    expect(
      blockText({
        kind: "code",
        language: "typescript",
        lines: [],
        title: "signup.test.ts",
        value: "const a = 1;\nconst b = 2;",
      }),
    ).toBe("signup.test.ts ");
    const quickstart = projection.records.find((record) =>
      record.title.startsWith("Quickstart"),
    );
    // The multi-line Python sample is excluded; one-line commands are kept.
    expect(quickstart?.body).not.toContain("os.environ");
    expect(quickstart?.body).toContain("client.inboxes.create({ ttl: 600 })");
    expect(quickstart?.body).toContain("wait()");
    // Hostile text stays text in the index and the excerpt.
    const troubleshooting = projection.documents.find(
      (document) =>
        document.route === "/docs/troubleshooting#reading-raw-content-safely",
    );
    expect(troubleshooting?.excerpt).toContain("<script>alert(1)</script>");
  });

  it("projects an API-only project and a multi-service project", () => {
    const apiOnly = projectSearchDocuments({
      artifact: input.artifact,
      navigation: undefined,
      pages: [],
    });
    expect(apiOnly.documents[0]?.kind).toBe("group");
    expect(apiOnly.documents.some((document) => document.kind === "page")).toBe(
      false,
    );
    const multi = parseDocumentationArtifact(
      readFileSync(
        path.join(
          fixture,
          "..",
          "..",
          "..",
          "multi",
          ".specra",
          "artifacts",
          "documentation.json",
        ),
        "utf8",
      ),
    );
    const projected = projectSearchDocuments({
      artifact: multi,
      navigation: undefined,
      pages: [],
    });
    const services = projected.documents.filter(
      (document) => document.kind === "service",
    );
    expect(services.length).toBeGreaterThan(1);
    const operation = projected.documents.find(
      (document) => document.kind === "operation",
    );
    expect(operation?.context.length).toBe(3);
    expect(operation?.route.split("/").length).toBe(5);
  });
});

describe("index and artifact", () => {
  it("builds byte-identical artifacts for equal input and round-trips them", () => {
    const first = buildSearch(input);
    const second = buildSearch({
      artifact: parseDocumentationArtifact(read("documentation.json")),
      navigation: parseNavigationArtifact(read("navigation.json")),
      pages: parseContentArtifact(read("content.json")).pages,
    });
    expect(first.json).toBe(second.json);
    expect(first.json.endsWith("\n")).toBe(true);
    expect(first.statistics.documents).toBe(first.artifact.documents.length);
    expect(first.statistics.terms).toBeGreaterThan(100);
    const parsed = parseSearchArtifact(first.json);
    expect(serializeSearchArtifact(parsed)).toBe(first.json);
    expect(parsed.documents).toEqual(first.artifact.documents);
  });

  it("rejects malformed, incompatible, and hostile artifacts", () => {
    const { artifact } = buildSearch(input);
    const mutate = (change: (value: Record<string, unknown>) => void) => {
      const value = JSON.parse(serializeSearchArtifact(artifact)) as Record<
        string,
        unknown
      >;
      change(value);
      return () => parseSearchArtifact(JSON.stringify(value));
    };
    expect(() => parseSearchArtifact("{")).toThrow(/valid JSON/);
    expect(() => parseSearchArtifact("[]")).toThrow(/shape/);
    expect(mutate((value) => (value.searchVersion = 2))).toThrow(/version/);
    expect(mutate((value) => (value.engine = "lunr"))).toThrow(/engine/);
    expect(mutate((value) => (value.index = "x"))).toThrow(/index/);
    expect(mutate((value) => (value.extra = 1))).toThrow(/shape/);
    expect(
      mutate((value) => {
        (value.documents as Record<string, unknown>[])[0]!.route =
          "javascript:alert(1)";
      }),
    ).toThrow(/route/);
    expect(
      mutate((value) => {
        (value.documents as Record<string, unknown>[])[0]!.route =
          "//evil.example/x";
      }),
    ).toThrow(/route/);
    expect(
      mutate((value) => {
        (value.documents as Record<string, unknown>[])[0]!.route = "/theme";
      }),
    ).toThrow(/route/);
    expect(
      mutate((value) => {
        (value.documents as Record<string, unknown>[])[1]!.id = 5;
      }),
    ).toThrow(/position/);
    expect(
      mutate((value) => {
        (value.documents as Record<string, unknown>[])[0]!.kind = "sdk";
      }),
    ).toThrow(/kind/);
    expect(
      mutate((value) => {
        (value.documents as Record<string, unknown>[])[0]!.title = "x".repeat(
          3_000,
        );
      }),
    ).toThrow(/bounded/);
    // An own "__proto__" key (as JSON.parse creates it) is an unknown key.
    expect(() =>
      parseSearchArtifact(
        serializeSearchArtifact(artifact).replace(
          '"context"',
          '"__proto__":{"polluted":true},"context"',
        ),
      ),
    ).toThrow(/shape/);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("query engine", () => {
  const client = createSearchClient(buildSearch(input).artifact, () => 0);
  const titles = (query: string) =>
    client
      .search(query)
      .hits.map((hit) => `${hit.document.kind}:${hit.document.title}`);

  it("ranks exact endpoint and title matches first and keeps ordering deterministic", () => {
    expect(titles("create inbox")[0]).toBe("operation:Create inbox");
    expect(titles("POST /inboxes")[0]).toBe("operation:Create inbox");
    // A version prefix the contract does not use still lands on the endpoint.
    expect(titles("POST /v1/inboxes")[0]).toBe("operation:Create inbox");
    expect(titles("authentication")[0]).toBe("page:Authentication");
    expect(titles("bearer token")[0]).toBe("section:Bearer tokens");
    expect(titles("wait for email")[0]).toBe("page:Waiting for email");
    expect(
      titles("expiresAt")
        .slice(0, 3)
        .every((title) => title.startsWith("operation:")),
    ).toBe(true);
    expect(titles("npm install")[0]).toBe(
      "page:Email testing built for automation.",
    );
    const first = client.search("inbox");
    const second = client.search("inbox");
    expect(first.hits.map((hit) => hit.document.id)).toEqual(
      second.hits.map((hit) => hit.document.id),
    );
  });

  it("supports prefix and bounded fuzzy matching", () => {
    expect(titles("auth")[0]).toBe("page:Authentication");
    expect(titles("inbo").length).toBeGreaterThan(3);
    expect(titles("webh")[0]).toContain("webhook");
    expect(titles("authentcation")[0]).toBe("page:Authentication");
    expect(titles("attachements")[0]).toContain("ttachment");
    // Short terms never fuzz: "ib" does not become "id" matches.
    expect(client.search("zq").hits).toEqual([]);
  });

  it("matches accented content with unaccented queries", () => {
    const projection = projectSearchDocuments({
      artifact: input.artifact,
      navigation: undefined,
      pages: [
        {
          body: [
            {
              children: [{ kind: "text", value: "La création d'une réponse." }],
              kind: "paragraph",
            },
          ],
          headings: [],
          id: "guide",
          route: "/docs/guide",
          slug: "guide",
          sourcePath: "docs/guide.md",
          text: "",
          title: "Authentification",
        },
      ],
    });
    const local = createSearchClient(
      buildSearchIndex(projection).artifact,
      () => 0,
    );
    expect(local.search("authentification").hits[0]?.document.title).toBe(
      "Authentification",
    );
    expect(local.search("creation reponse").hits[0]?.document.title).toBe(
      "Authentification",
    );
    // Display text keeps its accents; only matching is normalized.
    expect(local.search("creation").hits[0]?.document.excerpt).toContain(
      "création",
    );
  });

  it("bounds results, diversifies pages, and survives hostile queries", () => {
    const response = client.search("inbox message");
    expect(response.hits.length).toBeLessThanOrEqual(QUERY_LIMITS.maxResults);
    const perGroup = new Map<string, number>();
    for (const hit of response.hits) {
      perGroup.set(
        hit.document.group,
        (perGroup.get(hit.document.group) ?? 0) + 1,
      );
    }
    expect(Math.max(...perGroup.values())).toBeLessThanOrEqual(
      QUERY_LIMITS.maxPerGroup,
    );
    for (const query of [
      "__proto__",
      "constructor",
      "prototype",
      "<script>alert(1)</script>",
      "x".repeat(50_000),
      " ‮​",
      "(((((((((",
      "*".repeat(300),
      "a".repeat(64) + "b".repeat(64),
      "🔥🔥🔥",
    ]) {
      const started = performance.now();
      const result = client.search(query);
      expect(performance.now() - started).toBeLessThan(200);
      expect(Array.isArray(result.hits)).toBe(true);
      expect(result.query).toBe(query);
    }
    const hostile = client
      .search("<script>")
      .hits.find(
        (hit) =>
          hit.document.route ===
          "/docs/troubleshooting#reading-raw-content-safely",
      );
    expect(hostile?.document.excerpt).toContain("<script>alert(1)</script>");
  });

  it("highlights matched terms as plain segments", () => {
    expect(highlight("Create inbox", ["create"])).toEqual([
      { match: true, text: "Create" },
      { match: false, text: " inbox" },
    ]);
    expect(highlight("POST /v1/inboxes", ["inbox"])).toEqual([
      { match: false, text: "POST /v1/" },
      { match: true, text: "inboxes" },
    ]);
    expect(highlight("<script>alert(1)</script>", ["script"])).toEqual([
      { match: false, text: "<" },
      { match: true, text: "script" },
      { match: false, text: ">alert(1)</" },
      { match: true, text: "script" },
      { match: false, text: ">" },
    ]);
    expect(highlight("expiresAt", ["expires"])).toEqual([
      { match: true, text: "expiresAt" },
    ]);
    expect(highlight("", ["x"])).toEqual([{ match: false, text: "" }]);
  });

  it("tie-breaks by kind priority and reading order", () => {
    const documents: SearchDocument[] = [
      {
        context: [],
        excerpt: "",
        group: "a",
        id: 0,
        kind: "section",
        route: "/docs/a#x",
        title: "A",
      },
      {
        context: [],
        excerpt: "",
        group: "b",
        id: 1,
        kind: "operation",
        route: "/api/b/c",
        title: "B",
      },
      {
        context: [],
        excerpt: "",
        group: "c",
        id: 2,
        kind: "page",
        route: "/docs/c",
        title: "C",
      },
    ];
    const hits = [0, 1, 2].map((id) => ({
      id,
      match: {},
      queryTerms: [],
      score: 1.00001,
      terms: [],
    }));
    expect(rankHits(hits, documents).map((hit) => hit.id)).toEqual([1, 2, 0]);
    const many = Array.from({ length: 10 }, (_, id) => ({
      id,
      match: {},
      queryTerms: [],
      score: 10 - id,
      terms: [],
    }));
    const grouped = many.map((hit) => ({
      ...documents[0]!,
      group: hit.id < 6 ? "same" : `g${hit.id}`,
      id: hit.id,
    }));
    expect(
      diversify(rankHits(many, grouped), grouped, {
        maxPerGroup: 3,
        maxResults: 5,
      }).map((hit) => hit.id),
    ).toEqual([0, 1, 2, 6, 7]);
  });

  it("never throws on arbitrary bounded query text (seeded fuzz)", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const alphabet = [
      "a",
      "e",
      "i",
      "n",
      "s",
      "t",
      "x",
      "0",
      "9",
      " ",
      "/",
      "{",
      "}",
      "_",
      "-",
      ".",
      "*",
      "\\",
      "(",
      "[",
      "é",
      "ß",
      "日",
      "ك",
      "‮",
      " ",
      "🙂",
      "<",
      ">",
      "&",
      "'",
      '"',
    ];
    for (let round = 0; round < 300; round += 1) {
      const length = Math.floor(random() * 80);
      let query = "";
      for (let index = 0; index < length; index += 1) {
        query += alphabet[Math.floor(random() * alphabet.length)];
      }
      const result = client.search(query);
      expect(result.hits.length).toBeLessThanOrEqual(QUERY_LIMITS.maxResults);
      for (const hit of result.hits) {
        expect(hit.document.route.startsWith("/")).toBe(true);
        expect(hit.title.map((segment) => segment.text).join("")).toBe(
          hit.document.title,
        );
      }
    }
  });
});
