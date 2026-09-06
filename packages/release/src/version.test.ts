import { describe, expect, it } from "vitest";

import {
  isVersionId,
  RESERVED_VERSION_IDS,
  validateVersionId,
  VERSION_ID_MESSAGES,
  versionKey,
} from "./version.js";

/** SPEC-010 §8–§10: path-safe, deterministic, deployment-independent ids. */
describe("version ids", () => {
  it("accepts the documented human forms", () => {
    for (const id of [
      "v1",
      "v1.2",
      "1.2.0",
      "2026-09",
      "V2",
      "release_7",
      "2025-q4-beta",
    ]) {
      expect(validateVersionId(id), id).toBeUndefined();
      expect(isVersionId(id)).toBe(true);
    }
  });

  it.each([
    ["", "empty"],
    ["v1/", "grammar"],
    ["v1\\", "grammar"],
    ["..", "dot-segment"],
    [".", "dot-segment"],
    ["v1..2", "dot-segment"],
    ["v1%2f2", "grammar"],
    ["v1%5c2", "grammar"],
    ["v1?x=1", "grammar"],
    ["v1#top", "grammar"],
    ["v1\u0000", "grammar"],
    ["v1\u202e", "grammar"],
    ["v 1", "grammar"],
    ["-v1", "grammar"],
    ["v1.", "grammar"],
    ["v1_", "grammar"],
    ["é1", "grammar"],
    ["x".repeat(65), "too-long"],
    ["current", "reserved"],
    ["Latest", "reserved"],
    ["api", "reserved"],
    ["docs", "reserved"],
    ["assets", "reserved"],
    ["search", "reserved"],
    ["theme", "reserved"],
    ["changelog", "reserved"],
    ["_next", "grammar"],
  ])("rejects %j as %s", (id, issue) => {
    expect(validateVersionId(id)).toBe(issue);
    expect(
      VERSION_ID_MESSAGES[issue as keyof typeof VERSION_ID_MESSAGES],
    ).toBeTruthy();
  });

  it("collides ids that differ only by case", () => {
    expect(versionKey("V1")).toBe(versionKey("v1"));
    expect(versionKey("v1")).not.toBe(versionKey("v2"));
  });

  it("reserves every top-level reader route", () => {
    for (const name of [
      "api",
      "docs",
      "assets",
      "search",
      "theme",
      "not-found",
      "sitemap.xml",
      "robots.txt",
    ]) {
      expect(RESERVED_VERSION_IDS.has(name)).toBe(true);
    }
  });
});
