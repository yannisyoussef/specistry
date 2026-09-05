import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseDocumentationArtifact,
  type DocumentationArtifact,
  type Operation,
} from "@specra/model";
import { describe, expect, it } from "vitest";

import {
  groupMetadata,
  homeMetadata,
  indexablePaths,
  operationMetadata,
  referenceMetadata,
  serviceMetadata,
  siteUrl,
  summarize,
} from "../../apps/web/lib/reader/metadata";
import {
  createOperationView,
  orderResponses,
} from "../../apps/web/lib/reader/operation-view";
import {
  createReaderIndex,
  listOperations,
  resolveRoute,
  type ReaderIndex,
} from "../../apps/web/lib/reader/projection";
import {
  identifierSlug,
  methodPathSlug,
  slugify,
  uniqueSlugs,
} from "../../apps/web/lib/reader/slug";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/reader/", import.meta.url),
);

function loadArtifact(name: string): DocumentationArtifact {
  return parseDocumentationArtifact(
    readFileSync(
      path.join(
        fixtureRoot,
        name,
        ".specra",
        "artifacts",
        "documentation.json",
      ),
      "utf8",
    ),
  );
}

const testinbox = loadArtifact("testinbox");
const edge = loadArtifact("edge");
const multi = loadArtifact("multi");

function operationTarget(
  index: ReaderIndex,
  artifact: DocumentationArtifact,
  segments: readonly string[],
) {
  const target = resolveRoute(index, artifact, segments);
  if (target?.kind !== "operation")
    throw new Error(`expected operation at ${segments.join("/")}`);
  return createOperationView(target);
}

describe("slug rules", () => {
  it("derives stable ASCII slugs from identifiers, names, and method/path pairs", () => {
    expect(identifierSlug("createInbox")).toBe("create-inbox");
    expect(identifierSlug("HTTPServerStats")).toBe("http-server-stats");
    expect(identifierSlug("inboxes.list_v2")).toBe("inboxes-list-v2");
    expect(slugify("Inbox rules")).toBe("inbox-rules");
    expect(slugify("Crème brûlée & co.")).toBe("creme-brulee-co");
    expect(slugify("<script>")).toBe("script");
    expect(slugify("   ", "fallback")).toBe("fallback");
    expect(slugify("x".repeat(200))).toHaveLength(80);
    expect(methodPathSlug("GET", "/v1/inboxes/{inboxId}/messages")).toBe(
      "get-v1-inboxes-inboxid-messages",
    );
    expect(uniqueSlugs(["a", "a", "a-2", "a"])).toEqual([
      "a",
      "a-2",
      "a-2-2",
      "a-3",
    ]);
  });
});

