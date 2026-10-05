import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArtifactManifest } from "@specra/model";
import { parseSearchArtifact } from "@specra/search";
import { createSearchClient } from "@specra/search/client";
import { parseSnippetsArtifact } from "@specra/snippets";
import { afterEach, describe, expect, it } from "vitest";

import { buildProject, validateProject } from "../../packages/cli/src/index";

/**
 * Code samples and SDK mappings through the CLI (SPEC-008 §149–§158): the
 * snippets artifact is written and recorded in the manifest, authored SDK
 * examples resolve to canonical operation identity (contract id, or method
 * and path with the service for multi-service projects), every mapping
 * error is a stable, value-free, project-relative diagnostic, and the
 * output is byte-identical across parents and processes.
 */

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/reader/", import.meta.url),
);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function copyFixture(name: string): Promise<string> {
  const parent = await realpath(
    await mkdtemp(path.join(tmpdir(), "specra-snippets-")),
  );
  temporary.push(parent);
  const project = path.join(parent, name);
  await cp(path.join(fixtureRoot, name), project, {
    filter: (entry) => !entry.includes(`${path.sep}.specra`),
    recursive: true,
  });
  return project;
}

function summary(
  diagnostics: readonly {
    readonly code: string;
    readonly path?: string;
    readonly severity: string;
  }[],
): readonly string[] {
  return diagnostics.map(
    (diagnostic) =>
      `${diagnostic.severity[0]} ${diagnostic.code} ${diagnostic.path ?? "-"}`,
  );
}

const MULTI_OPENAPI = '["./apis/v1/accounts.yaml", "./apis/v1/billing.yaml"]';

async function writeConfig(
  project: string,
  sdks: string,
  openapi = MULTI_OPENAPI,
): Promise<void> {
  await writeFile(
    path.join(project, "specra.config.ts"),
    `export default { schemaVersion: 1, name: "Mapped", openapi: ${openapi}, sdks: ${sdks} };`,
  );
}

