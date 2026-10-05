import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG_TIMEOUT_MS,
  DEFAULT_SOURCE_TIMEOUT_MS,
} from "./contracts.js";
import { parseArguments } from "./arguments.js";

describe("parseArguments", () => {
  it.each(["--help", "-h"])("parses root help via %s", (flag) => {
    expect(parseArguments([flag])).toEqual({ kind: "root-help" });
  });

  it.each(["--help", "-h"])("parses validate help via %s", (flag) => {
    expect(parseArguments(["validate", flag])).toEqual({
      command: "validate",
      kind: "command-help",
    });
    expect(parseArguments(["build", flag])).toEqual({
      command: "build",
      kind: "command-help",
    });
  });

  it("parses the complete validate option surface", () => {
    expect(
      parseArguments([
        "validate",
        "--json",
        "--root",
        "./project",
        "--config-timeout",
        "7500",
        "--source-timeout",
        "1000",
      ]),
    ).toEqual({
      command: "validate",
      configTimeoutMs: 7_500,
      current: false,
      json: true,
      kind: "command",
      noDiff: false,
      root: "./project",
      sourceTimeoutMs: 1_000,
    });
    expect(parseArguments(["build"])).toEqual({
      command: "build",
      configTimeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
      current: false,
      json: false,
      kind: "command",
      noDiff: false,
      root: ".",
      sourceTimeoutMs: DEFAULT_SOURCE_TIMEOUT_MS,
    });
  });

  it("parses the release, current, and deprecate surfaces (SPEC-010)", () => {
    expect(
      parseArguments([
        "release",
        "v2",
        "--current",
        "--from",
        "v1",
        "--label",
        "2.0",
        "--date",
        "2026-09-05",
        "--json",
      ]),
    ).toEqual({
      command: "release",
      configTimeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
      current: true,
      date: "2026-09-05",
      from: "v1",
      json: true,
      kind: "command",
      label: "2.0",
      noDiff: false,
      root: ".",
      sourceTimeoutMs: DEFAULT_SOURCE_TIMEOUT_MS,
      version: "v2",
    });
    expect(parseArguments(["release", "v1", "--no-diff"])).toMatchObject({
      command: "release",
      current: false,
      noDiff: true,
      version: "v1",
    });
    expect(parseArguments(["build", "--from", "v1"])).toMatchObject({
      command: "build",
      from: "v1",
    });
    expect(parseArguments(["current", "v1", "--root", "./docs"])).toMatchObject(
      { command: "current", root: "./docs", version: "v1" },
    );
    expect(parseArguments(["deprecate", "v1", "--json"])).toMatchObject({
      command: "deprecate",
      json: true,
      version: "v1",
    });
    expect(parseArguments(["release", "--help"])).toEqual({
      command: "release",
      kind: "command-help",
    });
    const invalid: readonly (readonly string[])[] = [
      ["release"],
      ["current"],
      ["deprecate"],
      ["release", "v1", "v2"],
      ["release", "v1", "--current", "--current"],
      ["release", "v1", "--no-diff", "--no-diff"],
      ["release", "v1", "--no-diff", "--from", "v0"],
      ["release", "v1", "--from"],
      ["release", "v1", "--from", "--json"],
      ["release", "v1", "--from", "v0", "--from", "v0"],
      ["release", "v1", "--label"],
      ["release", "v1", "--label", "--json"],
      ["release", "v1", "--label", "a", "--label", "b"],
      ["release", "v1", "--label", "x".repeat(81)],
      ["release", "v1", "--label", "bad\u001b"],
      ["release", "v1", "--date", "yesterday"],
      ["release", "v1", "--date", "2026-09-05", "--date", "2026-09-06"],
      ["validate", "--current"],
      ["validate", "--no-diff"],
      ["validate", "--from", "v1"],
      ["validate", "--label", "x"],
      ["build", "--date", "2026-09-05"],
      ["current", "v1", "--current"],
      ["validate", "v1"],
    ];
    for (const args of invalid) {
      expect(parseArguments(args), args.join(" ")).toMatchObject({
        kind: "usage-error",
      });
    }
  });

  it("rejects invalid invocations", () => {
    const invalidInvocations: readonly (readonly string[])[] = [
      [],
      ["unknown"],
      ["validate", "extra"],
      ["validate", "--unknown"],
      ["validate", "--json", "--json"],
      ["validate", "--root"],
      ["validate", "--root", "--json"],
      ["validate", "--root", ".", "--root", "."],
      ["validate", "--config-timeout"],
      ["validate", "--config-timeout", "NaN"],
      ["validate", "--config-timeout", "99"],
      ["validate", "--config-timeout", "60001"],
      ["validate", "--config-timeout", "100", "--config-timeout", "200"],
      ["validate", "--help", "--json"],
      ["build", "--source-timeout", "99"],
      ["build", "--source-timeout", "600001"],
      ["build", "--source-timeout", "100", "--source-timeout", "200"],
      ["dev"],
    ];
    for (const args of invalidInvocations) {
      expect(parseArguments(args)).toEqual(
        expect.objectContaining({ kind: "usage-error" }),
      );
    }
  });
});
