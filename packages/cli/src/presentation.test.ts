import { describe, expect, it } from "vitest";

import type {
  BuildResult,
  DiffCommandResult,
  CatalogResult,
  ReleaseResult,
  ValidationResult,
} from "./contracts.js";
import {
  formatHumanResult,
  formatJsonResult,
  sanitizeTerminal,
} from "./presentation.js";

describe("CLI presentation", () => {
  it("neutralizes terminal controls and bidirectional formatting", () => {
    expect(
      sanitizeTerminal(
        "safe\u001b]8;;bad\u0007\r\n\u061c\u200e\u200f\u2028\u2029\u202eevil\u200b\ufeff\u00ad\u2060\u{e0041}",
      ),
    ).toBe(
      "safe\\u001b]8;;bad\\u0007\\u000d\\u000a\\u061c\\u200e\\u200f\\u2028\\u2029\\u202eevil\\u200b\\ufeff\\u00ad\\u2060\\u{e0041}",
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

  it("renders release and catalog results for humans and machines (SPEC-010)", () => {
    const context = {
      config: { name: "Versioned\u001b[31m" },
    } as unknown as ReleaseResult extends { context: infer C } ? C : never;
    const release = {
      bytes: 1234,
      candidates: 3,
      changelog: true,
      components: ["documentation.json", "routes.json"],
      current: "v2",
      digest: "ab".repeat(32),
      directory: ".specra/releases/v2",
      from: "v1",
      unchanged: false,
      version: "v2",
    };
    const promoted = {
      context,
      diagnostics: [],
      ok: true,
      release,
    } as unknown as ReleaseResult;
    const human = formatHumanResult(promoted, "release");
    expect(human).toContain("Specra release v2 promoted.");
    expect(human).toContain("Versioned\\u001b[31m");
    expect(human).toContain(
      "Release: .specra/releases/v2 (documentation.json, routes.json; 1234 bytes)",
    );
    expect(human).toContain("Diff candidates: 3 compared with v1");
    expect(human).toContain("Changelog: published");
    expect(JSON.parse(formatJsonResult(promoted))).toEqual({
      diagnostics: [],
      ok: true,
      release,
    });
    const unchanged = {
      context,
      diagnostics: [
        {
          code: "DIFF_TRUNCATED",
          message: "The structured diff was truncated.",
          severity: "warning",
        },
      ],
      ok: true,
      release: {
        ...release,
        changelog: false,
        from: undefined,
        unchanged: true,
      },
    } as unknown as ReleaseResult;
    const again = formatHumanResult(unchanged, "release");
    expect(again).toContain("already exists with identical content");
    expect(again).toContain("Diff candidates: none (no comparison base)");
    expect(again).toContain("Changelog: none");
    expect(again).toContain("Warnings (1):");

    const catalog = {
      current: "v2",
      releases: [
        {
          changelog: false,
          digest: "cd".repeat(32),
          state: "deprecated",
          version: "v1",
        },
        {
          changelog: true,
          digest: "ef".repeat(32),
          state: "supported",
          version: "v2",
        },
      ],
    };
    const selected = {
      context,
      diagnostics: [],
      ok: true,
      catalog,
    } as unknown as CatalogResult;
    expect(formatHumanResult(selected, "current")).toContain(
      "Specra current release selected.\nCurrent: v2\n  v1 · deprecated\n  v2 (current) · supported · changelog",
    );
    expect(formatHumanResult(selected, "deprecate")).toContain(
      "Specra release deprecated.",
    );
    expect(JSON.parse(formatJsonResult(selected))).toEqual({
      catalog,
      diagnostics: [],
      ok: true,
    });

    const built = {
      artifacts: {
        bytes: 10,
        directory: ".specra/artifacts",
        files: ["documentation.json"],
      },
      candidates: { count: 2, from: "v1", truncated: true },
      content: { assets: 0, pages: 0 },
      context,
      diagnostics: [],
      ingestion: { statistics: { documents: 1, operations: 1, schemas: 0 } },
      ok: true,
      playground: { enabled: false, environments: 0 },
      search: { documents: 1 },
      snippets: { operations: 1, sdkExamples: 0 },
    } as unknown as BuildResult;
    expect(formatHumanResult(built, "build")).toContain(
      "Diff candidates: 2 compared with v1 (truncated) in .specra/candidates/diff.json",
    );
  });

  it("renders a diff grouped by entity with safe labels (SPEC-011)", () => {
    const context = { config: { name: "Versioned" } } as never;
    const result = {
      context,
      diagnostics: [],
      diff: {
        candidates: [
          {
            id: "v1..v2:operation-removed:openapi.yaml~getRaw",
            identity: "openapi.yaml~getRaw",
            kind: "operation-removed",
            label: "GET /inboxes/{id}/raw",
            service: "openapi.yaml",
          },
          {
            id: "v1..v2:operation-added:openapi.yaml~wait",
            identity: "openapi.yaml~wait",
            kind: "operation-added",
            label: "POST /inboxes/{id}/wait",
            service: "openapi.yaml",
          },
          {
            changes: [
              { aspect: "deprecated", detail: "deprecated" },
              { aspect: "parameter-added", detail: "query:cursor" },
            ],
            id: "v1..v2:operation-changed:openapi.yaml~list",
            identity: "openapi.yaml~list",
            kind: "operation-changed",
            label: "GET /inboxes",
            service: "openapi.yaml",
          },
          {
            id: "v1..v2:schema-changed:openapi.yaml~Inbox",
            identity: "openapi.yaml~Inbox",
            kind: "schema-changed",
            label: "Inbox\u001b[31m",
            service: "openapi.yaml",
          },
          {
            id: "v1..v2:service-added:second.yaml",
            identity: "second.yaml",
            kind: "service-added",
            label: "Second service",
            service: "second.yaml",
          },
          {
            id: "v1..v2:group-removed:openapi.yaml~Legacy",
            identity: "openapi.yaml~Legacy",
            kind: "group-removed",
            label: "Legacy",
            service: "openapi.yaml",
          },
        ],
        counts: {},
        diffFormat: 1,
        from: "v1",
        to: "v2",
        truncated: false,
      },
      ok: true,
      outcome: "success",
    } as unknown as DiffCommandResult;
    const output = formatHumanResult(result, "diff");
    expect(output).toContain("Specra diff v1 → v2");
    expect(output).toContain("Services:");
    expect(output).toContain("+ Second service");
    expect(output).toContain("Groups:");
    expect(output).toContain("- Legacy");
    expect(output).toContain("- GET /inboxes/{id}/raw");
    expect(output).toContain("+ POST /inboxes/{id}/wait");
    expect(output).toContain("~ GET /inboxes");
    expect(output).toContain("parameter-added query:cursor");
    expect(output).toContain("6 change(s)");
    // A hostile label is neutralized like every other untrusted string.
    expect(output).not.toMatch(/\u001b/);
    expect(output).toContain("Inbox\\u001b[31m");

    const empty = formatHumanResult(
      {
        ...(result as never as { context: unknown }),
        diagnostics: [],
        diff: {
          candidates: [],
          counts: {},
          diffFormat: 1,
          from: "v1",
          to: "v1",
          truncated: true,
        },
        ok: true,
        outcome: "success",
      } as unknown as DiffCommandResult,
      "diff",
    );
    expect(empty).toContain("No structural differences.");
    expect(empty).toContain("truncated at the candidate budget");
  });
});
