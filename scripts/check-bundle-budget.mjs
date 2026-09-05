// Reader JavaScript budget. Reads the production build output of `next build`
// and fails when the client JavaScript an operation page ships (framework
// bootstrap, polyfills, and the client-component chunks referenced by the
// route) grows past the budget. Lazily loaded chunks of later slices (search,
// playground, highlighter) are excluded by construction because they are not
// referenced by the route manifest. The budget is a regression ceiling above
// the measured baseline recorded in docs/development/performance-accessibility.md.
// Usage: node scripts/check-bundle-budget.mjs [--json]
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const buildRoot = path.join(root, "apps/web/.next");
const OPERATION_ROUTE = "/api/[...segments]/page";
/** Gzip bytes of every client script an operation page loads. */
export const BUDGET_GZIP_BYTES = 150 * 1_024;
/** Gzip bytes of route-specific chunks beyond the framework bootstrap. */
export const ROUTE_BUDGET_GZIP_BYTES = 40 * 1_024;

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function chunkPath(reference) {
  return path.join(buildRoot, reference.replace(/^\/_next\//, ""));
}

function gzipBytes(file) {
  return gzipSync(readFileSync(file)).byteLength;
}

/** Client chunks referenced by a route's client-reference manifest. */
function routeClientChunks(route) {
  const file = path.join(
    buildRoot,
    "server/app",
    `${route.slice(1)}_client-reference-manifest.js`,
  );
  const source = readFileSync(file, "utf8");
  const start = source.indexOf(
    "= {",
    source.indexOf(`__RSC_MANIFEST["${route}"]`),
  );
  if (start === -1)
    throw new Error(`Unrecognized client reference manifest at ${file}`);
  const manifest = JSON.parse(source.slice(start + 2).replace(/;?\s*$/, ""));
  const chunks = new Set();
  for (const entry of Object.values(manifest.clientModules ?? {})) {
    for (const chunk of entry.chunks ?? []) {
      if (chunk.startsWith("/_next/static/") && chunk.endsWith(".js"))
        chunks.add(chunk);
    }
  }
  return [...chunks].sort();
}

export function measure(route = OPERATION_ROUTE) {
  const build = readJson(path.join(buildRoot, "build-manifest.json"));
  const bootstrap = [
    ...(build.rootMainFiles ?? []),
    ...(build.lowPriorityFiles ?? []),
  ].map((file) => `/_next/${file}`);
  // Polyfills are referenced with `nomodule` and never downloaded by the
  // browsers Specra supports; they are reported but not budgeted.
  const polyfills = (build.polyfillFiles ?? []).map((file) => `/_next/${file}`);
  const routeChunks = routeClientChunks(route).filter(
    (chunk) => !bootstrap.includes(chunk) && !polyfills.includes(chunk),
  );
  const size = (chunks) =>
    chunks.reduce(
      (totals, chunk) => ({
        gzipBytes: totals.gzipBytes + gzipBytes(chunkPath(chunk)),
        rawBytes: totals.rawBytes + statSync(chunkPath(chunk)).size,
      }),
      { gzipBytes: 0, rawBytes: 0 },
    );
  const bootstrapSize = size(bootstrap);
  const routeSize = size(routeChunks);
  return {
    bootstrap: { chunks: bootstrap, ...bootstrapSize },
    budgetGzipBytes: BUDGET_GZIP_BYTES,
    polyfills: { chunks: polyfills, ...size(polyfills) },
    route: { chunks: routeChunks, name: route, ...routeSize },
    routeBudgetGzipBytes: ROUTE_BUDGET_GZIP_BYTES,
    totalGzipBytes: bootstrapSize.gzipBytes + routeSize.gzipBytes,
    totalRawBytes: bootstrapSize.rawBytes + routeSize.rawBytes,
  };
}

function main() {
  const report = measure();
  const failures = [];
  if (report.totalGzipBytes > report.budgetGzipBytes) {
    failures.push(
      `operation page client JavaScript ${report.totalGzipBytes} B gzip exceeds the ${report.budgetGzipBytes} B budget`,
    );
  }
  if (report.route.gzipBytes > report.routeBudgetGzipBytes) {
    failures.push(
      `operation route chunks ${report.route.gzipBytes} B gzip exceed the ${report.routeBudgetGzipBytes} B budget`,
    );
  }
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[bundle] operation page: ${report.totalGzipBytes} B gzip (${report.totalRawBytes} B raw) client JavaScript; bootstrap ${report.bootstrap.gzipBytes} B in ${report.bootstrap.chunks.length} chunks, route ${report.route.gzipBytes} B in ${report.route.chunks.length} chunks; budget ${report.budgetGzipBytes} B\n`,
    );
  }
  if (failures.length > 0) {
    for (const failure of failures) process.stderr.write(`${failure}\n`);
    process.exit(1);
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === new URL(import.meta.url).pathname
) {
  main();
}
