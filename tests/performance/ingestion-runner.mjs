// Fresh-process ingestion benchmark. Generates a deterministic large OpenAPI
// document, runs the adapter pipeline in this process, and prints one JSON
// line with wall time, peak RSS, and artifact size so the measuring test never
// shares a heap with the workload. Invoked as:
import { serializeDocumentationArtifact } from "../../packages/model/dist/index.js";
import {
  createMemoryAcquisition,
  ingestOpenApi,
} from "../../packages/openapi/dist/index.js";
import { generate } from "./ingestion-generator.mjs";

//   node tests/performance/ingestion-runner.mjs <kind> [scale] [documents]
// `documents` (default 1) ingests that many generated copies as separate
// project entries, which is the multi-document memory workload.
const [, , kind = "operations", scaleArgument, documentsArgument] =
  process.argv;
const scale = Number(scaleArgument ?? (kind === "bytes" ? 10 : 10_000));
const documents = Number(documentsArgument ?? 1);
const extension = kind.endsWith("-yaml") ? "yaml" : "json";
const sources = [];
let bytes = 0;
for (let index = 0; index < documents; index += 1) {
  const id = `openapi-${index}.${extension}`;
  const source = generate(kind, scale);
  bytes += Buffer.byteLength(source, "utf8");
  sources.push(createMemoryAcquisition(id, { [id]: source }));
}

const started = performance.now();
const result = await ingestOpenApi({
  project: { name: "Benchmark" },
  sources,
});
const elapsedMs = performance.now() - started;
const artifactBytes =
  result.artifact === undefined
    ? 0
    : Buffer.byteLength(
        serializeDocumentationArtifact(result.artifact),
        "utf8",
      );
// Node reports maxRSS in kibibytes on every platform.
const maxRssBytes = process.resourceUsage().maxRSS * 1_024;

process.stdout.write(
  `${JSON.stringify({
    artifactBytes,
    diagnostics: result.diagnostics
      .slice(0, 5)
      .map((diagnostic) => diagnostic.code),
    elapsedMs: Math.round(elapsedMs),
    inputBytes: bytes,
    kind,
    maxRssBytes,
    ok: result.ok,
    statistics: result.statistics,
  })}\n`,
);
