import { describe, expect, it } from "vitest";

import {
  isRedactedIssuePath,
  parseConfig,
  parseSdkExamplesFile,
  redactIssuePath,
  specraConfigSchema,
} from "./index.js";

describe("navigation and branding", () => {
  it("accepts configured navigation and a hex accent", () => {
    const parsed = parseConfig({
      branding: { accent: "#3366FF", logo: "./assets/logo.svg" },
      name: "Example",
      navigation: [
        "introduction",
        { label: "Start", page: "getting-started/quickstart" },
        {
          items: ["guides/ci", { items: ["guides/deep"], section: "Nested" }],
          section: "Guides",
        },
        { api: true, label: "Reference" },
        { label: "Status", link: "https://status.example.test" },
      ],
      openapi: "./openapi.yaml",
      schemaVersion: 1,
    });
    expect(parsed.navigation).toHaveLength(5);
    expect(parsed.branding?.accent).toBe("#3366FF");
  });

  it("rejects invalid navigation entries, links, and accents", () => {
    const base = {
      name: "Example",
      openapi: "./openapi.yaml",
      schemaVersion: 1,
    } as const;
    expect(() => parseConfig({ ...base, navigation: ["Bad Slug"] })).toThrow();
    expect(() =>
      parseConfig({ ...base, navigation: [{ api: false }] }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        navigation: [{ label: "x", link: "javascript:alert(1)" }],
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        navigation: [{ label: "x", link: "https://u:p@example.test" }],
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        navigation: [{ section: "S", items: ["a"], extra: 1 }],
      }),
    ).toThrow();
    expect(() =>
      parseConfig({ ...base, branding: { accent: "red" } }),
    ).toThrow();
    expect(() =>
      parseConfig({ ...base, branding: { accent: "url(x)" } }),
    ).toThrow();
    expect(() =>
      parseConfig({ ...base, branding: { accent: "#abc" } }),
    ).toThrow();
  });

  it("redacts navigation issue paths through the recursive schema", () => {
    expect(redactIssuePath(["navigation", 2, "items", 0, "page"])).toBe(
      "navigation.2.items.0.page",
    );
    expect(redactIssuePath(["navigation", 0, "link"])).toBe(
      "navigation.0.link",
    );
    expect(redactIssuePath(["branding", "accent"])).toBe("branding.accent");
    expect(isRedactedIssuePath("navigation.2.items.0.page")).toBe(true);
    expect(isRedactedIssuePath("navigation.x")).toBe(false);
  });
});

describe("parseConfig", () => {
  it("applies secure defaults", () => {
    expect(
      parseConfig({
        name: "Example",
        openapi: "./openapi.yaml",
        schemaVersion: 1,
      }),
    ).toEqual(
      expect.objectContaining({
        docs: "./docs",
        playground: {
          environments: [],
          mode: "disabled",
          responseLimitBytes: 1_048_576,
          timeoutMs: 30_000,
        },
      }),
    );
  });

  it("rejects unknown keys, unsafe paths, and unsafe environment URLs", () => {
    expect(() =>
      parseConfig({
        name: "Example",
        openapi: "./openapi.yaml",
        schemaVersion: 1,
        unsafe: true,
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        name: "Example",
        openapi: "../private/openapi.yaml",
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        environments: { local: { baseUrl: "file:///etc/passwd" } },
        name: "Example",
        openapi: "./openapi.yaml",
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        environments: { insecure: { baseUrl: "http://api.example.com" } },
        name: "Example",
        openapi: "./openapi.yaml",
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        environments: {
          embeddedSecret: { baseUrl: "https://user:password@api.example.com" },
        },
        name: "Example",
        openapi: "./openapi.yaml",
        schemaVersion: 1,
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        environments: {
          querySecret: {
            baseUrl: "https://api.example.com?token=not-a-real-secret",
          },
        },
        name: "Example",
        openapi: "./openapi.yaml",
        schemaVersion: 1,
      }),
    ).toThrow();
  });
});

describe("sdks", () => {
  const base = {
    name: "Example",
    openapi: "./openapi.yaml",
    schemaVersion: 1,
  } as const;

  it("accepts inline and file-backed SDK example mappings with defaults", () => {
    const parsed = parseConfig({
      ...base,
      sdks: [
        {
          examples: [
            { code: "client.inboxes.create()", operation: "createInbox" },
            {
              file: "./sdk/get.ts",
              operation: {
                method: "GET",
                path: "/inboxes/{id}",
                service: "Mail",
              },
              title: "Get an inbox",
            },
          ],
          id: "typescript",
          label: "TypeScript SDK",
          language: "typescript",
          package: "@example/sdk",
        },
        {
          examples: "./sdk/java.json",
          id: "java",
          label: "Java SDK",
          language: "java",
        },
        { id: "go", label: "Go SDK", language: "go" },
      ],
    });
    expect(parsed.sdks.map((sdk) => sdk.coverage)).toEqual([
      "partial",
      "partial",
      "partial",
    ]);
    expect(parsed.sdks[2]?.examples).toEqual([]);
    expect(parsed.environments).toEqual({});
  });

  it("rejects callbacks, unknown languages, bad ids, and examples without exactly one source", () => {
    const sdk = { id: "ts", label: "TS", language: "typescript" };
    for (const sdks of [
      [{ ...sdk, generate: () => "x" }],
      [{ ...sdk, language: "brainfuck" }],
      [{ ...sdk, id: "Not Kebab" }],
      [{ ...sdk, examples: [{ operation: "x" }] }],
      [{ ...sdk, examples: [{ code: "a", file: "./b.ts", operation: "x" }] }],
      [{ ...sdk, examples: [{ code: "", operation: "x" }] }],
      [
        {
          ...sdk,
          examples: [{ code: "a", operation: { method: "FETCH", path: "/x" } }],
        },
      ],
      [
        {
          ...sdk,
          examples: [{ code: "a", operation: { method: "GET", path: "x" } }],
        },
      ],
      [
        {
          ...sdk,
          examples: [{ code: "a", file: "../outside.ts", operation: "x" }],
        },
      ],
      [{ ...sdk, examples: "/etc/passwd" }],
      [{ ...sdk, coverage: "total" }],
    ]) {
      expect(
        () => parseConfig({ ...base, sdks }),
        JSON.stringify(sdks),
      ).toThrow();
    }
    expect(() =>
      parseSdkExamplesFile({ examples: [{ operation: 1 }] }),
    ).toThrow();
    expect(parseSdkExamplesFile({ examples: [] })).toEqual({ examples: [] });
  });

  it("requires environment names to be identifiers", () => {
    expect(() =>
      parseConfig({
        ...base,
        environments: { "prod env": { baseUrl: "https://api.example.com" } },
      }),
    ).toThrow();
    expect(
      parseConfig({
        ...base,
        environments: { "prod-1": { baseUrl: "https://api.example.com" } },
      }).environments["prod-1"]?.baseUrl,
    ).toBe("https://api.example.com");
  });
});

