import { open, stat } from "node:fs/promises";
import path from "node:path";

import type { SourceAcquisition } from "@specistry/openapi";

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
        const bytes = await readBounded(resolved.path, maxBytes);
        if (bytes === undefined) return { ok: false, reason: "too-large" };
        const canonicalId = path
          .relative(projectRoot, resolved.path)
          .split(path.sep)
          .join("/");
        return { ok: true, source: { bytes, canonicalId, id } };
      } catch {
        return { ok: false, reason: "invalid" };
      }
    },
    entry,
  };
}

/**
 * Reads at most `maxBytes + 1` bytes so a file replaced with a larger one
 * between the size check and the read fails closed without unbounded
 * allocation.
 */
async function readBounded(
  file: string,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) return undefined;
    return new Uint8Array(buffer.subarray(0, offset));
  } finally {
    await handle.close();
  }
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
