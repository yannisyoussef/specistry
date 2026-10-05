import { loadReaderFor } from "../../lib/reader/release";

export async function GET(): Promise<Response> {
  try {
    const reader = await loadReaderFor("/");
    return Response.json(
      {
        project: reader.manifest.project.id,
        status: "ready",
        ...(reader.version === undefined
          ? { mode: "candidate" }
          : { mode: "releases", version: reader.version.id }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    // Do not disclose local paths, parser failures, or release metadata from
    // a health endpoint. Operator logs and the reader startup error retain
    // the actionable detail.
    return Response.json(
      { status: "not-ready" },
      {
        headers: { "Cache-Control": "no-store" },
        status: 503,
      },
    );
  }
}
