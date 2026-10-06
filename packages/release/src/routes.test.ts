import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseContentArtifact,
  parseNavigationArtifact,
} from "@specistry/content";
import { parseDocumentationArtifact } from "@specistry/model";
import { describe, expect, it } from "vitest";

import {
  REDIRECT_MESSAGES,
  isInternalRedirectPath,
  parseRedirectTable,
  serializeRedirectTable,
  validateRedirects,
} from "./redirects.js";
import {
  deriveRouteTable,
  findCounterpart,
  findRoute,
  parseRouteTable,
  scopeRoute,
  serializeRouteTable,
  versionRoots,
} from "./routes.js";

/**
 * SPEC-010 §20, §56–§64, §116–§117, §128: the versioned route table and
 * the validated redirects over it. Every path stays under the release's
 * roots; sources cannot shadow routes; chains flatten; cycles fail; hostile
 * destinations never validate; validation stays near-linear at thousands
 * of entries.
 */

const fixture = fileURLToPath(
  new URL(
    "../../../tests/fixtures/reader/testinbox/.specistry/artifacts/",
    import.meta.url,
  ),
);
const artifact = parseDocumentationArtifact(
  readFileSync(`${fixture}documentation.json`, "utf8"),
);
const content = parseContentArtifact(
  readFileSync(`${fixture}content.json`, "utf8"),
);
const navigation = parseNavigationArtifact(
  readFileSync(`${fixture}navigation.json`, "utf8"),
);
const table = deriveRouteTable({
  artifact,
  changelog: true,
  content,
  navigation,
  version: "v1",
});

describe("route table", () => {
  it("derives versioned routes with semantic identities", () => {
    expect(table.routes[0]).toEqual({
      identity: "home",
      indexable: true,
      kind: "home",
      path: "/docs/v1",
    });
    expect(findRoute(table, "/docs/v1/authentication")).toEqual({
      identity: "page:authentication",
      indexable: true,
      kind: "page",
      path: "/docs/v1/authentication",
    });
    expect(findRoute(table, "/docs/v1/changelog")?.kind).toBe("changelog");
    expect(findRoute(table, "/api/v1")?.kind).toBe("api");
    const operation = findRoute(table, "/api/v1/inboxes/get-inbox");
    expect(operation).toEqual({
      identity: "operation:openapi.yaml~getInbox",
      indexable: true,
      kind: "operation",
      path: "/api/v1/inboxes/get-inbox",
    });
    expect(findRoute(table, "/api/v1/inboxes")?.identity).toBe(
      "group:openapi.yaml~Inboxes",
    );
    expect(
      table.routes.every(
        (route) =>
          route.path.startsWith("/docs/v1") || route.path.startsWith("/api/v1"),
      ),
    ).toBe(true);
    expect(new Set(table.routes.map((route) => route.path)).size).toBe(
      table.routes.length,
    );
  });

  it("finds counterparts by identity, never by path shape", () => {
    const other = deriveRouteTable({
      artifact,
      changelog: false,
      content,
      navigation,
      version: "2026-09",
    });
    expect(
      findCounterpart(other, "operation:openapi.yaml~getInbox")?.path,
    ).toBe("/api/2026-09/inboxes/get-inbox");
    expect(findCounterpart(other, "changelog")).toBeUndefined();
    expect(findCounterpart(other, "page:authentication")?.path).toBe(
      "/docs/2026-09/authentication",
    );
  });

  it("round-trips through the strict parser and rejects escapes", () => {
    const text = serializeRouteTable(table);
    expect(parseRouteTable(text)).toEqual(table);
    const tamper = (edit: (value: Record<string, unknown>) => void) => {
      const value = JSON.parse(text) as Record<string, unknown>;
      edit(value);
      return () => parseRouteTable(JSON.stringify(value));
    };
    expect(
      tamper((value) => {
        (value.routes as Record<string, unknown>[])[0]!.path = "/docs/v2";
      }),
    ).toThrow(/Route record/);
    expect(
      tamper((value) => {
        (value.routes as Record<string, unknown>[])[0]!.path =
          "https://evil.example";
      }),
    ).toThrow(/Route record/);
    expect(
      tamper((value) => {
        (value.routes as Record<string, unknown>[])[0]!.path = "/docs/v1/../v2";
      }),
    ).toThrow(/Route record/);
    expect(
      tamper((value) => {
        (value.routes as Record<string, unknown>[]).push({
          ...(value.routes as Record<string, unknown>[])[1]!,
        });
      }),
    ).toThrow(/duplicate/);
    expect(
      tamper((value) => {
        value.routesFormat = 3;
      }),
    ).toThrow(/unsupported/);
  });

  it("scopes unversioned artifact routes into the release", () => {
    const roots = versionRoots("v1");
    expect(scopeRoute("/", roots)).toBe("/docs/v1");
    expect(scopeRoute("/docs", roots)).toBe("/docs/v1");
    expect(scopeRoute("/docs/authentication#tokens", roots)).toBe(
      "/docs/v1/authentication#tokens",
    );
    expect(scopeRoute("/api", roots)).toBe("/api/v1");
    expect(scopeRoute("/api/inboxes/get-inbox", roots)).toBe(
      "/api/v1/inboxes/get-inbox",
    );
    expect(scopeRoute("https://status.example", roots)).toBe(
      "https://status.example",
    );
    expect(scopeRoute("#anchor", roots)).toBe("#anchor");
    expect(scopeRoute("mailto:a@b.c", roots)).toBe("mailto:a@b.c");
  });
});

