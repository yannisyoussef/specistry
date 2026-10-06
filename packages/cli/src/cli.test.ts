import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "./cli.js";
import { EXIT_CODES } from "./contracts.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("runCli", () => {
  it("routes root help, command help, and usage without orchestration output", async () => {
    const rootHelp = await invoke(["--help"]);
    expect(rootHelp).toEqual(
      expect.objectContaining({ code: EXIT_CODES.success, stderr: "" }),
    );
    expect(rootHelp.stdout).toContain("specistry <command>");

    const commandHelp = await invoke(["validate", "--help"]);
    expect(commandHelp.code).toBe(EXIT_CODES.success);
    expect(commandHelp.stdout).toContain("specistry validate [options]");

    const usage = await invoke(["unknown"]);
    expect(usage.code).toBe(EXIT_CODES.usage);
    expect(usage.stdout).toBe("");
    expect(usage.stderr).toContain("Usage error");
  });

  it("projects successful orchestration to human and JSON output", async () => {
    const project = await createProject();
    const human = await invoke(["validate"], project);
    expect(human.code).toBe(EXIT_CODES.success);
    expect(human.stdout).toContain("project is valid");
    expect(human.stderr).toBe("");

    const json = await invoke(["validate", "--json"], project);
    expect(json.code).toBe(EXIT_CODES.success);
    expect(JSON.parse(json.stdout)).toEqual(
      expect.objectContaining({ ok: true }),
    );
  });

  it("projects validation and cancellation failures to the documented streams", async () => {
    const missing = await makeTemporaryDirectory();
    const human = await invoke(["validate"], missing);
    expect(human.code).toBe(EXIT_CODES.validationFailure);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("CONFIG_NOT_FOUND");

    const controller = new AbortController();
    controller.abort();
    const cancelled = await invoke(
      ["validate", "--json"],
      missing,
      controller.signal,
    );
    expect(cancelled.code).toBe(EXIT_CODES.cancelled);
    expect(cancelled.stderr).toBe("");
    expect(JSON.parse(cancelled.stdout).diagnostics[0].code).toBe("CANCELLED");
  });
});

async function invoke(
  args: readonly string[],
  cwd = process.cwd(),
  signal = new AbortController().signal,
): Promise<{ code: number; stderr: string; stdout: string }> {
  let stderr = "";
  let stdout = "";
  const code = await runCli(args, {
    cwd,
    signal,
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

async function createProject(): Promise<string> {
  const project = await makeTemporaryDirectory();
  await mkdir(path.join(project, "docs"));
  await writeFile(
    path.join(project, "openapi.yaml"),
    "openapi: 3.1.0\ninfo:\n  title: Example\n  version: 1.0.0\npaths: {}\n",
  );
  await writeFile(
    path.join(project, "specistry.config.ts"),
    "export default { schemaVersion: 1, name: 'Example', openapi: './openapi.yaml' };",
  );
  return project;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "specistry-cli-unit-"));
  temporaryDirectories.push(directory);
  return directory;
}