describe("specra build with code samples and SDK mappings", () => {
  it("writes snippets.json with projections, environments, and highlighted SDK examples", async () => {
    const project = await copyFixture("testinbox");
    const result = await buildProject({ cwd: project });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.snippets).toEqual({ operations: 25, sdkExamples: 5 });
    expect(result.artifacts.files).toContain("snippets.json");
    const artifacts = path.join(project, ".specra", "artifacts");
    const manifest = parseArtifactManifest(
      await readFile(path.join(artifacts, "manifest.json"), "utf8"),
    );
    expect(manifest.files.snippets).toBe("snippets.json");
    expect(manifest.snippets).toMatchObject({
      operations: 25,
      sdkExamples: 5,
      version: 1,
    });
    const snippets = parseSnippetsArtifact(
      await readFile(path.join(artifacts, "snippets.json"), "utf8"),
    );
    expect(snippets.environments.map((environment) => environment.id)).toEqual([
      "production",
      "sandbox",
      "local",
      "strict",
    ]);
    expect(snippets.environments[2]?.baseUrl).toBe("http://127.0.0.1:47391/v1");
    expect(snippets.sdks.map((sdk) => sdk.id)).toEqual(["typescript", "java"]);
    const createInbox = snippets.sdkExamples["openapi.yaml~createInbox"] ?? [];
    expect(createInbox.map((example) => example.sdk)).toEqual([
      "typescript",
      "java",
    ]);
    // Authored code is carried verbatim and highlighted at build time.
    expect(createInbox[0]?.code).toContain(
      'import { TestInbox } from "@testinbox/sdk";',
    );
    expect(
      createInbox[0]?.lines.flat().some((token) => token.cls === "kw"),
    ).toBe(true);
    // Method + path targets resolve too (the Java "wait" example).
    expect(
      (snippets.sdkExamples["openapi.yaml~waitForMessage"] ?? []).map(
        (example) => example.sdk,
      ),
    ).toEqual(["typescript", "java"]);
    // Every operation has a projection; none has an invented SDK example.
    expect(Object.keys(snippets.operations)).toHaveLength(25);
    expect(snippets.sdkExamples["openapi.yaml~deleteInbox"]).toBeUndefined();
    // The search index carries the SDK labels for mapped operations only.
    const search = parseSearchArtifact(
      await readFile(path.join(artifacts, "search.json"), "utf8"),
    );
    const client = createSearchClient(search, () => 0);
    expect(
      client.search("typescript sdk create inbox").hits[0]?.document.route,
    ).toBe("/api/inboxes/create-inbox");
    const javaHits = client
      .search("java sdk")
      .hits.slice(0, 4)
      .map((hit) => hit.document.route);
    expect(javaHits).toContain("/api/inboxes/create-inbox");
    expect(javaHits).toContain("/api/inboxes/wait-for-message");
  });

  it("is byte-identical across working directories and processes", async () => {
    const first = await copyFixture("testinbox");
    const second = await copyFixture("testinbox");
    expect((await buildProject({ cwd: first })).ok).toBe(true);
    expect((await buildProject({ cwd: second })).ok).toBe(true);
    for (const file of ["snippets.json", "search.json", "manifest.json"]) {
      const a = await readFile(path.join(first, ".specra", "artifacts", file));
      const b = await readFile(path.join(second, ".specra", "artifacts", file));
      expect(a.equals(b), file).toBe(true);
      expect(a.toString("latin1")).not.toContain(first);
    }
  });

  it("diagnoses unknown, ambiguous, duplicate, empty, oversized, and missing mappings", async () => {
    const project = await copyFixture("multi");
    await mkdir(path.join(project, "sdk"));
    await writeFile(path.join(project, "sdk", "empty.ts"), "   \n\n");
    await writeFile(
      path.join(project, "sdk", "large.ts"),
      "x".repeat(17 * 1_024),
    );
    await writeConfig(
      project,
      `[
        { id: "ts", label: "TypeScript SDK", language: "typescript", coverage: "complete", examples: [
          { operation: "listUsers", code: "client.users.list()" },
          { operation: "nope", code: "client.nope()" },
          { operation: { method: "GET", path: "/users", service: "Accounts API" }, code: "accounts.users.list()" },
          { operation: { method: "GET", path: "/users", service: "Accounts API" }, code: "again()" },
          { operation: "createUser", file: "./sdk/empty.ts" },
          { operation: "getUser", file: "./sdk/large.ts" },
          { operation: "listKeys", file: "./sdk/missing.ts" },
        ] },
        { id: "ts", label: "Duplicate", language: "typescript" },
      ]`,
    );
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(summary(result.diagnostics)).toEqual([
      "e SDK_EXAMPLE_CODE_EMPTY config#/sdks/0/examples/4",
      "e SDK_EXAMPLE_CODE_TOO_LARGE config#/sdks/0/examples/5",
      "e SDK_EXAMPLE_DUPLICATE config#/sdks/0/examples/3",
      "e SDK_EXAMPLE_FILE_INVALID config#/sdks/0/examples/6",
      "e SDK_EXAMPLE_TARGET_AMBIGUOUS config#/sdks/0/examples/0",
      "e SDK_EXAMPLE_TARGET_NOT_FOUND config#/sdks/0/examples/1",
      "e SDK_ID_DUPLICATE config#/sdks/1/id",
      ...[
        "/model/versions/0/services/0/operations/0",
        "/model/versions/0/services/0/operations/2",
        "/model/versions/0/services/0/operations/3",
        "/model/versions/0/services/0/operations/4",
        "/model/versions/0/services/0/operations/5",
        "/model/versions/0/services/1/operations/0",
        "/model/versions/0/services/1/operations/1",
        "/model/versions/0/services/1/operations/2",
        "/model/versions/0/services/1/operations/3",
      ].map((pointer) => `w SDK_EXAMPLE_MISSING artifact#${pointer}`),
    ]);
    // A failed build leaves no artifacts behind.
    const built = await buildProject({ cwd: project });
    expect(built.ok).toBe(false);
    await expect(
      readFile(path.join(project, ".specra", "artifacts", "manifest.json")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports missing mappings for a complete SDK as warnings and still builds", async () => {
    const project = await copyFixture("multi");
    await writeConfig(
      project,
      `[{ id: "go", label: "Go SDK", language: "go", package: "example.com/sdk", coverage: "complete", examples: [
        { operation: { method: "GET", path: "/users", service: "Billing API" }, code: "users, err := client.Users.List(ctx)" },
      ] }]`,
    );
    const result = await buildProject({ cwd: project });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.snippets).toEqual({ operations: 10, sdkExamples: 1 });
    const missing = result.diagnostics.filter(
      (diagnostic) => diagnostic.code === "SDK_EXAMPLE_MISSING",
    );
    expect(missing).toHaveLength(9);
    expect(
      missing.every((diagnostic) => diagnostic.severity === "warning"),
    ).toBe(true);
    const snippets = parseSnippetsArtifact(
      await readFile(
        path.join(project, ".specra", "artifacts", "snippets.json"),
        "utf8",
      ),
    );
    // The service disambiguates two services that both declare GET /users.
    const mapped = Object.entries(snippets.sdkExamples);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.[1][0]?.code).toBe(
      "users, err := client.Users.List(ctx)",
    );
  });

  it("confines example files to the project and validates the examples file shape", async () => {
    const project = await copyFixture("multi");
    const parent = path.dirname(project);
    await mkdir(path.join(project, "sdk"));
    await writeFile(path.join(parent, "outside.ts"), "client.leak()");
    await symlink(
      path.join(parent, "outside.ts"),
      path.join(project, "sdk", "linked.ts"),
    );
    await writeFile(
      path.join(project, "sdk", "bad.json"),
      '{"examples": [{"operation": 5}]}',
    );
    await writeFile(
      path.join(project, "sdk", "ok.json"),
      JSON.stringify({ examples: [] }),
    );
    await writeConfig(
      project,
      `[
        { id: "a", label: "A", language: "python", examples: [{ operation: "listInvoices", file: "./sdk/linked.ts" }] },
        { id: "b", label: "B", language: "python", examples: [{ operation: "listInvoices", file: "../outside.ts" }] },
        { id: "c", label: "C", language: "python", examples: "./sdk/bad.json" },
        { id: "d", label: "D", language: "python", examples: "./sdk/ok.json" },
      ]`,
    );
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(summary(result.diagnostics)).toEqual([
      "e CONFIG_INVALID config#/sdks/1/examples/0/file",
    ]);
    // The relative-path policy rejects the traversal in the schema; the
    // symlink escape and the malformed file are diagnosed once it passes.
    await writeConfig(
      project,
      `[
        { id: "a", label: "A", language: "python", examples: [{ operation: "listInvoices", file: "./sdk/linked.ts" }] },
        { id: "c", label: "C", language: "python", examples: "./sdk/bad.json" },
      ]`,
    );
    const again = await validateProject({ cwd: project });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(summary(again.diagnostics)).toEqual([
      "e SDK_EXAMPLE_FILE_INVALID config#/sdks/0/examples/0",
      "e SDK_EXAMPLE_FILE_INVALID config#/sdks/1/examples",
    ]);
  });

  it("reports unusable contract servers and unrepresentable headers as warnings", async () => {
    const project = await copyFixture("multi");
    await writeFile(
      path.join(project, "openapi.yaml"),
      [
        "openapi: 3.1.0",
        "info: { title: Servers, version: 1.0.0 }",
        "servers:",
        "  - url: /relative",
        "  - url: http://api.example.com",
        "  - url: https://api.example.com",
        "paths:",
        "  /ping:",
        "    get:",
        "      operationId: ping",
        "      parameters:",
        "        - name: Bad Header",
        "          in: header",
        "          schema: { type: string }",
        "      responses:",
        "        '200': { description: ok }",
        "",
      ].join("\n"),
    );
    await writeConfig(project, "[]", '"./openapi.yaml"');
    const result = await validateProject({ cwd: project });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(summary(result.diagnostics)).toEqual([
      "w SNIPPET_HEADER_SKIPPED artifact#/model/versions/0/services/0/operations/0",
      "w SNIPPET_SERVER_UNUSABLE artifact#/model/versions/0/services/0/operations/0",
      "w SNIPPET_SERVER_UNUSABLE artifact#/model/versions/0/services/0/operations/0",
    ]);
  });
});