describe("reader index", () => {
  const index = createReaderIndex(testinbox);

  it("projects the TestInbox artifact into a single-service route tree", () => {
    expect(index.singleService).toBe(true);
    expect(index.operationCount).toBe(25);
    expect(index.project.name).toBe("TestInbox");
    expect(
      index.services.map((service) => [service.slug, service.href]),
    ).toEqual([["testinbox-api", "/api"]]);
    const service = index.services[0];
    expect(
      service?.groups.map((group) => [
        group.slug,
        group.name,
        group.operations.length,
      ]),
    ).toEqual([
      ["attachments", "Attachments", 2],
      ["domains", "Domains", 4],
      ["inboxes", "Inboxes", 7],
      ["messages", "Messages", 6],
      ["team", "Team", 2],
      ["webhooks", "Webhooks", 4],
    ]);
  });

  it("orders operations by path then method and derives slugs from operationId or method/path", () => {
    const inboxes = index.services[0]?.groups.find(
      (group) => group.slug === "inboxes",
    );
    expect(
      inboxes?.operations.map(
        (operation) =>
          `${operation.method} ${operation.path} → ${operation.slug}`,
      ),
    ).toEqual([
      "GET /inboxes → list-inboxes",
      "POST /inboxes → create-inbox",
      "GET /inboxes/{inboxId} → get-inbox",
      "PATCH /inboxes/{inboxId} → update-inbox",
      "DELETE /inboxes/{inboxId} → delete-inbox",
      "GET /inboxes/{inboxId}/stats → get-inboxes-inboxid-stats",
      "POST /inboxes/{inboxId}/wait → wait-for-message",
    ]);
    expect(
      inboxes?.operations.every((operation) =>
        operation.href.startsWith("/api/inboxes/"),
      ),
    ).toBe(true);
  });

  it("lists multi-tag operations under every tag but routes them once", () => {
    const service = index.services[0];
    const messages = service?.groups.find((group) => group.slug === "messages");
    const inboxes = service?.groups.find((group) => group.slug === "inboxes");
    const wait = listOperations(index).find(
      (operation) => operation.slug === "wait-for-message",
    );
    expect(wait?.groupSlug).toBe("inboxes");
    expect(wait?.href).toBe("/api/inboxes/wait-for-message");
    expect(
      inboxes?.operations.some((operation) => operation.id === wait?.id),
    ).toBe(true);
    expect(
      messages?.operations.some((operation) => operation.id === wait?.id),
    ).toBe(false);
    expect(
      messages?.listed.some((operation) => operation.id === wait?.id),
    ).toBe(true);
    expect(listOperations(index).map((operation) => operation.href)).toEqual([
      ...new Set(listOperations(index).map((operation) => operation.href)),
    ]);
  });

  it("resolves routes and rejects unsafe or unknown segments", () => {
    expect(resolveRoute(index, testinbox, ["inboxes"])?.kind).toBe("group");
    expect(
      resolveRoute(index, testinbox, ["inboxes", "create-inbox"])?.kind,
    ).toBe("operation");
    expect(resolveRoute(index, testinbox, [])).toBeUndefined();
    expect(
      resolveRoute(index, testinbox, ["openapi", "inboxes"]),
    ).toBeUndefined();
    expect(
      resolveRoute(index, testinbox, ["inboxes", "create-inbox", "extra"]),
    ).toBeUndefined();
    expect(resolveRoute(index, testinbox, ["Inboxes"])).toBeUndefined();
    expect(resolveRoute(index, testinbox, ["../inboxes"])).toBeUndefined();
    expect(
      resolveRoute(index, testinbox, ["inboxes", "__proto__"]),
    ).toBeUndefined();
    expect(resolveRoute(index, testinbox, ["a".repeat(101)])).toBeUndefined();
  });

  it("is deterministic across repeated projections", () => {
    expect(JSON.stringify(createReaderIndex(testinbox))).toBe(
      JSON.stringify(index),
    );
    expect(indexablePaths(index)).toEqual(
      indexablePaths(createReaderIndex(testinbox)),
    );
    expect(indexablePaths(index).slice(0, 5)).toEqual([
      "/",
      "/api",
      "/api/attachments",
      "/api/attachments/list-attachments",
      "/api/attachments/download-attachment",
    ]);
    expect(indexablePaths(index)).toHaveLength(2 + 6 + 25);
  });
});

