import { describe, expect, it } from "vitest";

import { parseConfig } from "./index.js";

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
