import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG_TIMEOUT_MS } from "./contracts.js";
import { parseArguments } from "./arguments.js";

describe("parseArguments", () => {
  it.each(["--help", "-h"])("parses root help via %s", (flag) => {
    expect(parseArguments([flag])).toEqual({ kind: "root-help" });
  });

  it.each(["--help", "-h"])("parses validate help via %s", (flag) => {
    expect(parseArguments(["validate", flag])).toEqual({
      kind: "validate-help",
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
      ]),
    ).toEqual({
      configTimeoutMs: 7_500,
      json: true,
      kind: "validate",
      root: "./project",
    });
    expect(parseArguments(["validate"])).toEqual({
      configTimeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
      json: false,
      kind: "validate",
      root: ".",
    });
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
    ];
    for (const args of invalidInvocations) {
      expect(parseArguments(args)).toEqual(
        expect.objectContaining({ kind: "usage-error" }),
      );
    }
  });
});
