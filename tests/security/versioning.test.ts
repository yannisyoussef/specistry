import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isInternalRedirectPath, validateVersionId } from "@specra/release";
import { beforeEach, describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "../../apps/web/proxy";
import {
  resetReleaseCaches,
  resolveVersionRoute,
} from "../../apps/web/lib/reader/release";

/**
 * SPEC-010 §57–§63, §85, §114–§115, §153, §188: redirects never leave the
 * site or a release, version ids cannot escape the store, no reader module
 * reads the private candidates, and the CSP builder cannot union origins.
 */

const root = path.resolve(__dirname, "../..");
const fixture = fileURLToPath(
  new URL("../fixtures/reader/versioned/", import.meta.url),
);

function walk(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist")
      continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

beforeEach(() => resetReleaseCaches());

describe("open redirects", () => {
  it.each([
    "//evil.example",
    "/%2f%2fevil.example",
    "https:%2f%2fevil.example",
    "/docs/@evil.example",
    "/docs/\\evil.example",
    "/docs/%0d%0aLocation:evil",
    "/docs/v2/\u2028x",
    "/docs/v2\u200b",
    "/docs/../api/v2",
    "/api/v2/inboxes/../../v1",
    "/docs/v2/quickstart?next=https://evil.example",
  ])("resolves %j to an internal route or a 404", async (pathname) => {
    const resolution = await resolveVersionRoute(
      pathname.split("?")[0] ?? pathname,
      fixture,
    );
    if (resolution.kind === "redirect") {
      expect(resolution.location).toMatch(/^\/(?:docs|api)\/v[12](?:\/|$)/);
      expect(resolution.location).not.toMatch(/evil|\/\/|\\|%|[\u0000-\u001f]/);
    } else {
      // A served route is fine (the query never reaches resolution);
      // anything else must be a real 404.
      expect(["not-found", "serve"]).toContain(resolution.kind);
    }
  });

  it("never treats a redirect path as anything but an internal route", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "/docs/x?y",
      "/docs/x%2f",
      "\\docs\\x",
      "/docs/../x",
    ]) {
      expect(isInternalRedirectPath(value, true), value).toBe(false);
    }
  });
});

describe("version confusion", () => {
  it("rejects every version id that could name a system route or escape the store", () => {
    for (const id of [
      "current",
      "latest",
      "assets",
      "search",
      "api",
      "docs",
      "theme",
      "changelog",
      "not-found",
      "..",
      ".",
      "v1/../v2",
      "v1%2f",
      "V1 ",
      "_next",
      "releases",
      "candidates",
      "sitemap.xml",
    ]) {
      expect(validateVersionId(id), id).toBeDefined();
    }
  });

  it("serves an explicit version only when it is retained, exactly as written", async () => {
    expect(await resolveVersionRoute("/docs/V2", fixture)).toEqual({
      kind: "not-found",
    });
    expect(await resolveVersionRoute("/docs/v2.", fixture)).toEqual({
      kind: "not-found",
    });
    expect(await resolveVersionRoute("/docs/v2/", fixture)).toEqual({
      kind: "serve",
      version: "v2",
    });
    expect(await resolveVersionRoute("/docs/v1/quickstart", fixture)).toEqual({
      kind: "not-found",
    });
  });
});

describe("candidate isolation", () => {
  it("has no reader module that reads the candidates directory or the changelog sources", () => {
    const files = [
      ...walk(path.join(root, "apps/web/app")),
      ...walk(path.join(root, "apps/web/lib")),
      path.join(root, "apps/web/proxy.ts"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(root, file)).not.toMatch(
        /candidates|CANDIDATES_DIRECTORY|diff\.json|CHANGELOG_SOURCE_DIRECTORY/,
      );
    }
  });

  it("keeps the fixture's candidates out of every served artifact", () => {
    const candidates = readFileSync(
      path.join(fixture, ".specra", "candidates", "diff.json"),
      "utf8",
    );
    expect(candidates).toContain("v1..candidate:");
    const store = path.join(fixture, ".specra", "releases");
    for (const version of ["v1", "v2"]) {
      for (const file of readdirSync(path.join(store, version))) {
        if (!file.endsWith(".json")) continue;
        const text = readFileSync(path.join(store, version, file), "utf8");
        expect(text, `${version}/${file}`).not.toContain("v1..candidate:");
        expect(text, `${version}/${file}`).not.toContain('"diffFormat"');
      }
    }
    const changelog = JSON.parse(
      readFileSync(path.join(store, "v2", "changelog.json"), "utf8"),
    ) as { reviewed: { omitted: string[] } };
    // Omitted candidates are recorded as ids only: no label, route, or change detail.
    expect(JSON.stringify(changelog)).not.toContain(
      'schema_14ab563d3d387999","kind"',
    );
    expect(changelog.reviewed.omitted.length).toBeGreaterThan(0);
  });
});

describe("content security policy per release", () => {
  it("cannot be widened beyond the exact origins it is given", () => {
    const policy = contentSecurityPolicy("dGVzdA==", false, [
      "http://127.0.0.1:47391",
      "http://127.0.0.1:47393",
    ]);
    expect(policy).toContain(
      "connect-src 'self' http://127.0.0.1:47391 http://127.0.0.1:47393",
    );
    expect(contentSecurityPolicy("dGVzdA==", false, [])).toMatch(
      /connect-src 'self';/,
    );
    expect(
      contentSecurityPolicy("dGVzdA==", false, ["https://*.versioned.test"]),
    ).toMatch(/connect-src 'self';/);
  });
});
