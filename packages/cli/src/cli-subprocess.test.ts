import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EXIT_CODES } from "./contracts.js";

const cliPath = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const configHostPath = fileURLToPath(
  new URL("../dist/config-worker.js", import.meta.url),
);
const fixtureRoot = fileURLToPath(
  new URL("../../../tests/fixtures/openapi/", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("packaged specra executable", () => {
  it("does not leave the config host orphaned when the parent disappears", async () => {
    const project = await createProject();
    const host = spawn(
      process.execPath,
      [
        configHostPath,
        import.meta.resolve("@specra/config"),
        pathToFileURL(path.join(project, "specra.config.ts")).href,
      ],
      { stdio: ["ignore", "pipe", "pipe", "pipe"] },
    );
    const control = host.stdio[3] as NodeJS.ReadableStream;
    const frame = await new Promise<string>((resolve) => {
      control.once("data", (chunk: Buffer) => resolve(chunk.toString("utf8")));
    });
    expect(JSON.parse(frame)).toEqual(
      expect.objectContaining({ type: "success" }),
    );

    // Simulate a parent that died without terminating the tree: release the
    // control channel without sending any signal.
    const started = performance.now();
    const exited = new Promise<number | null>((resolve) => {
      host.once("exit", (code) => resolve(code));
    });
    (control as unknown as { destroy(): void }).destroy();
    host.stdout?.destroy();
    host.stderr?.destroy();
    await expect(exited).resolves.toBe(0);
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("exits quietly when a consumer closes stdout early", async () => {
    const project = await createProject();
    const child = spawn(process.execPath, [cliPath, "validate", "--json"], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const status = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });
    expect(status).toBe(EXIT_CODES.success);
    expect(stderr).not.toMatch(/EPIPE|at .*\.js:\d+/);
  });

  it("provides accurate root and command help", () => {
    const root = run(["--help"]);
    expect(root.status).toBe(EXIT_CODES.success);
    expect(root.stdout).toMatch(/^\s+validate\s/m);
    expect(root.stdout).toMatch(/^\s+build\s/m);
    expect(root.stdout).not.toMatch(/^\s+dev\s/m);
    expect(root.stderr).toBe("");

    const command = run(["validate", "--help"]);
    expect(command.status).toBe(EXIT_CODES.success);
    expect(command.stdout).toContain("--root <path>");
    expect(command.stdout).toContain("--json");
    expect(command.stdout).toContain("--source-timeout");
    const build = run(["build", "--help"]);
    expect(build.status).toBe(EXIT_CODES.success);
    expect(build.stdout).toContain("specra build [options]");
    expect(command.stderr).toBe("");
  });

  it("validates from the cwd and an explicit absolute root", async () => {
    const project = await createProject();
    const started = performance.now();
    const fromCwd = run(["validate"], project);
    expect(fromCwd.status).toBe(EXIT_CODES.success);
    expect(fromCwd.stdout).toContain("Specra project is valid.");
    expect(fromCwd.stdout).toContain("Artifacts: .specra/artifacts");
    expect(fromCwd.stderr).toBe("");
    expect(performance.now() - started).toBeLessThan(3_000);

    const explicit = run(["validate", "--root", project], tmpdir());
    expect(explicit.status).toBe(EXIT_CODES.success);
  });

  it("keeps successful and failed JSON isolated on stdout", async () => {
    const valid = await createProject(
      `import { defineConfig } from "@specra/config";
       import { writeSync } from "node:fs";
       console.log("config noise that must not reach stdout");
       writeSync(1, process.env.SPEC_TEST_SECRET ?? "raw stdout noise");
       writeSync(2, "raw stderr noise");
       export default defineConfig({ schemaVersion: 1, name: "Example", openapi: "./openapi.yaml" });`,
    );
    const success = run(["validate", "--json"], valid, {
      SPEC_TEST_SECRET: "SPEC-RAW-FD-CANARY",
    });
    expect(success.status).toBe(EXIT_CODES.success);
    expect(success.stderr).toBe("");
    expect(JSON.parse(success.stdout)).toEqual({
      artifacts: { directory: ".specra/artifacts" },
      content: { assets: 0, pages: 0 },
      search: { documents: expect.any(Number) as number },
      playground: { enabled: false, environments: 0, operations: 0 },
      snippets: { operations: 0, sdkExamples: 0 },
      diagnostics: [],
      ok: true,
      sources: [
        expect.objectContaining({
          bytes: expect.any(Number),
          path: "openapi.yaml",
        }),
      ],
      statistics: { documents: 1, operations: 0, references: 0, schemas: 0 },
    });

    const invalid = await createProject(
      "export default { schemaVersion: 1, name: '', openapi: './openapi.yaml' };",
    );
    const failure = run(["validate", "--json"], invalid);
    expect(failure.status).toBe(EXIT_CODES.validationFailure);
    expect(failure.stderr).toBe("");
    expect(JSON.parse(failure.stdout)).toEqual(
      expect.objectContaining({ ok: false }),
    );
  });

  it("emits concise human failures only on stderr", async () => {
    const project = await makeTemporaryDirectory();
    const result = run(["validate"], project);
    expect(result.status).toBe(EXIT_CODES.validationFailure);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Specra validation failed");
    expect(result.stderr).toContain("CONFIG_NOT_FOUND [config]");
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it.each([
    [[], "A command is required."],
    [["unknown"], "Unknown command."],
    [["validate", "--unknown-option"], "Unknown option."],
    [["validate", "--root"], "--root requires a path value."],
    [
      ["validate", "--root", ".", "--root", "."],
      "--root may be specified only once.",
    ],
    [
      ["validate", "--help", "--json"],
      "--help cannot be combined with other options.",
    ],
    [["validate", "--config-timeout", "1"], "must be between"],
    [["validate", "--json", "--json"], "--json may be specified only once."],
  ] as const)("reports deterministic usage errors", (args, message) => {
    const result = run(args);
    expect(result.status).toBe(EXIT_CODES.usage);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });

  it("redacts environment secrets and config-process error details", async () => {
    const secret = "SPEC-CANARY-do-not-print-4f927e";
    const project = await createProject(
      "throw new Error(process.env.SPEC_TEST_SECRET);",
    );
    const result = run(["validate", "--json"], project, {
      SPEC_TEST_SECRET: secret,
    });
    expect(result.status).toBe(EXIT_CODES.validationFailure);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("CONFIG_LOAD_FAILED");
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).not.toContain("SPEC_TEST_SECRET");

    const spoofed = await createProject(
      `import { writeSync } from "node:fs";
       writeSync(3, JSON.stringify({ type: "failure", category: "invalid", issuePaths: [process.env.SPEC_TEST_SECRET] }) + "\\n");
       while (true) {};`,
    );
    const spoofedResult = run(["validate", "--json"], spoofed, {
      SPEC_TEST_SECRET: secret,
    });
    expect(spoofedResult.status).toBe(EXIT_CODES.validationFailure);
    expect(spoofedResult.stdout).toContain("CONFIG_LOAD_FAILED");
    expect(spoofedResult.stdout).not.toContain(secret);

    const emptySpoof = await createProject(
      `import { writeSync } from "node:fs";
       writeSync(3, JSON.stringify({ type: "failure", category: "invalid", issuePaths: [] }) + "\\n");
       while (true) {};`,
    );
    const emptyResult = run(["validate", "--json"], emptySpoof);
    expect(emptyResult.status).toBe(EXIT_CODES.validationFailure);
    expect(JSON.parse(emptyResult.stdout).diagnostics).toEqual([
      expect.objectContaining({ code: "CONFIG_LOAD_FAILED", path: "config" }),
    ]);
  });

  it("neutralizes terminal control characters from the project name", async () => {
    const project = await createProject(
      `export default { schemaVersion: 1, name: "forged\\u001b]8;;target\\u0007\\rline", openapi: "./openapi.yaml" };`,
    );
    const result = run(["validate"], project);
    expect(result.status).toBe(EXIT_CODES.success);
    expect(result.stdout).not.toContain("\u001b");
    expect(result.stdout).not.toContain("\r");
    expect(result.stdout).toContain("\\u001b");
    expect(result.stdout).toContain("\\u000d");
  });

  it("builds through the executable with isolated stdout and stderr", async () => {
    const project = await createProject();
    const human = run(["build"], project);
    expect(human.status).toBe(EXIT_CODES.success);
    expect(human.stdout).toContain("Specra build succeeded.");
    expect(human.stderr).toBe("");

    const json = run(["build", "--json"], project);
    expect(json.status).toBe(EXIT_CODES.success);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout)).toEqual(
      expect.objectContaining({
        artifacts: expect.objectContaining({
          files: [
            "documentation.json",
            "manifest.json",
            "search.json",
            "snippets.json",
            "playground.json",
          ],
        }),
        ok: true,
      }),
    );

    await writeFile(
      path.join(project, "openapi.yaml"),
      await readFile(
        path.join(fixtureRoot, "adversarial", "invalid-shapes.yaml"),
        "utf8",
      ),
    );
    const failed = run(["build", "--json"], project);
    expect(failed.status).toBe(EXIT_CODES.validationFailure);
    expect(failed.stderr).toBe("");
    expect(JSON.parse(failed.stdout).diagnostics[0].code).toBe(
      "SOURCE_INVALID",
    );
    const humanFailure = run(["build"], project);
    expect(humanFailure.status).toBe(EXIT_CODES.validationFailure);
    expect(humanFailure.stdout).toBe("");
    expect(humanFailure.stderr).toContain("Specra build failed");

    await writeFile(path.join(project, "openapi.yaml"), VALID_DOCUMENT);
    const child = spawn(process.execPath, [cliPath, "build", "--json"], {
      cwd: project,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.destroy();
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const status = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });
    expect(status).toBe(EXIT_CODES.success);
    expect(stderr).not.toMatch(/EPIPE|at .*\.js:\d+/);
  }, 30_000);

  it("times out slow ingestion and cancels it on SIGINT", async () => {
    const project = await createProject();
    await writeFile(path.join(project, "openapi.yaml"), slowDocument());
    const timedOut = run(
      ["build", "--json", "--source-timeout", "100"],
      project,
    );
    expect(timedOut.status).toBe(EXIT_CODES.validationFailure);
    expect(timedOut.stderr).toBe("");
    expect(JSON.parse(timedOut.stdout).diagnostics).toEqual([
      expect.objectContaining({
        code: "INGESTION_TIMEOUT",
        path: "source/openapi.yaml",
      }),
    ]);

    const child = spawn(process.execPath, [cliPath, "build", "--json"], {
      cwd: project,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value: string) => {
      stdout += value;
    });
    child.stderr.setEncoding("utf8").on("data", (value: string) => {
      stderr += value;
    });
    setTimeout(() => child.kill("SIGINT"), 1_000);
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    expect(status).toBe(EXIT_CODES.cancelled);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).diagnostics[0].code).toBe("CANCELLED");
  }, 30_000);

  it("times out a hanging config without leaving the process alive", async () => {
    const project = await createProject("while (true) {};");
    const started = performance.now();
    const result = run(
      ["validate", "--json", "--config-timeout", "100"],
      project,
    );
    expect(result.status).toBe(EXIT_CODES.validationFailure);
    expect(JSON.parse(result.stdout).diagnostics[0].code).toBe(
      "CONFIG_TIMEOUT",
    );
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("translates SIGINT into deterministic cancellation", async () => {
    const project = await createProject("while (true) {};");
    const child = spawn(process.execPath, [cliPath, "validate", "--json"], {
      cwd: project,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (value: string) => {
      stdout += value;
    });
    child.stderr.setEncoding("utf8").on("data", (value: string) => {
      stderr += value;
    });
    setTimeout(() => child.kill("SIGINT"), 200);
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    expect(status).toBe(EXIT_CODES.cancelled);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).diagnostics[0].code).toBe("CANCELLED");
  });
});

function run(
  args: readonly string[],
  cwdOrEnvironment: string | NodeJS.ProcessEnv = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> & { stderr: string; stdout: string } {
  const cwd =
    typeof cwdOrEnvironment === "string" ? cwdOrEnvironment : process.cwd();
  const env =
    typeof cwdOrEnvironment === "string" ? environment : cwdOrEnvironment;
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 5_000,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

const VALID_DOCUMENT =
  "openapi: 3.1.0\ninfo:\n  title: Example\n  version: 1.0.0\npaths: {}\n";

/** About 9 MiB of valid, node-dense JSON: ingestion takes over a second. */
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
    paths: {},
  });
}

async function createProject(configSource?: string): Promise<string> {
  const project = await makeTemporaryDirectory();
  await mkdir(path.join(project, "docs"));
  await writeFile(path.join(project, "openapi.yaml"), VALID_DOCUMENT);
  await writeFile(
    path.join(project, "specra.config.ts"),
    configSource ??
      `import { defineConfig } from "@specra/config";
       export default defineConfig({ schemaVersion: 1, name: "Example", openapi: "./openapi.yaml" });`,
  );
  return project;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "specra-cli-process-"));
  temporaryDirectories.push(directory);
  return directory;
}
