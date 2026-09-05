import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMemoryAcquisition, type SourceAcquisition } from "./index.js";

const fixtureRoot = fileURLToPath(
  new URL("../../../tests/fixtures/openapi/", import.meta.url),
);

/** Reads one fixture file as the sole document of an in-memory project. */
export function fixtureAcquisition(
  name: string,
  entryId = name,
): SourceAcquisition {
  return createMemoryAcquisition(entryId, {
    [entryId]: readFileSync(path.join(fixtureRoot, name)),
  });
}

/** Reads a fixture directory tree into an in-memory project rooted at `entry`. */
export function fixtureDirectoryAcquisition(
  directory: string,
  entry: string,
): SourceAcquisition {
  const base = path.join(fixtureRoot, directory);
  const files: Record<string, Uint8Array> = {};
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else
        files[path.relative(base, full).split(path.sep).join("/")] =
          readFileSync(full);
    }
  };
  walk(base);
  return createMemoryAcquisition(entry, files);
}

export function fixtureText(name: string): string {
  return readFileSync(path.join(fixtureRoot, name), "utf8");
}

/** Builds an in-memory 3.1 project from an inline document object. */
export function inlineAcquisition(
  document: Readonly<Record<string, unknown>>,
  entryId = "openapi.yaml",
  extra: Readonly<Record<string, string>> = {},
): SourceAcquisition {
  return createMemoryAcquisition(entryId, {
    [entryId]: JSON.stringify(document),
    ...extra,
  });
}