describe("edge artifact", () => {
  const index = createReaderIndex(edge);

  it("resolves group and operation slug collisions deterministically", () => {
    const groups = index.services[0]?.groups.map((group) => [
      group.name,
      group.slug,
    ]);
    expect(groups).toEqual([
      ["Collisions", "collisions"],
      ["Inbox rules", "inbox-rules"],
      ["inbox-rules", "inbox-rules-2"],
      ["Operations", "operations"],
    ]);
    const collisions = index.services[0]?.groups[0];
    expect(collisions?.operations.map((operation) => operation.slug)).toEqual([
      "get-item",
      "get-item-2",
    ]);
  });

  it("routes untagged operations under the Operations group with method/path slugs", () => {
    const operations = index.services[0]?.groups.find(
      (group) => group.slug === "operations",
    );
    expect(operations?.operations.map((operation) => operation.slug)).toContain(
      "options-plain",
    );
    expect(operations?.operations.map((operation) => operation.slug)).toContain(
      "plain-operation",
    );
    const long = operations?.operations.find((operation) =>
      operation.slug.startsWith("extremely-long-path-operation-name"),
    );
    expect(long?.slug).toBe(
      identifierSlug(
        "extremelyLongPathOperationNameThatShouldWrapGracefullyOnNarrowViewports",
      ),
    );
    expect(long?.slug.length).toBeLessThanOrEqual(80);
  });

  it("orders responses by numeric code, then range, then default", () => {
    const view = operationTarget(index, edge, ["operations", "many-responses"]);
    expect(view.responses.map((response) => response.statusLabel)).toEqual([
      "102",
      "200",
      "204",
      "301",
      "404",
      "500",
      "1XX",
      "2XX",
      "5XX",
      "default",
    ]);
    expect(view.responses.map((response) => response.tone)).toEqual([
      "info",
      "success",
      "success",
      "info",
      "warning",
      "danger",
      "info",
      "success",
      "danger",
      "neutral",
    ]);
    expect(
      view.responses.find((response) => response.statusLabel === "204")?.media,
    ).toEqual([]);
    expect(orderResponses([]).length).toBe(0);
  });

  it("keeps hostile strings as plain data in the view", () => {
    const view = operationTarget(index, edge, ["operations", "legacy-lookup"]);
    expect(view.deprecated).toBe(true);
    expect(view.title).toContain("<b>bold?</b>");
    expect(view.description).toContain("<script>alert(1)</script>");
    expect(view.servers.map((server) => server.url)).toContain(
      "javascript:alert(1)",
    );
    expect(index.services[0]?.description).toContain(
      "<img src=x onerror=alert(1)>",
    );
    expect(homeMetadata(index).description).toContain("Reader edge cases.");
  });

  it("groups many parameters by location in canonical order", () => {
    const view = operationTarget(index, edge, [
      "operations",
      identifierSlug(
        "extremelyLongPathOperationNameThatShouldWrapGracefullyOnNarrowViewports",
      ),
    ]);
    expect(
      view.parameterGroups.map((group) => [group.location, group.rows.length]),
    ).toEqual([
      ["path", 3],
      ["query", 8],
      ["header", 2],
      ["cookie", 1],
    ]);
    const query = view.parameterGroups[1];
    expect(query?.rows.find((row) => row.name === "p7")?.deprecated).toBe(true);
    expect(query?.rows.find((row) => row.name === "p8")).toMatchObject({
      constraints: "one of alpha, beta, gamma",
      required: true,
      type: "string · enum",
    });
    expect(query?.rows.find((row) => row.name === "p6")?.type).toBe(
      "array of string",
    );
  });

  it("preserves OR-of-AND security semantics including anonymous access", () => {
    const view = operationTarget(index, edge, [
      "operations",
      "auth-alternatives",
    ]);
    expect(
      view.security?.map((alternative) =>
        alternative.schemes.map((scheme) => scheme.label),
      ),
    ).toEqual([
      ["API key (apiKey)", "Mutual TLS (mtls)"],
      ["Bearer token (bearer)"],
      [],
    ]);
    expect(view.requestBody?.media.map((media) => media.mediaType)).toEqual([
      "application/json",
      "multipart/form-data",
      "text/plain",
    ]);
    expect(view.requestBody?.media[0]?.anchor).toBe(
      "request-body-application-json",
    );
  });

  it("summarizes every schema shape without inventing structure", () => {
    const view = operationTarget(index, edge, ["operations", "schema-shapes"]);
    const schema = view.responses[0]?.media[0]?.schema;
    const types = Object.fromEntries(
      (schema?.properties ?? []).map((property) => [
        property.name,
        property.type,
      ]),
    );
    expect(types).toEqual({
      anyValue: "any",
      choice: "one of: object, string",
      choices: "string · enum",
      constant: "constant",
      deep: "object",
      map: "object",
      merged: "object",
      negated: "not string",
      never: "never",
      tuple: "tuple of 2 items",
      typeless: "string",
      union: "any of: string, integer, null",
      unsupported: "object",
    });
    expect(
      schema?.properties?.find((property) => property.name === "deep")?.nested,
    ).toBe(true);
    expect(
      schema?.properties?.find((property) => property.name === "choices")
        ?.constraints,
    ).toBe("one of a, b, c");
    const recursive = operationTarget(index, edge, [
      "operations",
      "auth-alternatives",
    ]);
    const node = recursive.requestBody?.media[0]?.schema;
    // Model v1 carries no component names, so references read as their shape;
    // naming references is tracked for SPEC-005 alongside the schema renderer.
    expect(node?.type).toBe("object");
    expect(node?.description).toBe("Recursive node.");
    expect(
      node?.properties?.map((property) => [
        property.name,
        property.type,
        property.nested,
      ]),
    ).toEqual([
      ["value", "string", false],
      ["children", "array of object", true],
      ["parent", "object", true],
    ]);
  });
});

