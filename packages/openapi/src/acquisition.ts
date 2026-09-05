/**
 * The single source-acquisition boundary. The adapter never opens files or
 * sockets itself: every byte it parses arrives through this port, keyed by a
 * project-relative POSIX document id that the adapter has already confined
 * lexically. The implementation (the CLI, on top of the SPEC-002 path policy)
 * confines the id physically, checks the file type, and enforces the byte
 * ceiling before reading.
 */
export interface AcquiredSource {
  /** Project-relative POSIX id exactly as requested. */
  readonly id: string;
  readonly bytes: Uint8Array;
}

export type AcquisitionFailure =
  "invalid" | "missing" | "outside" | "too-large" | "wrong-type";

export type AcquisitionResult =
  | { readonly ok: true; readonly source: AcquiredSource }
  | { readonly ok: false; readonly reason: AcquisitionFailure };

export interface SourceAcquisition {
  /** Project-relative POSIX id of the root OpenAPI document. */
  readonly entry: string;
  acquire(id: string, maxBytes: number): Promise<AcquisitionResult>;
}

/**
 * In-memory implementation for tests and programmatic callers that already
 * hold source text. Ids are matched exactly; nothing outside the map exists.
 */
export function createMemoryAcquisition(
  entry: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): SourceAcquisition {
  const encoder = new TextEncoder();
  const entries = new Map<string, Uint8Array>();
  for (const [id, content] of Object.entries(files)) {
    entries.set(
      id,
      typeof content === "string" ? encoder.encode(content) : content,
    );
  }
  return {
    async acquire(id, maxBytes) {
      const bytes = entries.get(id);
      if (bytes === undefined) return { ok: false, reason: "missing" };
      if (bytes.byteLength > maxBytes)
        return { ok: false, reason: "too-large" };
      return { ok: true, source: { bytes, id } };
    },
    entry,
  };
}
