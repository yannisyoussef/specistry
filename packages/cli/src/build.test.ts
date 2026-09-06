import { createServer, type Server } from "node:http";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DEFAULT_INGESTION_LIMITS } from "@specra/openapi";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { EXIT_CODES } from "./contracts.js";
import { runIngestionIsolated } from "./ingestion-loader.js";
import {
  buildProject,
  createBuildContext,
  validateProject,
} from "./orchestrator.js";

const fixtureRoot = fileURLToPath(
  new URL("../../../tests/fixtures/openapi/", import.meta.url),
);
const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
  }
});

const VALID = `openapi: 3.1.0
info:
  title: Example
  version: 1.0.0
paths:
  /ping:
    get:
      operationId: ping
      responses:
        "200":
          description: ok
`;

describe("buildProject", () => {
  it("writes deterministic canonical artifacts atomically and reproducibly", async () => {
    const project = await createProject(VALID);
    const first = await buildProject({ cwd: project });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.artifacts).toEqual({
      bytes: expect.any(Number),
      directory: ".specra/artifacts",
      files: [
        "documentation.json",
        "manifest.json",
        "search.json",
        "snippets.json",
        "playground.json",
      ],
    });
    expect(first.ingestion.statistics).toEqual({
      documents: 1,
      operations: 1,
      references: 0,
      schemas: 0,
    });
    const artifactDirectory = path.join(project, ".specra", "artifacts");
    expect((await readdir(artifactDirectory)).sort()).toEqual([
      "documentation.json",
      "manifest.json",
      "playground.json",
      "search.json",
      "snippets.json",
    ]);
    expect(await readdir(path.join(project, ".specra"))).toEqual(["artifacts"]);
    const documentation = await readFile(
      path.join(artifactDirectory, "documentation.json"),
      "utf8",
    );
    const manifest = await readFile(
      path.join(artifactDirectory, "manifest.json"),
      "utf8",
    );
    expect(JSON.parse(manifest)).toEqual({
      artifactFormat: 1,
      diagnostics: { errors: 0, warnings: 0 },
      files: {
        documentation: "documentation.json",
        playground: "playground.json",
        search: "search.json",
        snippets: "snippets.json",
      },
      generator: "specra",
      modelVersion: 1,
      project: { id: "Example", name: "Example" },
      search: {
        bytes: expect.any(Number) as number,
        documents: 2,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        version: 1,
      },
      playground: {
        bytes: expect.any(Number) as number,
        enabled: false,
        environments: 0,
        operations: 1,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        version: 1,
      },
      snippets: {
        bytes: expect.any(Number) as number,
        operations: 1,
        sdkExamples: 0,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        version: 1,
      },
      sources: [
        {
          bytes: Buffer.byteLength(VALID),
          path: "openapi.yaml",
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      ],
      statistics: { documents: 1, operations: 1, references: 0, schemas: 0 },
    });
    expect(documentation).not.toContain(project);
    expect(manifest).not.toContain(project);

    const second = await buildProject({ cwd: project });
    expect(second.ok).toBe(true);
    expect(
      await readFile(
        path.join(artifactDirectory, "documentation.json"),
        "utf8",
      ),
    ).toBe(documentation);
    expect(
      await readFile(path.join(artifactDirectory, "manifest.json"), "utf8"),
    ).toBe(manifest);

    const elsewhere = await createProject(VALID, "specra-elsewhere-");
    const third = await buildProject({ cwd: elsewhere });
    expect(third.ok).toBe(true);
    expect(
      await readFile(
        path.join(elsewhere, ".specra", "artifacts", "documentation.json"),
        "utf8",
      ),
    ).toBe(documentation);
    expect(
      await readFile(
        path.join(elsewhere, ".specra", "artifacts", "manifest.json"),
        "utf8",
      ),
    ).toBe(manifest);
  });

  it("removes stale artifacts when a later build fails and refuses symlinked artifact roots", async () => {
    const project = await createProject(VALID);
    expect((await buildProject({ cwd: project })).ok).toBe(true);
    await writeFile(path.join(project, "openapi.yaml"), "openapi: 2.0.0\n");
    const failed = await buildProject({ cwd: project });
    expect(failed.ok).toBe(false);
    expect(failed.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "SOURCE_UNSUPPORTED_VERSION",
    ]);
    await expect(
      lstat(path.join(project, ".specra", "artifacts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(path.join(project, ".specra"))).toEqual([]);

    await writeFile(path.join(project, "openapi.yaml"), VALID);
    const inside = path.join(project, "elsewhere");
    await mkdir(inside);
    await symlink(
      inside,
      path.join(project, ".specra", "artifacts"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const refused = await buildProject({ cwd: project });
    expect(refused).toMatchObject({
      diagnostics: [expect.objectContaining({ code: "ARTIFACT_WRITE_FAILED" })],
      ok: false,
      outcome: "internal-failure",
    });
    expect(await readdir(inside)).toEqual([]);
  });

  it("validates real sources: warnings succeed, errors fail with source pointers", async () => {
    const warnings = await createProject(
      await readFile(
        path.join(fixtureRoot, "adversarial", "webhooks-callbacks.yaml"),
        "utf8",
      ),
    );
    const warned = await validateProject({ cwd: warnings });
    expect(warned.ok).toBe(true);
    if (!warned.ok) return;
    expect(
      warned.diagnostics.map((diagnostic) => [
        diagnostic.severity,
        diagnostic.path,
      ]),
    ).toEqual([
      ["warning", "source/openapi.yaml#/paths/~1subscribe/post/callbacks"],
      [
        "warning",
        "source/openapi.yaml#/paths/~1subscribe/post/responses/200/links",
      ],
      ["warning", "source/openapi.yaml#/webhooks"],
    ]);
    const warnedCli = await invoke(["build", "--json"], warnings);
    expect(warnedCli.code).toBe(EXIT_CODES.success);
    expect(warnedCli.stderr).toBe("");
    const output = JSON.parse(warnedCli.stdout);
    expect(output.ok).toBe(true);
    expect(output.diagnostics).toHaveLength(3);
    expect(output.diagnostics[0]).toEqual({
      code: "SOURCE_UNSUPPORTED_SEMANTIC",
      message: expect.any(String),
      path: "source/openapi.yaml#/paths/~1subscribe/post/callbacks",
      severity: "warning",
    });
    const human = await invoke(["validate"], warnings);
    expect(human.code).toBe(EXIT_CODES.success);
    expect(human.stdout).toContain("Warnings (3):");
    expect(human.stdout).toContain(
      "warning SOURCE_UNSUPPORTED_SEMANTIC [source/openapi.yaml#/webhooks]",
    );

    const invalid = await createProject(
      await readFile(
        path.join(fixtureRoot, "adversarial", "invalid-shapes.yaml"),
        "utf8",
      ),
    );
    const failed = await invoke(["validate", "--json"], invalid);
    expect(failed.code).toBe(EXIT_CODES.validationFailure);
    const failure = JSON.parse(failed.stdout);
    expect(failure.ok).toBe(false);
    expect(failure.diagnostics[0]).toEqual({
      code: "SOURCE_INVALID",
      message: expect.any(String),
      path: "source/openapi.yaml#/paths/~1bad-status/get/responses/2xx",
      severity: "error",
    });
    const humanFailure = await invoke(["build"], invalid);
    expect(humanFailure.code).toBe(EXIT_CODES.validationFailure);
    expect(humanFailure.stdout).toBe("");
    expect(humanFailure.stderr).toContain("Specra build failed");
    expect(humanFailure.stderr).toContain(
      "SOURCE_INVALID [source/openapi.yaml#/paths/~1no-responses/get/responses]",
    );
  });

  it("ingests multi-file projects through the confined acquisition policy", async () => {
    const project = await makeTemporaryDirectory();
    await cp(path.join(fixtureRoot, "refs"), project, { recursive: true });
    await mkdir(path.join(project, "docs"));
    await writeFile(
      path.join(project, "specra.config.ts"),
      "export default { schemaVersion: 1, name: 'Refs', openapi: './root.yaml' };",
    );
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ingestion.sources.map((source) => source.path)).toEqual([
      "nested/address.yaml",
      "nested/deeper/country.yaml",
      "root.yaml",
      "schemas/user.yaml",
    ]);
    expect(result.ingestion.statistics.documents).toBe(4);

    const outside = await makeTemporaryDirectory();
    await writeFile(path.join(outside, "user.yaml"), "type: string\n");
    await rm(path.join(project, "schemas", "user.yaml"));
    await symlink(
      path.join(outside, "user.yaml"),
      path.join(project, "schemas", "user.yaml"),
      "file",
    );
    const escaped = await validateProject({ cwd: project });
    expect(escaped.ok).toBe(false);
    expect(
      escaped.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.path,
      ]),
    ).toEqual([
      [
        "SOURCE_REFERENCE_OUTSIDE_ROOT",
        "source/root.yaml#/components/responses/Users/content/application~1json/schema/items/$ref",
      ],
    ]);
  });

  it("never fetches remote references during a normal build", async () => {
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.end("type: string\n");
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    const port =
      typeof address === "object" && address !== null ? address.port : 0;
    const project = await createProject(`openapi: 3.1.0
info: { title: Remote, version: 1.0.0 }
paths: {}
components:
  schemas:
    Remote:
      $ref: "http://127.0.0.1:${port}/schema.yaml#/x"
    Secure:
      $ref: "https://127.0.0.1:${port}/schema.yaml"
`);
    const result = await buildProject({ cwd: project });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "SOURCE_REFERENCE_REMOTE_DISABLED",
      "SOURCE_REFERENCE_REMOTE_DISABLED",
    ]);
    expect(requests).toBe(0);
    expect(JSON.stringify(result)).not.toContain(String(port));
  });

  it("maps ingestion host failures, spoofed frames, and timeouts to stable diagnostics", async () => {
    const project = await createProject(VALID);
    const projectRoot = await realpath(project);
    const request = {
      entries: ["openapi.yaml"],
      limits: DEFAULT_INGESTION_LIMITS,
      project: { name: "Example" },
      projectRoot,
      signal: new AbortController().signal,
      timeoutMs: 5_000,
    };
    const hang = await host(
      project,
      "hang.mjs",
      "setInterval(() => {}, 1000);",
    );
    await expect(
      runIngestionIsolated({ ...request, hostModule: hang, timeoutMs: 100 }),
    ).resolves.toEqual({ ok: false, reason: "timeout" });

    const crash = await host(project, "crash.mjs", "process.exit(3);");
    await expect(
      runIngestionIsolated({ ...request, hostModule: crash }),
    ).resolves.toEqual({ ok: false, reason: "failed" });

    const spoof = await host(
      project,
      "spoof.mjs",
      `import { writeSync } from "node:fs";
       writeSync(3, JSON.stringify({ type: "result", ok: true, cancelled: false, diagnostics: [], artifactDiagnostics: [], sources: [], statistics: { documents: 1, operations: 0, references: 0, schemas: 0 }, artifactJson: JSON.stringify({ model: { modelVersion: 2 }, diagnostics: [] }) }) + "\\n");
       setInterval(() => {}, 1000);`,
    );
    await expect(
      runIngestionIsolated({ ...request, hostModule: spoof }),
    ).resolves.toEqual({ ok: false, reason: "failed" });

    const leak = await host(
      project,
      "leak.mjs",
      `import { writeSync } from "node:fs";
       writeSync(3, JSON.stringify({ type: "result", ok: false, cancelled: false, diagnostics: [{ code: "SOURCE_INVALID", severity: "error", document: "${projectRoot.replaceAll("\\", "\\\\")}/openapi.yaml", pointer: "" }], artifactDiagnostics: [], sources: [], statistics: { documents: 1, operations: 0, references: 0, schemas: 0 } }) + "\\n");
       setInterval(() => {}, 1000);`,
    );
    await expect(
      runIngestionIsolated({ ...request, hostModule: leak }),
    ).resolves.toEqual({ ok: false, reason: "failed" });

    const genuine = await runIngestionIsolated(request);
    expect(genuine.ok).toBe(true);
  });

  it("times out and cancels slow ingestion without leaving artifacts behind", async () => {
    const project = await createProject(VALID);
    expect((await buildProject({ cwd: project })).ok).toBe(true);
    await writeFile(path.join(project, "openapi.yaml"), slowDocument());

    const timedOut = await buildProject({ cwd: project, sourceTimeoutMs: 100 });
    expect(timedOut).toMatchObject({
      ok: false,
      outcome: "validation-failure",
    });
    expect(
      timedOut.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.path,
      ]),
    ).toEqual([["INGESTION_TIMEOUT", "source/openapi.yaml"]]);
    await expect(
      lstat(path.join(project, ".specra", "artifacts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(path.join(project, ".specra"))).toEqual([]);

    const aborter = new AbortController();
    const abortTimer = setTimeout(() => aborter.abort(), 300);
    await expect(
      runIngestionIsolated({
        entries: ["openapi.yaml"],
        limits: DEFAULT_INGESTION_LIMITS,
        project: { name: "Example" },
        projectRoot: await realpath(project),
        signal: aborter.signal,
        timeoutMs: 30_000,
      }),
    ).resolves.toEqual({ ok: false, reason: "cancelled" });
    clearTimeout(abortTimer);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 700);
    const cancelled = await buildProject({
      cwd: project,
      signal: controller.signal,
    });
    clearTimeout(timer);
    expect(cancelled.outcome).toBe("cancelled");
    expect(cancelled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "CANCELLED",
    ]);
    expect(await readdir(path.join(project, ".specra"))).toEqual([]);
  }, 30_000);

  it("fails closed when the artifact path is a file or its parent is read-only", async () => {
    const project = await createProject(VALID);
    const specra = path.join(project, ".specra");
    await mkdir(specra);
    await writeFile(path.join(specra, "artifacts"), "not a directory");
    // A regular file at the artifact path is caught while the build context
    // is created, before any ingestion or write is attempted.
    const blocked = await buildProject({ cwd: project });
    expect(blocked).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          code: "CONFIG_PATH_INVALID",
          path: "artifact",
        }),
      ],
      ok: false,
      outcome: "validation-failure",
    });
    expect(await readFile(path.join(specra, "artifacts"), "utf8")).toBe(
      "not a directory",
    );
    expect(await readdir(specra)).toEqual(["artifacts"]);
    await rm(path.join(specra, "artifacts"));

    expect((await buildProject({ cwd: project })).ok).toBe(true);
    const documentation = await readFile(
      path.join(specra, "artifacts", "documentation.json"),
      "utf8",
    );
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    await writeFile(
      path.join(project, "openapi.yaml"),
      VALID.replace("operationId: ping", "operationId: pong"),
    );
    await chmod(specra, 0o500);
    try {
      const readOnly = await buildProject({ cwd: project });
      expect(readOnly).toMatchObject({
        ok: false,
        outcome: "internal-failure",
      });
      expect(readOnly.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        ["ARTIFACT_WRITE_FAILED"],
      );
    } finally {
      await chmod(specra, 0o700);
    }
    expect(
      await readFile(
        path.join(specra, "artifacts", "documentation.json"),
        "utf8",
      ),
    ).toBe(documentation);
    expect(await readdir(specra)).toEqual(["artifacts"]);
  });

  it("keeps createBuildContext free of ingestion and honours cancellation", async () => {
    const project = await createProject("not: valid openapi");
    const context = await createBuildContext({ cwd: project });
    expect(context.ok).toBe(true);
    if (context.ok) {
      expect(context.context.paths.openapi).toHaveLength(1);
      expect("ingestion" in context).toBe(false);
    }
    const validated = await validateProject({ cwd: project });
    expect(validated.ok).toBe(false);
    expect(validated.diagnostics[0]?.code).toBe("SOURCE_UNSUPPORTED_VERSION");

    const controller = new AbortController();
    controller.abort();
    const cancelled = await buildProject({
      cwd: project,
      signal: controller.signal,
    });
    expect(cancelled.outcome).toBe("cancelled");
  });
});

