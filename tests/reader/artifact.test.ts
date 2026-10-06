import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  ReaderArtifactError,
  loadReaderArtifact,
  projectRoot,
  readReaderArtifact,
  resetReaderArtifactCache,
} from "../../apps/web/lib/reader/artifact";

const fixtureRoot = fileURLToPath(
  new URL("../fixtures/reader/", import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  resetReaderArtifactCache();
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("reader artifact boundary", () => {
  it("loads and memoizes a valid artifact without exposing machine paths", async () => {
    const root = path.join(fixtureRoot, "testinbox");
    const first = await loadReaderArtifact(root);
    const second = await loadReaderArtifact(root);
    expect(second).toBe(first);
    expect(first.directory).toBe(".specistry/artifacts");
    expect(first.manifest.statistics.operations).toBe(25);
    expect(first.index.operationCount).toBe(25);
    expect(JSON.stringify(first.index)).not.toContain(root);
  });

  it("resolves the project root from the environment or the working directory", () => {
    expect(projectRoot({})).toBe(path.resolve(process.cwd()));
    expect(projectRoot({ SPECISTRY_PROJECT_ROOT: "" })).toBe(
      path.resolve(process.cwd()),
    );
    expect(
      projectRoot({ SPECISTRY_PROJECT_ROOT: "tests/fixtures/reader/edge" }),
    ).toBe(path.resolve("tests/fixtures/reader/edge"));
  });

  it("fails with actionable errors for missing, malformed, unsupported, and inconsistent artifacts", async () => {
    const empty = await makeProject();
    await expectFailure(
      empty,
      /No canonical artifact was found at \.specistry\/artifacts\/manifest\.json/,
    );

    const malformed = await makeProject("testinbox");
    await writeFile(
      path.join(malformed, ".specistry/artifacts/manifest.json"),
      "{not json",
    );
    await expectFailure(malformed, /not a supported Specistry manifest/);

    const unsupported = await makeProject("testinbox");
    await patchJson(
      path.join(unsupported, ".specistry/artifacts/manifest.json"),
      (manifest) => ({
        ...manifest,
        modelVersion: 2,
      }),
    );
    await expectFailure(unsupported, /format or model version is unsupported/);

    const broken = await makeProject("testinbox");
    await patchJson(
      path.join(broken, ".specistry/artifacts/documentation.json"),
      (artifact) => ({
        ...artifact,
        model: { ...(artifact.model as object), modelVersion: 2 },
      }),
    );
    await expectFailure(broken, /failed model validation/);

    const mismatched = await makeProject("testinbox");
    await patchJson(
      path.join(mismatched, ".specistry/artifacts/manifest.json"),
      (manifest) => ({
        ...manifest,
        project: { id: "Other", name: "Other" },
      }),
    );
    await expectFailure(mismatched, /describes project "Other"/);

    const inconsistent = await makeProject("testinbox");
    await patchJson(
      path.join(inconsistent, ".specistry/artifacts/manifest.json"),
      (manifest) => ({
        ...manifest,
        statistics: { ...(manifest.statistics as object), operations: 1 },
      }),
    );
    await expectFailure(
      inconsistent,
      /reports 1 operations but the canonical artifact contains 25/,
    );

    const missingDocumentation = await makeProject("testinbox");
    await rm(
      path.join(
        missingDocumentation,
        ".specistry/artifacts/documentation.json",
      ),
    );
    await expectFailure(
      missingDocumentation,
      /No canonical artifact was found at \.specistry\/artifacts\/documentation\.json/,
    );
  });

  it("does not memoize a failed load", async () => {
    const project = await makeProject();
    await expect(loadReaderArtifact(project)).rejects.toBeInstanceOf(
      ReaderArtifactError,
    );
    await cp(
      path.join(fixtureRoot, "edge", ".specistry"),
      path.join(project, ".specistry"),
      {
        recursive: true,
      },
    );
    const loaded = await loadReaderArtifact(project);
    expect(loaded.index.operationCount).toBe(14);
  });
});

async function expectFailure(root: string, pattern: RegExp): Promise<void> {
  const error = await readReaderArtifact(root).then(
    () => undefined,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(ReaderArtifactError);
  expect((error as Error).message).toMatch(pattern);
  expect((error as Error).message).toContain("Run `specistry build`");
  expect((error as Error).message).not.toContain(root);
}

async function makeProject(fixture?: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "specistry-reader-"));
  temporaryDirectories.push(directory);
  if (fixture !== undefined) {
    await cp(
      path.join(fixtureRoot, fixture, ".specistry"),
      path.join(directory, ".specistry"),
      {
        recursive: true,
      },
    );
  } else {
    await mkdir(path.join(directory, ".specistry"));
  }
  return directory;
}

async function patchJson(
  file: string,
  patch: (value: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const value = JSON.parse(await readFile(file, "utf8")) as Record<
    string,
    unknown
  >;
  await writeFile(file, JSON.stringify(patch(value)));
}
