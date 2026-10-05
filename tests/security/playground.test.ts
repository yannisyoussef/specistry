import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { parseConfig } from "@specra/config";
import {
  parsePlaygroundArtifact,
  PlaygroundArtifactError,
  serializePlaygroundArtifact,
} from "@specra/playground";
import { describe, expect, it } from "vitest";

import { contentSecurityPolicy } from "../../apps/web/proxy";

/**
 * SPEC-009 §128–§140: the structural guarantees of the browser-direct
 * playground. There is no server proxy or forwarding route, the server
 * never imports the credential vault, the CSP names exact origins only, the
 * config cannot approve a wildcard or an unknown environment, and a tampered
 * policy artifact cannot widen a destination.
 */

const root = path.resolve(__dirname, "../..");

function walk(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist")
      continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("no proxy, no forwarding", () => {
  it("has no route handler that could relay a request to an API", () => {
    const routes = walk(path.join(root, "apps/web/app")).filter((file) =>
      /route\.tsx?$/.test(file),
    );
    const allowed = new Set([
      "apps/web/app/theme/route.ts",
      "apps/web/app/search/[name]/route.ts",
      "apps/web/app/assets/[name]/route.ts",
      // SPEC-010: sitemap index and per-release sitemaps, rendered from the
      // catalog and route tables; they fetch nothing.
      "apps/web/app/sitemap.xml/route.ts",
      "apps/web/app/sitemaps/[name]/route.ts",
      // SPEC-012: local process liveness and artifact-verifying readiness.
      // Both are GET-only, value-free, and have no forwarding authority.
      "apps/web/app/healthz/route.ts",
      "apps/web/app/readyz/route.ts",
    ]);
    for (const file of routes) {
      const relative = path.relative(root, file);
      expect(
        allowed.has(relative),
        `${relative} is not an approved route handler`,
      ).toBe(true);
      const source = readFileSync(file, "utf8");
      expect(source, `${relative} must not fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(
        source,
        `${relative} must not expose POST/PUT/PATCH/DELETE for relaying`,
      ).not.toMatch(/export\s+(?:async\s+)?function\s+(?:PUT|PATCH|DELETE)\b/);
    }
    // The theme route is the only POST and it never reads a URL from the body.
    const theme = readFileSync(
      path.join(root, "apps/web/app/theme/route.ts"),
      "utf8",
    );
    expect(theme).not.toMatch(/https?:\/\//);
  });

  it("keeps the credential vault and executor out of every server module", () => {
    const serverFiles = [
      ...walk(path.join(root, "apps/web/app")),
      ...walk(path.join(root, "apps/web/lib")),
      path.join(root, "apps/web/proxy.ts"),
      ...walk(path.join(root, "packages/cli/src")),
    ];
    for (const file of serverFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(root, file)).not.toMatch(
        /@specra\/playground\/client/,
      );
      expect(source, path.relative(root, file)).not.toMatch(
        /createCredentialVault|executeRequest\(/,
      );
    }
  });

  it("only the Try it island imports the client entry, and it never touches storage or cookies with a credential", () => {
    const components = walk(path.join(root, "apps/web/components"));
    const importing = components.filter((file) =>
      /@specra\/playground\/client/.test(readFileSync(file, "utf8")),
    );
    expect(importing.map((file) => path.relative(root, file)).sort()).toEqual([
      "apps/web/components/reader/playground/try-it.tsx",
    ]);
    const island = readFileSync(
      path.join(root, "apps/web/components/reader/playground/try-it.tsx"),
      "utf8",
    );
    expect(island).not.toMatch(/localStorage/);
    expect(island).not.toMatch(/document\.cookie/);
    expect(island).not.toMatch(/indexedDB/);
    expect(island).not.toMatch(/console\./);
    // The only sessionStorage value is the environment id.
    const storageWrites =
      island.match(/sessionStorage\.setItem\([^)]*\)/g) ?? [];
    expect(storageWrites).toEqual([
      "sessionStorage.setItem(ENVIRONMENT_KEY, id)",
    ]);
  });
});

describe("content security policy", () => {
  const nonce = "dGVzdA==";

  it("names only exact approved origins in connect-src on API routes", () => {
    const policy = contentSecurityPolicy(nonce, false, [
      "https://sandbox.testinbox.email",
      "http://127.0.0.1:47391",
    ]);
    const connect = policy
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("connect-src"));
    expect(connect).toBe(
      "connect-src 'self' http://127.0.0.1:47391 https://sandbox.testinbox.email",
    );
    expect(policy).not.toContain("*");
    expect(policy).not.toContain("unsafe");
  });

  it("stays 'self' without approved origins and refuses non-exact entries", () => {
    const policy = contentSecurityPolicy(nonce, false, []);
    expect(policy).toMatch(/connect-src 'self'(?:;|$)/);
    for (const hostile of [
      "https://*.example.com",
      "https://api.example.com/v1",
      "api.example.com",
      "https://user@api.example.com",
      "https://api.example.com;script-src *",
      "http://api.example.com",
      "https://api.example.com#x",
      "https://api.example.com?x",
    ]) {
      const withHostile = contentSecurityPolicy(nonce, false, [hostile]);
      expect(withHostile, hostile).toMatch(/connect-src 'self'(?:;|$)/);
      expect(withHostile, hostile).not.toContain("example.com");
    }
  });

  it("keeps img-src to self so a response can never load a remote image", () => {
    const policy = contentSecurityPolicy(nonce, false, [
      "https://api.example.com",
    ]);
    expect(policy).toMatch(/img-src 'self'(?:;|$)/);
    // Safari upgrades same-origin loopback assets when this directive is
    // present, which breaks the explicitly supported local HTTP workflow.
    // Production transport enforcement belongs at the TLS/HSTS proxy.
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});

describe("configuration opt-in", () => {
  const base = {
    environments: {
      local: { baseUrl: "http://127.0.0.1:47391/v1", label: "Local" },
      production: {
        baseUrl: "https://api.example.com/v1",
        label: "Production",
      },
    },
    name: "Docs",
    openapi: "./openapi.yaml",
    schemaVersion: 1,
  };
  const withPlayground =
    (playground: unknown, environments = base.environments) =>
    () =>
      parseConfig({ ...base, environments, playground });

  it("is disabled by default", () => {
    expect(parseConfig(base).playground).toEqual({
      environments: [],
      mode: "disabled",
      responseLimitBytes: 1_048_576,
      timeoutMs: 30_000,
    });
  });

  it("accepts an explicit opt-in for configured environments", () => {
    expect(
      withPlayground({
        environments: ["local", "production"],
        mode: "browser",
      })().playground,
    ).toEqual({
      environments: ["local", "production"],
      mode: "browser",
      responseLimitBytes: 1_048_576,
      timeoutMs: 30_000,
    });
  });

  it("refuses unknown environments, non-browser mode with environments, unknown modes and keys, and out-of-range limits", () => {
    expect(
      withPlayground({ environments: ["staging"], mode: "browser" }),
    ).toThrow();
    expect(
      withPlayground({ environments: ["local"], mode: "disabled" }),
    ).toThrow();
    expect(
      withPlayground({
        environments: ["local"],
        mode: "browser",
        responseLimitBytes: 5 * 1_048_576,
      }),
    ).toThrow();
    expect(
      withPlayground({
        environments: ["local"],
        mode: "browser",
        timeoutMs: 600_000,
      }),
    ).toThrow();
    expect(
      withPlayground({
        environments: ["local"],
        mode: "browser",
        timeoutMs: 0,
      }),
    ).toThrow();
    expect(
      withPlayground({ environments: ["local"], mode: "proxy" }),
    ).toThrow();
    expect(withPlayground({ environments: ["*"], mode: "browser" })).toThrow();
    expect(
      withPlayground({
        environments: ["local"],
        mode: "browser",
        proxy: "https://relay.example",
      }),
    ).toThrow();
  });

  it("cannot approve a wildcard, plain-HTTP remote, credentialed, or query-bearing environment", () => {
    for (const baseUrl of [
      "https://*.example.com",
      "http://api.example.com",
      "https://user:pw@api.example.com",
      "https://api.example.com/v1?key=1",
      "https://api.example.com/v1#x",
      "ftp://api.example.com",
    ]) {
      expect(
        withPlayground(
          { environments: ["other"], mode: "browser" },
          { ...base.environments, other: { baseUrl, label: "Other" } },
        ),
        baseUrl,
      ).toThrow();
    }
  });
});

describe("policy artifact tampering", () => {
  const text = readFileSync(
    path.join(
      root,
      "tests/fixtures/reader/testinbox/.specra/artifacts/playground.json",
    ),
    "utf8",
  );
  const artifact = parsePlaygroundArtifact(text);

  function tampered(
    edit: (value: Record<string, unknown>) => void,
  ): () => void {
    const value = JSON.parse(text) as Record<string, unknown>;
    edit(value);
    return () => parsePlaygroundArtifact(JSON.stringify(value));
  }

  it("parses the committed fixture policy with loopback environments only", () => {
    expect(artifact.enabled).toBe(true);
    expect(
      artifact.environments.every((environment) => environment.loopback),
    ).toBe(true);
    expect(serializePlaygroundArtifact(artifact)).toBe(text);
  });

  it("rejects a widened origin, a wildcard, a raised limit, or an executable cookie scheme", () => {
    expect(
      tampered((value) => {
        (value.environments as Record<string, unknown>[])[0]!.origin =
          "https://evil.example";
      }),
    ).toThrow(PlaygroundArtifactError);
    expect(
      tampered((value) => {
        (value.environments as Record<string, unknown>[])[0]!.baseUrl =
          "https://*.testinbox.email/v1";
      }),
    ).toThrow(PlaygroundArtifactError);
    expect(
      tampered((value) => {
        (value.limits as Record<string, number>).responseBytes = 10 * 1_048_576;
      }),
    ).toThrow(PlaygroundArtifactError);
    expect(
      tampered((value) => {
        (value.limits as Record<string, number>).timeoutMs = 3_600_000;
      }),
    ).toThrow(PlaygroundArtifactError);
    expect(
      tampered((value) => {
        const operations = value.operations as Record<
          string,
          { auth: { schemes: Record<string, unknown>[]; supported: boolean }[] }
        >;
        const op = operations["openapi.yaml~createWebhook"]!;
        op.auth[0]!.schemes[1]!.supported = true;
        op.auth[0]!.supported = true;
      }),
    ).toThrow(PlaygroundArtifactError);
    expect(
      tampered((value) => {
        value.proxy = "https://relay.example";
      }),
    ).toThrow(PlaygroundArtifactError);
  });
});