describe("redirects", () => {
  it("validates, scopes, flattens chains, and sorts", () => {
    const { diagnostics, table: redirects } = validateRedirects(
      [
        { from: "/docs/old-auth", to: "/docs/authentication#tokens" },
        { from: "/docs/older-auth", to: "/docs/old-auth" },
        { from: "/api/inboxes/get-mailbox", to: "/api/inboxes/get-inbox" },
        { from: "/docs/home-old", to: "/" },
      ],
      table,
    );
    expect(diagnostics).toEqual([]);
    expect(redirects.entries).toEqual([
      {
        from: "/api/v1/inboxes/get-mailbox",
        status: 308,
        to: "/api/v1/inboxes/get-inbox",
      },
      { from: "/docs/v1/home-old", status: 308, to: "/docs/v1" },
      {
        from: "/docs/v1/old-auth",
        status: 308,
        to: "/docs/v1/authentication#tokens",
      },
      {
        from: "/docs/v1/older-auth",
        status: 308,
        to: "/docs/v1/authentication#tokens",
      },
    ]);
    const text = serializeRedirectTable(redirects);
    expect(parseRedirectTable(text)).toEqual(redirects);
  });

  it("reports invalid, duplicate, shadowing, missing, and cyclic entries by index", () => {
    const { diagnostics, table: redirects } = validateRedirects(
      [
        { from: "/docs/authentication", to: "/docs/quickstart" },
        { from: "/docs/a", to: "/docs/b" },
        { from: "/docs/b", to: "/docs/a" },
        { from: "/docs/c", to: "/docs/nowhere" },
        { from: "/docs/d", to: "/docs/quickstart" },
        { from: "/docs/d", to: "/docs/authentication" },
        { from: "https://evil.example/x", to: "/docs/quickstart" },
        { from: "/docs/e", to: "https://evil.example" },
      ],
      table,
    );
    expect(diagnostics).toEqual([
      { code: "REDIRECT_SOURCE_SHADOWS_ROUTE", index: 0 },
      { code: "REDIRECT_SOURCE_DUPLICATE", index: 5 },
      { code: "REDIRECT_SOURCE_INVALID", index: 6 },
      { code: "REDIRECT_DESTINATION_INVALID", index: 7 },
      { code: "REDIRECT_CYCLE", index: 1 },
      { code: "REDIRECT_CYCLE", index: 2 },
      { code: "REDIRECT_DESTINATION_NOT_FOUND", index: 3 },
    ]);
    expect(redirects.entries).toEqual([
      { from: "/docs/v1/d", status: 308, to: "/docs/v1/quickstart" },
    ]);
    for (const diagnostic of diagnostics)
      expect(REDIRECT_MESSAGES[diagnostic.code]).toBeTruthy();
  });

  it.each([
    "//evil.example",
    "/%2f%2fevil.example",
    "https:%2f%2fevil.example",
    "@evil.example",
    "\\evil.example",
    "/docs/x\\..\\y",
    "/docs/%0d%0aLocation:evil",
    "/docs/x\u0000",
    "/docs/x\u2028y",
    "/docs/x\u202ey",
    "/docs/../api",
    "/docs/./x",
    "/docs/x?y=1",
    "/docs/x#a b",
    "/docs/X",
    "javascript:alert(1)",
    "data:text/html,hi",
    "/other/x",
    "docs/x",
    "",
  ])("never accepts %j as a source or destination", (value) => {
    expect(isInternalRedirectPath(value, true)).toBe(false);
    const { diagnostics, table: redirects } = validateRedirects(
      [
        { from: value, to: "/docs/quickstart" },
        { from: "/docs/z", to: value },
      ],
      table,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code).sort()).toEqual([
      "REDIRECT_DESTINATION_INVALID",
      "REDIRECT_SOURCE_INVALID",
    ]);
    expect(redirects.entries).toEqual([]);
  });

  it("rejects a frozen table whose entries leave the release", () => {
    const text = serializeRedirectTable(
      validateRedirects([{ from: "/docs/old", to: "/docs/quickstart" }], table)
        .table,
    );
    const tamper = (edit: (entry: Record<string, unknown>) => void) => {
      const value = JSON.parse(text) as { entries: Record<string, unknown>[] };
      edit(value.entries[0]!);
      return () => parseRedirectTable(JSON.stringify(value));
    };
    expect(
      tamper((entry) => {
        entry.to = "/docs/v2/quickstart";
      }),
    ).toThrow(/invalid/);
    expect(
      tamper((entry) => {
        entry.to = "https://evil.example";
      }),
    ).toThrow(/invalid/);
    expect(
      tamper((entry) => {
        entry.status = 301;
      }),
    ).toThrow(/invalid/);
    expect(
      tamper((entry) => {
        entry.to = "/docs/v1/old";
      }),
    ).toThrow(/invalid/);
  });

  it("stays near-linear for thousands of chained redirects", () => {
    const inputs = Array.from({ length: 5_000 }, (_, index) => ({
      from: `/docs/legacy-${index}`,
      to: index === 4_999 ? "/docs/quickstart" : `/docs/legacy-${index + 1}`,
    }));
    const started = performance.now();
    const { diagnostics, table: redirects } = validateRedirects(inputs, table);
    const elapsed = performance.now() - started;
    expect(diagnostics).toEqual([]);
    expect(redirects.entries).toHaveLength(5_000);
    expect(
      redirects.entries.every((entry) => entry.to === "/docs/v1/quickstart"),
    ).toBe(true);
    expect(elapsed).toBeLessThan(2_000);
    const cyclic = inputs.map((input, index) =>
      index === 4_999 ? { ...input, to: "/docs/legacy-0" } : input,
    );
    const result = validateRedirects(cyclic, table);
    expect(result.diagnostics).toHaveLength(5_000);
    expect(
      result.diagnostics.every(
        (diagnostic) => diagnostic.code === "REDIRECT_CYCLE",
      ),
    ).toBe(true);
    expect(
      validateRedirects(
        Array.from({ length: 10_001 }, (_, index) => ({
          from: `/docs/l-${index}`,
          to: "/docs/quickstart",
        })),
        table,
      ).diagnostics[0]?.code,
    ).toBe("REDIRECT_LIMIT_EXCEEDED");
  });
});