describe("playground opt-in", () => {
  const base = {
    environments: {
      local: { baseUrl: "http://127.0.0.1:4010" },
      production: { baseUrl: "https://api.example.com" },
    },
    name: "Example",
    openapi: "./openapi.yaml",
    schemaVersion: 1,
  } as const;

  it("approves only listed environments under browser mode", () => {
    const parsed = parseConfig({
      ...base,
      playground: { environments: ["local"], mode: "browser" },
    });
    expect(parsed.playground).toEqual({
      environments: ["local"],
      mode: "browser",
      responseLimitBytes: 1_048_576,
      timeoutMs: 30_000,
    });
  });

  it("rejects unknown environments, listed environments without browser mode, and limits past the maximum", () => {
    expect(() =>
      parseConfig({
        ...base,
        playground: { environments: ["staging"], mode: "browser" },
      }),
    ).toThrow();
    expect(() =>
      parseConfig({ ...base, playground: { environments: ["local"] } }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        playground: { mode: "browser", responseLimitBytes: 5 * 1_048_576 },
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        playground: { mode: "browser", timeoutMs: 600_000 },
      }),
    ).toThrow();
    expect(() =>
      parseConfig({
        ...base,
        playground: { mode: "browser", resolveDestination: () => "x" },
      }),
    ).toThrow();
  });
});

describe("issue path redaction", () => {
  const schemaLabels = [
    "branding",
    "branding.accent",
    "branding.favicon",
    "branding.logo",
    "navigation",
    "navigation.0",
    "navigation.0.api",
    "navigation.0.items",
    "navigation.0.items.1.page",
    "navigation.3.link",
    "config",
    "docs",
    "environments",
    "environments.*",
    "environments.*.baseUrl",
    "environments.*.label",
    "name",
    "openapi",
    "openapi.0",
    "openapi.12",
    "playground",
    "playground.mode",
    "playground.environments",
    "playground.environments.0",
    "playground.responseLimitBytes",
    "playground.timeoutMs",
    "redirects",
    "redirects.0",
    "redirects.0.from",
    "redirects.0.to",
    "schemaVersion",
    "sdks",
    "sdks.0",
    "sdks.0.id",
    "sdks.0.coverage",
    "sdks.0.examples",
    "sdks.0.examples.0",
    "sdks.0.examples.0.operation",
    "sdks.0.examples.0.operation.method",
    "sdks.0.examples.0.file",
    "sdks.0.examples.0.code",
  ];

  it("keeps schema keys, redacts user keys, and marks array positions", () => {
    expect(redactIssuePath([])).toBe("config");
    expect(redactIssuePath(["openapi", 3])).toBe("openapi.3");
    expect(redactIssuePath(["environments", "prod-secret", "baseUrl"])).toBe(
      "environments.*.baseUrl",
    );
    expect(redactIssuePath(["branding", "logo"])).toBe("branding.logo");
    expect(redactIssuePath(["unknown"])).toBe("*");
    expect(redactIssuePath(["name", "nested"])).toBe("name.*");
    expect(redactIssuePath([Symbol("secret")])).toBe("*");
  });

  it("round-trips every schema key and rejects labels the schema cannot produce", () => {
    for (const key of Object.keys(specraConfigSchema.shape)) {
      expect(schemaLabels).toContain(key);
      expect(redactIssuePath([key])).toBe(key);
    }
    for (const label of schemaLabels) {
      expect(isRedactedIssuePath(label), label).toBe(true);
    }
    for (const label of [
      "",
      "*",
      "unknown",
      "openapi.[]",
      "openapi.01",
      "environments.production",
      "environments.*.token",
      "name.*",
      "config.name",
      "branding.logo.[]",
      `environments.${"*.".repeat(40)}baseUrl`,
    ]) {
      expect(isRedactedIssuePath(label), label).toBe(false);
    }
  });

  it("labels real validation issues without leaking values", () => {
    const result = specraConfigSchema.safeParse({
      environments: { "hunter2-secret": { baseUrl: "ftp://x" } },
      name: "",
      openapi: ["./ok.yaml", "../escape.yaml"],
      schemaVersion: 1,
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    const labels = result.error.issues.map((issue) =>
      redactIssuePath(issue.path),
    );
    expect(labels).toEqual(
      expect.arrayContaining(["environments.*.baseUrl", "name", "openapi.1"]),
    );
    expect(labels.join(" ")).not.toContain("hunter2");
    expect(labels.every((label) => isRedactedIssuePath(label))).toBe(true);
  });
});
