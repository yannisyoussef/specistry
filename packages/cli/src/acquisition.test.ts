import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_INGESTION_LIMITS } from "@specra/openapi";
import { afterEach, describe, expect, it } from "vitest";

import {
  createProjectAcquisition,
  isDocumentId,
  toDocumentId,
} from "./acquisition.js";
import { parseIngestionFrame } from "./ingestion-loader.js";
import { mapIngestionDiagnostics } from "./orchestrator.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("project acquisition policy", () => {
  it("reads confined files and fails closed on every escape", async () => {
    const project = await realpath(
      await makeTemporaryDirectory("specra-acquisition-"),
    );
    const outside = await makeTemporaryDirectory("specra-outside-");
    await mkdir(path.join(project, "schemas"));
    await writeFile(path.join(project, "openapi.yaml"), "openapi: 3.1.0\n");
    await writeFile(path.join(outside, "secret.yaml"), "leak: true\n");
    await symlink(
      path.join(outside, "secret.yaml"),
      path.join(project, "schemas", "linked.yaml"),
      "file",
    );
    const acquisition = createProjectAcquisition(project, "openapi.yaml");
    expect(acquisition.entry).toBe("openapi.yaml");

    const ok = await acquisition.acquire("openapi.yaml", 1_024);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.source.id).toBe("openapi.yaml");
      expect(Buffer.from(ok.source.bytes).toString("utf8")).toBe(
        "openapi: 3.1.0\n",
      );
    }
    await expect(acquisition.acquire("openapi.yaml", 4)).resolves.toEqual({
      ok: false,
      reason: "too-large",
    });
    await expect(acquisition.acquire("missing.yaml", 1_024)).resolves.toEqual({
      ok: false,
      reason: "missing",
    });
    await expect(acquisition.acquire("schemas", 1_024)).resolves.toEqual({
      ok: false,
      reason: "wrong-type",
    });
    await expect(
      acquisition.acquire("schemas/linked.yaml", 1_024),
    ).resolves.toEqual({ ok: false, reason: "outside" });
    for (const id of [
      "../openapi.yaml",
      "/etc/passwd",
      "schemas\\linked.yaml",
      "",
      "./openapi.yaml",
    ]) {
      await expect(acquisition.acquire(id, 1_024)).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });

  it("derives POSIX document ids from configured paths", () => {
    expect(toDocumentId("./openapi.yaml")).toBe("openapi.yaml");
    expect(toDocumentId("contracts\\v1\\openapi.yaml")).toBe(
      "contracts/v1/openapi.yaml",
    );
    expect(toDocumentId("./")).toBeUndefined();
    expect(toDocumentId("a/../b.yaml")).toBeUndefined();
    expect(isDocumentId("ok/file.yaml")).toBe(true);
    expect(isDocumentId("a b.yaml")).toBe(true);
    expect(isDocumentId("x".repeat(1_025))).toBe(false);
    expect(isDocumentId("bad.yaml")).toBe(false);
  });
});

describe("ingestion frame revalidation", () => {
  const base = {
    artifactDiagnostics: [],
    cancelled: false,
    diagnostics: [],
    ok: false,
    sources: [],
    statistics: { documents: 0, operations: 0, references: 0, schemas: 0 },
    type: "result",
  };
  const error = {
    code: "SOURCE_INVALID",
    document: "openapi.yaml",
    pointer: "/info",
    severity: "error",
  };
  const parse = (value: unknown) =>
    parseIngestionFrame(
      Buffer.from(typeof value === "string" ? value : JSON.stringify(value)),
      DEFAULT_INGESTION_LIMITS,
    );

  it("accepts genuine failure frames and maps them onto the CLI grammar", () => {
    const failure = parse({ ...base, diagnostics: [error] });
    expect(failure?.ok).toBe(false);
    expect(failure?.diagnostics).toEqual([error]);
    const modelIssue = parse({
      ...base,
      artifactDiagnostics: [{ code: "INVALID_MODEL", path: "/model" }],
    });
    expect(modelIssue?.artifactDiagnostics).toEqual([
      { code: "INVALID_MODEL", path: "/model" },
    ]);
    expect(
      mapIngestionDiagnostics({
        artifactDiagnostics: [{ code: "INVALID_MODEL", path: "/model" }],
        diagnostics: [
          {
            code: "SOURCE_UNSUPPORTED_SEMANTIC",
            document: "openapi.yaml",
            pointer: "/webhooks",
            severity: "warning",
          },
          { ...error, code: "SOURCE_INVALID", severity: "error" },
        ],
      }).map((diagnostic) => [
        diagnostic.severity,
        diagnostic.code,
        diagnostic.path,
      ]),
    ).toEqual([
      ["error", "ARTIFACT_INVALID", "artifact#/model"],
      ["error", "SOURCE_INVALID", "source/openapi.yaml#/info"],
      [
        "warning",
        "SOURCE_UNSUPPORTED_SEMANTIC",
        "source/openapi.yaml#/webhooks",
      ],
    ]);
  });

  it("rejects malformed, spoofed, oversized, and leaking frames", () => {
    const rejected: unknown[] = [
      "",
      "not json",
      { ...base, type: "other" },
      { ...base, extra: 1 },
      { ...base, ok: "yes" },
      { ...base, cancelled: true },
      base,
      { ...base, ok: true },
      { ...base, artifactJson: "{}", diagnostics: [error], ok: true },
      { ...base, artifactJson: 42, ok: true },
      {
        ...base,
        artifactJson: JSON.stringify({ diagnostics: [], model: {} }),
        ok: true,
      },
      {
        ...base,
        artifactDiagnostics: [{ code: "X_Y", path: "/a" }],
        artifactJson: "{}",
        ok: true,
      },
      { ...base, diagnostics: [{ ...error, code: "NOT_A_CODE" }] },
      { ...base, diagnostics: [{ ...error, severity: "info" }] },
      { ...base, diagnostics: [{ ...error, document: "/abs/openapi.yaml" }] },
      { ...base, diagnostics: [{ ...error, document: "../openapi.yaml" }] },
      { ...base, diagnostics: [{ ...error, pointer: "info" }] },
      { ...base, diagnostics: [{ ...error, pointer: "/bad~2" }] },
      { ...base, diagnostics: [{ ...error, extra: true }] },
      {
        ...base,
        artifactDiagnostics: [{ code: "bad", path: "/x" }],
        diagnostics: [error],
      },
      {
        ...base,
        artifactDiagnostics: [{ code: "INVALID_MODEL", path: "" }],
        diagnostics: [error],
      },
      {
        ...base,
        diagnostics: [error],
        sources: [{ bytes: -1, id: "a.yaml", sha256: "0".repeat(64) }],
      },
      {
        ...base,
        diagnostics: [error],
        sources: [{ bytes: 1, id: "a.yaml", sha256: "zz" }],
      },
      {
        ...base,
        diagnostics: [error],
        sources: [{ bytes: 1, id: "/a.yaml", sha256: "0".repeat(64) }],
      },
      { ...base, diagnostics: [error], statistics: { documents: 1 } },
      {
        ...base,
        diagnostics: [error],
        statistics: { ...base.statistics, documents: -1 },
      },
      {
        ...base,
        diagnostics: Array.from(
          { length: DEFAULT_INGESTION_LIMITS.maxDiagnostics + 1 },
          () => error,
        ),
      },
    ];
    for (const frame of rejected) {
      expect(parse(frame), JSON.stringify(frame).slice(0, 80)).toBeUndefined();
    }
  });
});

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
