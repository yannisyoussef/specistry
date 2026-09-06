// Reader JavaScript budget. Reads the production build output of `next build`
// and fails when the client JavaScript an operation page or an authored page ships (framework
// bootstrap, polyfills, and the client-component chunks referenced by the
// route) grows past the budget. Lazily loaded chunks of later slices (search,
// playground, highlighter) are excluded by construction because they are not
// referenced by the route manifest. The budget is a regression ceiling above
// the measured baseline recorded in docs/development/performance-accessibility.md.
// Usage: node scripts/check-bundle-budget.mjs [--json]
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const buildRoot = path.join(root, "apps/web/.next");
const OPERATION_ROUTE = "/api/[...segments]/page";
const DOCS_ROUTE = "/docs/[[...slug]]/page";
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

/** Gzip bytes of the lazily loaded search chunk (engine + palette). */
export const SEARCH_BUDGET_GZIP_BYTES = 40 * 1_024;

/**
 * The search palette is loaded on first open, never by a route, so it is
 * found by content: the chunk that carries the engine's serialized-index
 * marker. Reported and budgeted separately from every page's bootstrap.
 */
export function measureSearchChunk() {
  const directory = path.join(buildRoot, "static", "chunks");
  const chunks = readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(directory, name))
    .filter((file) => readFileSync(file, "utf8").includes("searchVersion"));
  const gzipBytes = chunks.reduce((total, file) => total + gzipBytes_(file), 0);
  const rawBytes = chunks.reduce(
    (total, file) => total + statSync(file).size,
    0,
  );
  return {
    budgetGzipBytes: SEARCH_BUDGET_GZIP_BYTES,
    chunks: chunks.map((file) => path.relative(buildRoot, file)),
    gzipBytes,
    rawBytes,
  };
}

function gzipBytes_(file) {
  return gzipSync(readFileSync(file)).byteLength;
}

/**
 * The code samples are generated on the server (SPEC-008): no language
 * generator may reach a client chunk. These markers exist only in the
 * generators, so any client chunk containing one is a leak.
 */
const GENERATOR_MARKERS = [
  "BodyPublishers.ofString",
  "--data-binary",
  "pip install requests",
];

export function findGeneratorLeaks() {
  const directory = path.join(buildRoot, "static", "chunks");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => {
      const source = readFileSync(path.join(directory, name), "utf8");
      return GENERATOR_MARKERS.some((marker) => source.includes(marker));
    });
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

function check(report, label) {
  const failures = [];
  if (report.totalGzipBytes > report.budgetGzipBytes) {
    failures.push(
      `${label} client JavaScript ${report.totalGzipBytes} B gzip exceeds the ${report.budgetGzipBytes} B budget`,
    );
  }
  if (report.route.gzipBytes > report.routeBudgetGzipBytes) {
    failures.push(
      `${label} route chunks ${report.route.gzipBytes} B gzip exceed the ${report.routeBudgetGzipBytes} B budget`,
    );
  }
  return failures;
}

function main() {
  const reports = {
    docs: measure(DOCS_ROUTE),
    operation: measure(OPERATION_ROUTE),
  };
  const search = measureSearchChunk();
  const failures = [
    ...check(reports.operation, "operation page"),
    ...check(reports.docs, "authored page"),
  ];
  if (search.chunks.length === 0) {
    failures.push("the lazy search chunk was not found in the build output");
  } else if (search.gzipBytes > search.budgetGzipBytes) {
    failures.push(
      `search chunk ${search.gzipBytes} B gzip exceeds the ${search.budgetGzipBytes} B budget`,
    );
  }
  for (const [, report] of Object.entries(reports)) {
    if (
      search.chunks.some((chunk) =>
        report.route.chunks.includes(`/_next/${chunk}`),
      )
    ) {
      failures.push(
        "the search chunk is loaded by a page route instead of lazily",
      );
    }
  }
  const leaks = findGeneratorLeaks();
  if (leaks.length > 0) {
    failures.push(
      `client chunk(s) ${leaks.join(", ")} contain code-sample generator code; generation must stay on the server`,
    );
  }
  if (process.argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ ...reports, generatorLeaks: leaks, search }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(
      `[bundle] search (lazy): ${search.gzipBytes} B gzip (${search.rawBytes} B raw) in ${search.chunks.length} chunk(s); budget ${search.budgetGzipBytes} B\n`,
    );
    for (const [label, report] of Object.entries(reports)) {
      process.stdout.write(
        `[bundle] ${label} page: ${report.totalGzipBytes} B gzip (${report.totalRawBytes} B raw) client JavaScript; bootstrap ${report.bootstrap.gzipBytes} B in ${report.bootstrap.chunks.length} chunks, route ${report.route.gzipBytes} B in ${report.route.chunks.length} chunks; budget ${report.budgetGzipBytes} B\n`,
      );
    }
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
