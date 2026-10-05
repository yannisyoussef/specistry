import { describe, expect, it } from "vitest";

import type { PlaygroundEnvironment } from "../types.js";
import {
  assertExactOrigin,
  composeDestination,
  DESTINATION_MESSAGES,
} from "./destination.js";

/**
 * SPEC-009 §15–§18, §132: the destination assertion is the last line before
 * fetch. Every hostile parameter value that could steer a URL off the
 * approved origin (authority tricks, userinfo, fragments, encoded slashes,
 * dot segments, Unicode look-alikes) must fail closed, and honest values
 * must compose to a URL on exactly that origin.
 */

const environment: PlaygroundEnvironment = {
  baseUrl: "https://api.example.com/v1",
  id: "production",
  label: "Production",
  loopback: false,
  origin: "https://api.example.com",
};

const HOSTILE_PATH_VALUES = [
  "//evil.example",
  "@evil.example",
  "evil.example@",
  "https://evil.example",
  "#fragment",
  "%2f%2fevil.example",
  "..%2f..%2fadmin",
  "../../admin",
  "\u0000",
  "\r\nHost: evil.example",
  "аpi.example.com", // Cyrillic a
  "api.example.com.evil.example",
  "?x=1#y",
  " ",
  "\\evil.example",
];

describe("assertExactOrigin", () => {
  it("accepts a URL on exactly the approved origin", () => {
    expect(
      assertExactOrigin(
        "https://api.example.com/v1/inboxes?limit=1",
        environment.origin,
        8_192,
      ),
    ).toBeUndefined();
  });

  it.each([
    ["https://evil.example/v1", "origin-mismatch"],
    ["http://api.example.com/v1", "origin-mismatch"],
    ["https://api.example.com:8443/v1", "origin-mismatch"],
    ["https://api.example.com.evil.example/v1", "origin-mismatch"],
    ["https://evil.example@api.example.com/v1", "userinfo"],
    ["https://user:pass@api.example.com/v1", "userinfo"],
    ["https://api.example.com/v1#top", "fragment"],
    ["https://api.example.com/v1%23", undefined],
    ["not a url", "invalid-url"],
    ["//api.example.com/v1", "invalid-url"],
    ["javascript:alert(1)", "origin-mismatch"],
    ["data:text/plain,hi", "origin-mismatch"],
    ["file:///etc/passwd", "origin-mismatch"],
    ["blob:https://api.example.com/x", "origin-mismatch"],
  ])("classifies %s as %s", (url, failure) => {
    expect(assertExactOrigin(url, environment.origin, 8_192)).toBe(failure);
  });

  it("enforces the length budget before parsing", () => {
    const url = `https://api.example.com/v1/${"a".repeat(100)}`;
    expect(assertExactOrigin(url, environment.origin, 50)).toBe("url-too-long");
  });

  it("rejects an approved origin that is itself malformed", () => {
    expect(
      assertExactOrigin("https://api.example.com/v1", "api.example.com", 8_192),
    ).toBe("invalid-url");
  });

  it("has a message for every failure", () => {
    for (const failure of [
      "base-path",
      "fragment",
      "invalid-url",
      "origin-mismatch",
      "url-too-long",
      "userinfo",
    ] as const) {
      expect(DESTINATION_MESSAGES[failure].length).toBeGreaterThan(10);
    }
  });
});

describe("composeDestination", () => {
  it("composes the base URL, path, and query on the approved origin", () => {
    const result = composeDestination(
      environment,
      "/inboxes/inb_1",
      [{ name: "limit", value: "5" }],
      8_192,
    );
    expect(result).toEqual({
      ok: true,
      url: "https://api.example.com/v1/inboxes/inb_1?limit=5",
    });
  });

  it.each(HOSTILE_PATH_VALUES)(
    "keeps hostile path value %j on the origin or fails closed",
    (value) => {
      // Path values arrive already percent-encoded by the shared serializer;
      // here the raw value is inserted to prove the assertion alone suffices.
      const result = composeDestination(
        environment,
        `/inboxes/${value}`,
        [],
        8_192,
      );
      if (result.ok) {
        const parsed = new URL(result.url);
        expect(parsed.origin).toBe(environment.origin);
        expect(parsed.username).toBe("");
        expect(parsed.hash).toBe("");
        expect(parsed.pathname.startsWith("/v1/")).toBe(true);
      } else {
        expect(result.failure).toBeDefined();
      }
    },
  );

  it.each(HOSTILE_PATH_VALUES)(
    "keeps hostile query value %j on the origin or fails closed",
    (value) => {
      const result = composeDestination(
        environment,
        "/inboxes",
        [{ name: "q", value }],
        8_192,
      );
      if (result.ok) {
        expect(new URL(result.url).origin).toBe(environment.origin);
        expect(result.url.includes("#")).toBe(false);
      } else {
        expect(result.failure).toBeDefined();
      }
    },
  );

  it.each([
    "../../admin",
    "../..",
    "%2e%2e/%2e%2e/admin",
    "../../../x",
    "inb/../../../admin",
  ])("refuses dot segments that climb out of the base path (%s)", (value) => {
    const result = composeDestination(
      environment,
      `/inboxes/${value}`,
      [],
      8_192,
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("base-path");
  });

  it("accepts dot segments that stay under the base path", () => {
    expect(
      composeDestination(environment, "/inboxes/a/../b", [], 8_192),
    ).toEqual({
      ok: true,
      url: "https://api.example.com/v1/inboxes/a/../b",
    });
  });

  it("fails closed on a URL over the length budget", () => {
    const result = composeDestination(
      environment,
      `/${"x".repeat(9_000)}`,
      [],
      8_192,
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("url-too-long");
  });

  it("keeps a loopback HTTP environment on its port", () => {
    const local: PlaygroundEnvironment = {
      baseUrl: "http://127.0.0.1:47391/v1",
      id: "local",
      label: "Local",
      loopback: true,
      origin: "http://127.0.0.1:47391",
    };
    expect(composeDestination(local, "/inboxes", [], 8_192)).toEqual({
      ok: true,
      url: "http://127.0.0.1:47391/v1/inboxes",
    });
  });
});
