import { describe, expect, it } from "vitest";

import {
  isRedactedIssuePath,
  parseConfig,
  redactIssuePath,
  specraConfigSchema,
} from "./index.js";

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
        playground: { mode: "disabled" },
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

describe("issue path redaction", () => {
  const schemaLabels = [
    "branding",
    "branding.favicon",
    "branding.logo",
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
    "schemaVersion",
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
