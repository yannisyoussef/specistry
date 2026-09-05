import { readFile, stat } from "node:fs/promises";

import type { SourceAcquisition } from "@specra/openapi";

import { resolveExistingProjectPath } from "./path-policy.js";

const DOCUMENT_ID =
  /^(?!\.\.?(?:\/|$))[^\0/\\]+(?:\/(?!\.\.?(?:\/|$))[^\0/\\]+)*$/;

/**
 * The CLI-owned acquisition policy: the only way OpenAPI bytes reach the
 * adapter. Every id is a project-relative POSIX path that the adapter has
 * already confined lexically; this implementation re-confines it physically
 * through the SPEC-002 path policy (portable separators, canonical root,
 * symlink-aware real path, required file type) and enforces the byte ceiling
 * before and after reading, so a file replaced between checks still fails
 * closed.
 */
export function createProjectAcquisition(
  projectRoot: string,
  entry: string,
): SourceAcquisition {
  return {
    async acquire(id, maxBytes) {
      if (!isDocumentId(id)) return { ok: false, reason: "invalid" };
      const resolved = await resolveExistingProjectPath(
        projectRoot,
        id,
        "file",
      );
      if (!resolved.ok) return { ok: false, reason: resolved.kind };
      try {
        const metadata = await stat(resolved.path);
        if (metadata.size > maxBytes) return { ok: false, reason: "too-large" };
        const bytes = await readFile(resolved.path);
        if (bytes.byteLength > maxBytes) {
          return { ok: false, reason: "too-large" };
        }
        return { ok: true, source: { bytes: new Uint8Array(bytes), id } };
      } catch {
        return { ok: false, reason: "invalid" };
      }
    },
    entry,
  };
}

/** Converts a validated configured path into the adapter's POSIX document id. */
export function toDocumentId(configuredPath: string): string | undefined {
  const segments = configuredPath
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0 && segment !== ".");
  const id = segments.join("/");
  return isDocumentId(id) ? id : undefined;
}

export function isDocumentId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 1_024 &&
    DOCUMENT_ID.test(value) &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}
