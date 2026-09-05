/**
 * Validates the canonical artifact when the server starts, so a missing or
 * invalid `.specra/artifacts` fails `next start` with the actionable loader
 * message instead of serving generic 500 pages. `next build` runs the same
 * check through `scripts/check-reader-artifact.mjs`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { loadReaderArtifact } = await import("./lib/reader/artifact");
  await loadReaderArtifact();
}