describe("multi-service artifact", () => {
  const index = createReaderIndex(multi);

  it("prefixes every route with the service slug and keeps same-named groups apart", () => {
    expect(index.singleService).toBe(false);
    expect(index.operationCount).toBe(10);
    expect(
      index.services.map((service) => [
        service.slug,
        service.href,
        service.operationCount,
      ]),
    ).toEqual([
      ["accounts-api", "/api/accounts-api", 6],
      ["billing-api", "/api/billing-api", 4],
    ]);
    expect(
      index.services.map((service) =>
        service.groups.map((group) => group.href),
      ),
    ).toEqual([
      [
        "/api/accounts-api/keys",
        "/api/accounts-api/users",
        "/api/accounts-api/operations",
      ],
      [
        "/api/billing-api/invoices",
        "/api/billing-api/users",
        "/api/billing-api/operations",
      ],
    ]);
    // `listUsers` exists in both documents; each keeps its own route.
    expect(
      listOperations(index)
        .filter((operation) => operation.slug === "list-users")
        .map((operation) => operation.href),
    ).toEqual([
      "/api/accounts-api/users/list-users",
      "/api/billing-api/users/list-users",
    ]);
  });

  it("resolves service, group, and operation routes and rejects cross-service mixes", () => {
    expect(resolveRoute(index, multi, ["billing-api"])?.kind).toBe("service");
    expect(resolveRoute(index, multi, ["billing-api", "users"])?.kind).toBe(
      "group",
    );
    const target = resolveRoute(index, multi, [
      "billing-api",
      "users",
      "list-users",
    ]);
    expect(target?.kind).toBe("operation");
    if (target?.kind !== "operation") throw new Error("operation");
    expect(target.summary.title).toBe("List billing contacts");
    expect(target.service.name).toBe("Billing API");
    // Single-service shapes and mixed service/group pairs are not routes.
    expect(resolveRoute(index, multi, ["users"])).toBeUndefined();
    expect(resolveRoute(index, multi, ["users", "list-users"])).toBeUndefined();
    expect(
      resolveRoute(index, multi, ["accounts-api", "invoices"]),
    ).toBeUndefined();
    expect(
      resolveRoute(index, multi, ["accounts-api", "users", "get-invoice"]),
    ).toBeUndefined();
  });

  it("produces unique titles and indexable paths across services", () => {
    const titles = index.services.flatMap((service) => [
      serviceMetadata(index, service).title,
      ...service.groups.flatMap((group) => [
        groupMetadata(index, service, group).title,
        ...group.operations.map(
          (operation) =>
            operationMetadata(index, service, operation, undefined).title,
        ),
      ]),
    ]);
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toContain("Users | Accounts API | Acme Platform API");
    expect(titles).toContain("Users | Billing API | Acme Platform API");
    const paths = indexablePaths(index);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/api/accounts-api");
    expect(paths).toContain("/api/billing-api/users/list-users");
    expect(paths).toHaveLength(2 + 2 + 6 + 10);
  });
});

