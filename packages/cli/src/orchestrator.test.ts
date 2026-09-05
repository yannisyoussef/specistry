import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ARTIFACT_DIRECTORY } from "./contracts.js";
import { validateProject } from "./orchestrator.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("validateProject", () => {
  it("loads erasable TypeScript config and creates deterministic context", async () => {
    const project = await createProject();
    const nested = path.join(project, "nested");
    await mkdir(nested);

    const first = await validateProject({ cwd: nested, root: ".." });
    const second = await validateProject({ cwd: project });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const canonicalProject = await realpath(project);
    expect(first.context.config).toEqual(second.context.config);
    expect(first.context.projectRoot).toBe(canonicalProject);
    expect(first.context.paths.artifactRoot).toBe(
      path.join(canonicalProject, ARTIFACT_DIRECTORY),
    );
    expect(first.context.paths).toEqual(second.context.paths);
  });

  it("returns a deeply frozen validated snapshot that mutation cannot drift", async () => {
    const project = await createProject(
      `export default {
        schemaVersion: 1,
        name: "Frozen",
        openapi: ["./openapi.yaml"],
        docs: "./docs",
        branding: { logo: "./openapi.yaml" },
        environments: { production: { baseUrl: "https://api.example.com" } },
      };`,
    );
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { context } = result;
    const before = JSON.stringify(context.config);
    const openapiBefore = [...context.paths.openapi];

    for (const value of [
      context,
      context.config,
      context.config.branding,
      context.config.environments,
      context.config.environments.production,
      context.config.openapi,
      context.config.playground,
      context.paths,
      context.paths.branding,
      context.paths.openapi,
    ]) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    expect(() => {
      // @ts-expect-error -- the public snapshot type is deeply readonly.
      context.config.name = "Mutated";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- nested records are readonly too.
      context.config.environments.production.baseUrl = "https://evil.example";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- nested arrays are readonly tuples of the snapshot.
      context.config.openapi.push("../escape.yaml");
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- confined paths cannot be replaced after derivation.
      context.paths.openapi[0] = "/outside/openapi.yaml";
    }).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error -- the context itself is a frozen record.
      context.config = { ...context.config, docs: "../outside" };
    }).toThrow(TypeError);
    expect(() => {
      Object.assign(context.config.environments, {
        staging: { baseUrl: "https://staging.example" },
      });
    }).toThrow(TypeError);
    expect(Reflect.deleteProperty(context.config, "docs")).toBe(false);
    expect(context.config.docs).toBe("./docs");

    expect(JSON.stringify(context.config)).toBe(before);
    expect(context.paths.openapi).toEqual(openapiBefore);
    expect(context.config.name).toBe("Frozen");
  });

  it("returns stable categories for missing, broken, invalid, and unsupported config", async () => {
    const missing = await makeTemporaryDirectory();
    await expectCodes(validateProject({ cwd: missing }), ["CONFIG_NOT_FOUND"]);

    const broken = await createProject("throw new Error('broken');");
    await expectCodes(validateProject({ cwd: broken }), ["CONFIG_LOAD_FAILED"]);

    const syntaxError = await createProject(
      "export default { schemaVersion: 1, name: ;",
    );
    await expectCodes(validateProject({ cwd: syntaxError }), [
      "CONFIG_LOAD_FAILED",
    ]);

    const invalid = await createProject(
      "export default { schemaVersion: 1, name: '', openapi: './openapi.yaml' };",
    );
    await expectCodes(validateProject({ cwd: invalid }), ["CONFIG_INVALID"]);

    const unsupported = await createProject(
      "export default { schemaVersion: 2, name: 'Future', openapi: './openapi.yaml' };",
    );
    await expectCodes(validateProject({ cwd: unsupported }), [
      "CONFIG_UNSUPPORTED",
    ]);
  });

  it("rejects non-serializable, cyclic, and excessively large config results", async () => {
    const withFunction = await createProject(
      "export default { schemaVersion: 1, name: 'Bad', openapi: './openapi.yaml', extension: () => true };",
    );
    await expectCodes(validateProject({ cwd: withFunction }), [
      "CONFIG_NOT_SERIALIZABLE",
    ]);

    const cyclic = await createProject(
      "const value = { schemaVersion: 1, name: 'Bad', openapi: './openapi.yaml' }; value.self = value; export default value;",
    );
    await expectCodes(validateProject({ cwd: cyclic }), [
      "CONFIG_NOT_SERIALIZABLE",
    ]);

    const large = await createProject(
      "export default { schemaVersion: 1, name: 'x'.repeat(1100000), openapi: './openapi.yaml' };",
    );
    await expectCodes(validateProject({ cwd: large }), [
      "CONFIG_NOT_SERIALIZABLE",
    ]);
  });

  it("contains config process exit and excessive output failures", async () => {
    const exits = await createProject("process.exit(9); export default {};");
    await expectCodes(validateProject({ cwd: exits }), ["CONFIG_LOAD_FAILED"]);

    const noisy = await createProject(
      "while (true) console.log('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');",
    );
    await expectCodes(validateProject({ configTimeoutMs: 5_000, cwd: noisy }), [
      "CONFIG_LOAD_FAILED",
    ]);
  });

  it("hard-stops native blocking work on timeout and supports cancellation", async () => {
    const project = await createProject("while (true) {};");
    const started = performance.now();
    await expectCodes(validateProject({ configTimeoutMs: 100, cwd: project }), [
      "CONFIG_TIMEOUT",
    ]);
    expect(performance.now() - started).toBeLessThan(3_000);

    // The native block sleeps well past the assertion bound: a termination
    // that waited for it would take at least four seconds, so finishing under
    // three proves the stop is hard rather than merely fast.
    const nativeBlock = await createProject(
      `import { execFileSync } from "node:child_process";
       execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 4000)"]);
       export default { schemaVersion: 1, name: "Late", openapi: "./openapi.yaml" };`,
    );
    const nativeStarted = performance.now();
    await expectCodes(
      validateProject({ configTimeoutMs: 100, cwd: nativeBlock }),
      ["CONFIG_TIMEOUT"],
    );
    expect(performance.now() - nativeStarted).toBeLessThan(3_000);

    const controller = new AbortController();
    const validation = validateProject({
      configTimeoutMs: 5_000,
      cwd: project,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await expectCodes(validation, ["CANCELLED"]);
  });

  it("reports out-of-range programmatic timeouts as internal failures", async () => {
    const project = await createProject();
    for (const configTimeoutMs of [99, 60_001, 1.5, Number.NaN]) {
      const result = await validateProject({ configTimeoutMs, cwd: project });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.outcome).toBe("internal-failure");
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "INTERNAL_ERROR",
      ]);
    }
  });

  it("does not re-evaluate parent NODE_OPTIONS in the config process", async () => {
    const project = await createProject();
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = "--require=/definitely/not/specra.cjs";
    try {
      await expect(validateProject({ cwd: project })).resolves.toEqual(
        expect.objectContaining({ ok: true }),
      );
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
  });

  it("terminates ordinary descendants after a successful config result", async () => {
    const project = await makeTemporaryDirectory();
    const marker = path.join(project, "orphan-marker");
    await mkdir(path.join(project, "docs"));
    await writeFile(path.join(project, "openapi.yaml"), "openapi: 3.1.0\n");
    await writeFile(
      path.join(project, "specra.config.ts"),
      `import { spawn } from "node:child_process";
       spawn(process.execPath, ["-e", ${JSON.stringify(
         `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "orphan"), 400)`,
       )}], { stdio: "ignore" });
       export default { schemaVersion: 1, name: "Contained", openapi: "./openapi.yaml" };`,
    );

    await expect(validateProject({ cwd: project })).resolves.toEqual(
      expect.objectContaining({ ok: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 650));
    await expect(access(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects traversal, absolute Windows paths, missing paths, and wrong types", async () => {
    const traversal = await createProject(
      "export default { schemaVersion: 1, name: 'Bad', openapi: '../outside.yaml' };",
    );
    await expectCodes(validateProject({ cwd: traversal }), ["CONFIG_INVALID"]);

    const windows = await createProject(
      "export default { schemaVersion: 1, name: 'Bad', openapi: 'C:\\\\outside.yaml' };",
    );
    await expectCodes(validateProject({ cwd: windows }), ["CONFIG_INVALID"]);

    const missing = await createProject(undefined, { createOpenapi: false });
    await expectCodes(validateProject({ cwd: missing }), [
      "CONFIG_PATH_NOT_FOUND",
    ]);

    const wrongType = await createProject();
    await rm(path.join(wrongType, "openapi.yaml"));
    await mkdir(path.join(wrongType, "openapi.yaml"));
    await expectCodes(validateProject({ cwd: wrongType }), [
      "CONFIG_PATH_INVALID",
    ]);
  });

  it("orders multiple path diagnostics deterministically", async () => {
    const project = await createProject(
      `export default {
        schemaVersion: 1,
        name: "Missing paths",
        openapi: ["./missing-b.yaml", "./missing-a.yaml"],
        docs: "./missing-docs"
      };`,
    );
    const first = await validateProject({ cwd: project });
    const second = await validateProject({ cwd: project });
    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
        "docs",
        "openapi[0]",
        "openapi[1]",
      ]);
    }
  });

  it("resolves portable forward- and backslash-relative paths", async () => {
    const project = await makeTemporaryDirectory();
    await mkdir(path.join(project, "contracts"));
    await mkdir(path.join(project, "guides", "docs"), { recursive: true });
    await writeFile(
      path.join(project, "contracts", "openapi.yaml"),
      "openapi: 3.1.0\n",
    );
    await writeFile(
      path.join(project, "specra.config.ts"),
      `export default {
        schemaVersion: 1,
        name: "Portable paths",
        openapi: "contracts\\\\openapi.yaml",
        docs: "guides/docs"
      };`,
    );
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context.paths.openapi).toEqual([
        path.join(await realpath(project), "contracts", "openapi.yaml"),
      ]);
    }
  });

  it("rejects invalid roots and config symlinks that escape the root", async () => {
    const missingRoot = path.join(await makeTemporaryDirectory(), "missing");
    await expectCodes(validateProject({ root: missingRoot }), [
      "PROJECT_ROOT_INVALID",
    ]);

    const outside = await createProject();
    const project = await createProject();
    await rm(path.join(project, "specra.config.ts"));
    await symlink(
      path.join(outside, "specra.config.ts"),
      path.join(project, "specra.config.ts"),
      "file",
    );
    await expectCodes(validateProject({ cwd: project }), [
      "CONFIG_PATH_OUTSIDE_ROOT",
    ]);
  });

  it("fails closed on source and artifact symlink escapes", async () => {
    const outside = await makeTemporaryDirectory();
    await mkdir(path.join(outside, "docs"));

    const docsEscape = await createProject();
    await rm(path.join(docsEscape, "docs"), { recursive: true });
    await symlink(
      path.join(outside, "docs"),
      path.join(docsEscape, "docs"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expectCodes(validateProject({ cwd: docsEscape }), [
      "CONFIG_PATH_OUTSIDE_ROOT",
    ]);

    const artifactEscape = await createProject();
    await symlink(
      outside,
      path.join(artifactEscape, ".specra"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = await validateProject({ cwd: artifactEscape });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "CONFIG_PATH_OUTSIDE_ROOT",
          path: "artifacts",
        }),
      );
    }
  });

  it("rejects a regular file blocking the artifact directory", async () => {
    const project = await createProject();
    await writeFile(path.join(project, ".specra"), "not a directory");
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "CONFIG_PATH_INVALID",
          path: "artifacts",
        }),
      );
    }
  });

  it("does not create artifact directories during validation", async () => {
    const project = await createProject();
    const result = await validateProject({ cwd: project });
    expect(result.ok).toBe(true);
    await expect(
      import("node:fs/promises").then(async ({ stat }) => {
        await stat(path.join(project, ".specra"));
      }),
    ).rejects.toThrow();
  });
});

async function createProject(
  configSource = `
    import { defineConfig } from "@specra/config";
    const projectName: string = "Example API";
    export default defineConfig({
      schemaVersion: 1,
      name: projectName,
      openapi: "././openapi.yaml",
      docs: "./docs",
    });
  `,
  options: { readonly createOpenapi?: boolean } = {},
): Promise<string> {
  const project = await makeTemporaryDirectory();
  await mkdir(path.join(project, "docs"));
  if (options.createOpenapi !== false) {
    await writeFile(path.join(project, "openapi.yaml"), "openapi: 3.1.0\n");
  }
  await writeFile(path.join(project, "specra.config.ts"), configSource);
  return project;
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "specra-cli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function expectCodes(
  resultPromise: ReturnType<typeof validateProject>,
  codes: readonly string[],
): Promise<void> {
  const result = await resultPromise;
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      codes,
    );
  }
}
