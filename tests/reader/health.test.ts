import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as live } from "../../apps/web/app/healthz/route";
import { GET as ready } from "../../apps/web/app/readyz/route";
import { resetReaderArtifactCache } from "../../apps/web/lib/reader/artifact";
import { resetReleaseCaches } from "../../apps/web/lib/reader/release";

const fixture = path.resolve("tests/fixtures/reader/testinbox");
const previousRoot = process.env.SPECISTRY_PROJECT_ROOT;
const temporary: string[] = [];

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.SPECISTRY_PROJECT_ROOT;
  else process.env.SPECISTRY_PROJECT_ROOT = previousRoot;
  resetReaderArtifactCache();
  resetReleaseCaches();
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("reader health", () => {
  it("keeps liveness minimal and non-cacheable", async () => {
    const response = live();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("proves the configured artifact set is readable", async () => {
    process.env.SPECISTRY_PROJECT_ROOT = fixture;
    const response = await ready();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      mode: "candidate",
      project: "TestInbox",
      status: "ready",
    });
  });

  it("fails closed without exposing the invalid path", async () => {
    const missing = await mkdtemp(path.join(tmpdir(), "specistry-ready-"));
    temporary.push(missing);
    process.env.SPECISTRY_PROJECT_ROOT = missing;
    const response = await ready();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"not-ready"}');
  });
});
