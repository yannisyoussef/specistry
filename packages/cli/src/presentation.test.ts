import { describe, expect, it } from "vitest";

import type { ValidationResult } from "./contracts.js";
import {
  formatHumanResult,
  formatJsonResult,
  sanitizeTerminal,
} from "./presentation.js";

describe("CLI presentation", () => {
  it("neutralizes terminal controls and bidirectional formatting", () => {
    expect(sanitizeTerminal("safe\u001b]8;;bad\u0007\r\n\u202eevil")).toBe(
      "safe\\u001b]8;;bad\\u0007\\u000d\\u000a\\u202eevil",
    );
  });

  it("renders fixed, actionable human diagnostics without terminal injection", () => {
    const result: ValidationResult = {
      diagnostics: [
        {
          code: "CONFIG_INVALID",
          message: "invalid\u001b[31m",
          path: "name\rforged",
          severity: "error",
        },
      ],
      ok: false,
      outcome: "validation-failure",
    };
    const output = formatHumanResult(result);
    expect(output).toContain("name\\u000dforged");
    expect(output).toContain("invalid\\u001b[31m");
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("\r");
  });

  it("emits a stable JSON envelope", () => {
    const result: ValidationResult = {
      diagnostics: [
        {
          code: "CONFIG_NOT_FOUND",
          message: "No specra.config.ts file was found at the project root.",
          path: "config",
          severity: "error",
        },
      ],
      ok: false,
      outcome: "validation-failure",
    };
    expect(JSON.parse(formatJsonResult(result))).toEqual({
      diagnostics: [
        {
          code: "CONFIG_NOT_FOUND",
          message: "No specra.config.ts file was found at the project root.",
          path: "config",
          severity: "error",
        },
      ],
      ok: false,
    });
  });
});