describe("operation view", () => {
  const index = createReaderIndex(testinbox);

  it("renders the create-inbox operation with bodies, headers, and constraints", () => {
    const view = operationTarget(index, testinbox, ["inboxes", "create-inbox"]);
    expect(view.title).toBe("Create inbox");
    expect(view.contractId).toBe("createInbox");
    expect(view.parameterGroups.map((group) => group.anchor)).toEqual([
      "parameters-header",
    ]);
    expect(view.requestBody).toMatchObject({
      anchor: "request-body",
      required: true,
    });
    expect(view.requestBody?.media.map((media) => media.mediaType)).toEqual([
      "application/json",
      "application/x-www-form-urlencoded",
    ]);
    const ttl = view.requestBody?.media[0]?.schema?.properties?.find(
      (property) => property.name === "ttl",
    );
    expect(ttl).toMatchObject({
      constraints: "default 3600 · min 60 · max 86400",
      required: false,
      type: "integer",
    });
    expect(
      view.responses.map((response) => [
        response.statusLabel,
        response.statusText,
      ]),
    ).toEqual([
      ["201", "Created"],
      ["400", "Bad Request"],
      ["409", "Conflict"],
      ["429", "Too Many Requests"],
    ]);
    expect(
      view.responses[0]?.headers.map((header) => [header.name, header.type]),
    ).toEqual([["Location", "string · uri"]]);
    expect(view.responses[0]?.media[0]?.examples).toHaveLength(1);
    expect(view.responses[0]?.media[0]?.examples[0]?.truncated).toBe(false);
    expect(
      view.security?.map((alternative) =>
        alternative.schemes.map((scheme) => scheme.key),
      ),
    ).toEqual([["apiKey"], ["bearer"]]);
    expect(view.servers.map((server) => server.label)).toEqual([
      "Production",
      "Sandbox (mail never leaves the sandbox)",
    ]);
  });

  it("represents scoped OAuth requirements and body-less responses", () => {
    const view = operationTarget(index, testinbox, [
      "webhooks",
      "create-webhook",
    ]);
    expect(view.security?.[0]?.schemes.map((scheme) => scheme.label)).toEqual([
      "API key (apiKey)",
      "Mutual TLS (mtls)",
    ]);
    expect(view.security?.[1]?.schemes[0]).toMatchObject({
      detail: "OAuth 2.0 · authorization code",
      scopes: ["webhooks:write"],
    });
    const remove = operationTarget(index, testinbox, [
      "webhooks",
      "delete-webhook",
    ]);
    expect(remove.responses[0]).toMatchObject({
      media: [],
      statusLabel: "204",
      statusText: "No Content",
    });
    const upload = operationTarget(index, testinbox, [
      "domains",
      "upload-domain-logo",
    ]);
    expect(upload.requestBody?.media[0]?.encodings).toEqual([
      { detail: "image/png, image/svg+xml", propertyName: "file" },
    ]);
    const cookie = operationTarget(index, testinbox, [
      "team",
      "list-team-members",
    ]);
    expect(cookie.parameterGroups.map((group) => group.location)).toEqual([
      "cookie",
    ]);
    expect(cookie.responses.at(-1)?.statusLabel).toBe("default");
  });
});

