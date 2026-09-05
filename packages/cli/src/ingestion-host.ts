import { createReadStream, writeSync } from "node:fs";
import { exit } from "node:process";

import { serializeDocumentationArtifact } from "@specra/model";
import {
  ingestOpenApi,
  snapshotIngestionLimits,
  type IngestionLimits,
} from "@specra/openapi";

import { createProjectAcquisition, isDocumentId } from "./acquisition.js";
import {
  MAX_INGESTION_FRAME_BYTES,
  MAX_INGESTION_REQUEST_BYTES,
} from "./contracts.js";

interface HostRequest {
  readonly projectRoot: string;
  readonly entries: readonly string[];
  readonly project: {
    readonly name: string;
    readonly description?: string;
  };
  readonly limits: IngestionLimits;
}

/**
 * Ingestion host process. It receives one bounded JSON request through argv,
 * performs every filesystem read through the CLI acquisition policy, runs the
 * adapter pipeline, and returns exactly one bounded JSON frame on fd3. It
 * never writes to stdout or stderr on purpose; anything that does leak there
 * is captured and discarded by the parent.
 */
void main();

async function main(): Promise<void> {
  try {
    const request = readRequest();
    if (request === undefined) {
      post({ reason: "request", type: "failure" });
      return;
    }
    const result = await ingestOpenApi({
      limits: request.limits,
      project: request.project,
      sources: request.entries.map((entry) =>
        createProjectAcquisition(request.projectRoot, entry),
      ),
    });
    const artifactJson =
      result.artifact === undefined
        ? undefined
        : serializeDocumentationArtifact(result.artifact);
    post({
      ...(artifactJson === undefined ? {} : { artifactJson }),
      artifactDiagnostics: result.artifactDiagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        path: diagnostic.location?.path ?? "/",
      })),
      cancelled: result.cancelled,
      diagnostics: result.diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        document: diagnostic.location.document,
        pointer: diagnostic.location.pointer,
        severity: diagnostic.severity,
      })),
      ok: result.ok,
      sources: result.sources,
      statistics: result.statistics,
      type: "result",
    });
  } catch {
    post({ reason: "pipeline", type: "failure" });
  }
}

function readRequest(): HostRequest | undefined {
  const [, , encoded, ...extra] = process.argv;
  if (extra.length > 0 || typeof encoded !== "string") return undefined;
  if (Buffer.byteLength(encoded, "utf8") > MAX_INGESTION_REQUEST_BYTES) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const limits = snapshotIngestionLimits(record.limits);
  const project = record.project;
  if (
    typeof record.projectRoot !== "string" ||
    record.projectRoot.length === 0 ||
    !Array.isArray(record.entries) ||
    record.entries.length === 0 ||
    record.entries.length > 64 ||
    !record.entries.every(
      (entry) => typeof entry === "string" && isDocumentId(entry),
    ) ||
    limits === undefined ||
    typeof project !== "object" ||
    project === null ||
    typeof (project as { name?: unknown }).name !== "string"
  ) {
    return undefined;
  }
  const description = (project as { description?: unknown }).description;
  if (description !== undefined && typeof description !== "string") {
    return undefined;
  }
  return {
    entries: record.entries as string[],
    limits,
    project: {
      name: (project as { name: string }).name,
      ...(description === undefined ? {} : { description }),
    },
    projectRoot: record.projectRoot,
  };
}

function post(response: Readonly<Record<string, unknown>>): void {
  let frame: Buffer;
  try {
    frame = Buffer.from(`${JSON.stringify(response)}\n`, "utf8");
    if (frame.byteLength > MAX_INGESTION_FRAME_BYTES) {
      frame = Buffer.from(
        `${JSON.stringify({ reason: "frame", type: "failure" })}\n`,
        "utf8",
      );
    }
    let offset = 0;
    while (offset < frame.byteLength) {
      offset += writeSync(3, frame, offset, frame.byteLength - offset);
    }
  } catch {
    exit(1);
  }
  // Stay alive only while the parent's end of the control channel is open:
  // the parent terminates the whole tree after a result, and a parent that
  // died first closes the channel, which ends this host instead of leaving it
  // orphaned under the init process.
  const control = createReadStream("", { fd: 3 });
  const stop = (): void => exit(0);
  control.on("data", () => undefined);
  control.once("end", stop);
  control.once("close", stop);
  control.once("error", stop);
}