/**
 * A valid, node-dense document (about 9 MiB, 120,000 described properties)
 * that takes the ingestion host well over a second to parse, so timeouts and
 * cancellation can be observed while ingestion is genuinely running.
 */
function slowDocument(): string {
  const properties: Record<string, unknown> = {};
  for (let index = 0; index < 120_000; index += 1) {
    properties[`p${index}`] = {
      description: `Property ${index}`,
      maxLength: 64,
      type: "string",
    };
  }
  return JSON.stringify({
    components: { schemas: { Dense: { properties, type: "object" } } },
    info: { title: "Slow", version: "1.0.0" },
    openapi: "3.1.0",
    paths: {
      "/dense": {
        get: {
          operationId: "readDense",
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Dense" },
                },
              },
              description: "ok",
            },
          },
        },
      },
    },
  });
}

async function host(
  project: string,
  name: string,
  source: string,
): Promise<URL> {
  const file = path.join(project, name);
  await writeFile(file, source);
  return pathToFileURL(file);
}

async function invoke(
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stderr: string; stdout: string }> {
  let stderr = "";
  let stdout = "";
  const code = await runCli(args, {
    cwd,
    signal: new AbortController().signal,
    stderr: {
      write(value) {
        stderr += value;
      },
    },
    stdout: {
      write(value) {
        stdout += value;
      },
    },
  });
  return { code, stderr, stdout };
}

async function createProject(
  openapi: string,
  prefix = "specra-build-",
): Promise<string> {
  const project = await makeTemporaryDirectory(prefix);
  await mkdir(path.join(project, "docs"));
  await writeFile(path.join(project, "openapi.yaml"), openapi);
  await writeFile(
    path.join(project, "specra.config.ts"),
    "export default { schemaVersion: 1, name: 'Example', openapi: './openapi.yaml' };",
  );
  return project;
}

async function makeTemporaryDirectory(
  prefix = "specra-build-",
): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}