describe("metadata", () => {
  const index = createReaderIndex(testinbox);

  it("produces unique titles and bounded descriptions for every route", () => {
    const service = index.services[0];
    if (service === undefined) throw new Error("service");
    const titles = [
      homeMetadata(index).title,
      referenceMetadata(index).title,
      ...service.groups.flatMap((group) => [
        groupMetadata(index, service, group).title,
        ...group.operations.map(
          (operation) =>
            operationMetadata(index, service, operation, undefined).title,
        ),
      ]),
    ];
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles).toContain("Create inbox | TestInbox API");
    expect(titles).toContain("Inboxes | TestInbox API");
    const target = resolveRoute(index, testinbox, ["inboxes", "create-inbox"]);
    const description =
      target?.kind === "operation" ? target.operation.description : undefined;
    expect(
      operationMetadata(index, service, listOperations(index)[0]!, description)
        .description,
    ).toBe("Creates a disposable inbox that can immediately receive email.");
    for (const title of titles) expect(title.length).toBeLessThan(120);
  });

  it("summarizes text to one sentence of at most 160 characters", () => {
    expect(summarize("Short.")).toBe("Short.");
    expect(
      summarize("  Collapses   whitespace\nand breaks. Second sentence.  "),
    ).toBe("Collapses whitespace and breaks.");
    const long = summarize(`${"word ".repeat(60)}end`);
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("…")).toBe(true);
  });

  it("derives the site origin only from trusted absolute http(s) values", () => {
    expect(siteUrl(index, {})).toBeUndefined();
    expect(
      siteUrl(index, { SPECRA_SITE_URL: "https://docs.example.test" })?.href,
    ).toBe("https://docs.example.test/");
    // Only an origin is accepted: paths, queries, and credentials are rejected.
    expect(
      siteUrl(index, { SPECRA_SITE_URL: "https://docs.example.test/base" }),
    ).toBeUndefined();
    expect(
      siteUrl(index, { SPECRA_SITE_URL: "https://user:pw@docs.example.test" }),
    ).toBeUndefined();
    expect(
      siteUrl(index, { SPECRA_SITE_URL: "javascript:alert(1)" }),
    ).toBeUndefined();
    expect(siteUrl(index, { SPECRA_SITE_URL: "not a url" })).toBeUndefined();
  });
});

describe("large navigation", () => {
  it("projects thousands of operations in linear time with stable output", () => {
    const large = syntheticArtifact(2_000, 40);
    const started = performance.now();
    const index = createReaderIndex(large);
    const elapsed = performance.now() - started;
    expect(index.operationCount).toBe(2_000);
    expect(index.services[0]?.groups).toHaveLength(40);
    expect(listOperations(index)).toHaveLength(2_000);
    expect(
      new Set(listOperations(index).map((operation) => operation.href)).size,
    ).toBe(2_000);
    expect(elapsed).toBeLessThan(2_000);
    expect(JSON.stringify(createReaderIndex(large))).toBe(
      JSON.stringify(index),
    );
  });
});

function syntheticArtifact(
  count: number,
  groups: number,
): DocumentationArtifact {
  const base = testinbox.model.versions[0]?.services[0];
  if (base === undefined) throw new Error("base service");
  const operations: Operation[] = Array.from({ length: count }, (_, i) => ({
    deprecated: i % 17 === 0,
    extensions: {},
    id: `op${i}` as Operation["id"],
    method: (["GET", "POST", "PUT", "DELETE"] as const)[i % 4] ?? "GET",
    parameters: [],
    path: `/resources/${Math.floor(i / 4)}`,
    responses: [
      {
        bodies: [],
        description: "ok",
        headers: [],
        status: { code: 200, kind: "code" },
      },
    ],
    security: [],
    serverIds: [],
    tags: [`Group ${i % groups}`],
    title: `Operation ${i}`,
  }));
  return {
    diagnostics: [],
    model: {
      ...testinbox.model,
      versions: [
        {
          ...testinbox.model.versions[0]!,
          services: [{ ...base, operations }],
        },
      ],
    },
  };
}
