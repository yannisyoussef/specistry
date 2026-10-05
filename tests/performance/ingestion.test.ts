import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach, describe, expect, it } from "vitest";

const runner = fileURLToPath(
  new URL("./ingestion-runner.mjs", import.meta.url),
);
const cliPath = fileURLToPath(
  new URL("../../packages/cli/dist/bin.js", import.meta.url),
);
const temporaryDirectories: string[] = [];
const evidencePath = fileURLToPath(
  new URL("./measurements.json", import.meta.url),
);
const evidence: Measurement[] = [];

interface Measurement {
  readonly artifactBytes: number;
  readonly diagnostics: readonly string[];
  readonly elapsedMs: number;
  readonly inputBytes: number;
  readonly kind: string;
  readonly maxRssBytes: number;
  readonly ok: boolean;
  readonly statistics: {
    readonly documents: number;
    readonly operations: number;
    readonly references: number;
    readonly schemas: number;
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

// The measurements are the SPEC-003 evidence; CI uploads this file.
afterAll(async () => {
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
});

/**
 * Budgets are deliberately generous regression ceilings that catch
 * catastrophic behaviour, not performance targets. Each case runs in a fresh
 * Node process so heap, RSS, and wall time are not polluted by the test runner
 * or by earlier cases. The printed measurements are the SPEC-003 evidence.
 */
describe("fresh-process ingestion evidence", () => {
  it("ingests 10,000 lean operations within the documented budgets", () => {
    const measurement = measure("lean", 10_000);
    report(measurement);
    expect(measurement.ok).toBe(true);
    expect(measurement.statistics.operations).toBe(10_000);
    expect(measurement.elapsedMs).toBeLessThan(60_000);
    expect(measurement.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);
    expect(measurement.artifactBytes).toBeGreaterThan(0);
  });

  it("ingests 6,000 rich operations and rejects 10,000 at the canonical budget", () => {
    const accepted = measure("operations", 6_000);
    report(accepted);
    expect(accepted.ok).toBe(true);
    expect(accepted.statistics.operations).toBe(6_000);
    expect(accepted.elapsedMs).toBeLessThan(60_000);
    expect(accepted.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);

    const rejected = measure("operations", 10_000);
    report(rejected);
    expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics).toEqual(["SOURCE_LIMIT_EXCEEDED"]);
    expect(rejected.elapsedMs).toBeLessThan(60_000);
    expect(rejected.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);
  });

  it("ingests an 8 MiB source and rejects 10 MiB of retained text at the canonical budget", () => {
    const accepted = measure("bytes", 8);
    report(accepted);
    expect(accepted.inputBytes).toBeGreaterThan(7 * 1_048_576);
    expect(accepted.ok).toBe(true);
    expect(accepted.elapsedMs).toBeLessThan(60_000);
    expect(accepted.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);

    const rejected = measure("bytes", 10);
    report(rejected);
    expect(rejected.inputBytes).toBeLessThanOrEqual(10 * 1_048_576);
    expect(rejected.ok).toBe(false);
    expect(rejected.diagnostics).toEqual(["SOURCE_LIMIT_EXCEEDED"]);
  });

  it("rejects a source above the byte ceiling before parsing it", () => {
    const measurement = measure("bytes", 11);
    report(measurement);
    expect(measurement.ok).toBe(false);
    expect(measurement.diagnostics).toEqual(["SOURCE_LIMIT_EXCEEDED"]);
    expect(measurement.elapsedMs).toBeLessThan(10_000);
  });

  it("keeps wide mappings linear in JSON and in YAML", () => {
    for (const kind of ["wide", "wide-yaml"] as const) {
      const accepted = measure(kind, 40_000);
      report(accepted);
      expect(accepted.ok).toBe(true);
      expect(accepted.statistics.schemas).toBe(1);
      expect(accepted.elapsedMs).toBeLessThan(15_000);
      expect(accepted.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);

      const rejected = measure(kind, 100_000);
      report(rejected);
      expect(rejected.ok).toBe(false);
      expect(rejected.diagnostics).toEqual(["SOURCE_LIMIT_EXCEEDED"]);
      expect(rejected.elapsedMs).toBeLessThan(15_000);
      expect(rejected.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);
    }
  });

  it("parses two node-dense documents inside the total byte budget within the heap ceiling", () => {
    const measurement = measure("dense", 120_000, 2);
    report(measurement);
    expect(measurement.inputBytes).toBeGreaterThan(16 * 1_048_576);
    expect(measurement.inputBytes).toBeLessThanOrEqual(20 * 1_048_576);
    expect(measurement.statistics.documents).toBe(2);
    expect(measurement.ok).toBe(false);
    expect(measurement.diagnostics).toEqual(["SOURCE_LIMIT_EXCEEDED"]);
    expect(measurement.elapsedMs).toBeLessThan(20_000);
    expect(measurement.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);
  });

  it("normalizes many encodings and discriminator variants in linear time", () => {
    const encodings = measure("encodings", 2_000);
    report(encodings);
    expect(encodings.ok).toBe(true);
    expect(encodings.elapsedMs).toBeLessThan(5_000);

    const polymorphic = measure("polymorphic", 20_000);
    report(polymorphic);
    expect(polymorphic.ok).toBe(true);
    expect(polymorphic.statistics.schemas).toBe(20_001);
    expect(polymorphic.elapsedMs).toBeLessThan(15_000);
    expect(polymorphic.maxRssBytes).toBeLessThan(2 * 1_024 ** 3);
  });

  it("builds a 10,000-operation project end to end through the packaged CLI at the default timeout", async () => {
    const project = await mkdtemp(path.join(tmpdir(), "specra-perf-"));
    temporaryDirectories.push(project);
    await mkdir(path.join(project, "docs"));
    await writeFile(
      path.join(project, "openapi.json"),
      generateDocument("lean", 10_000),
    );
    await writeFile(
      path.join(project, "specra.config.ts"),
      "export default { schemaVersion: 1, name: 'Perf', openapi: './openapi.json' };",
    );
    const started = performance.now();
    const built = spawnSync(process.execPath, [cliPath, "build", "--json"], {
      cwd: project,
      encoding: "utf8",
      timeout: 180_000,
    });
    const elapsedMs = Math.round(performance.now() - started);
    expect(built.status, built.stderr).toBe(0);
    const output = JSON.parse(built.stdout) as {
      readonly ok: boolean;
      readonly artifacts: { readonly bytes: number };
      readonly statistics: { readonly operations: number };
    };
    expect(output.ok).toBe(true);
    expect(output.statistics.operations).toBe(10_000);
    const documentation = await readFile(
      path.join(project, ".specra", "artifacts", "documentation.json"),
      "utf8",
    );
    process.stdout.write(
      `[performance] cli build 10k lean operations: ${elapsedMs} ms, artifact ${documentation.length} code units, ${output.artifacts.bytes} bytes\n`,
    );
    expect(elapsedMs).toBeLessThan(120_000);
  }, 200_000);
});

type Kind =
  | "bytes"
  | "dense"
  | "encodings"
  | "lean"
  | "operations"
  | "polymorphic"
  | "wide"
  | "wide-yaml";

/** Runs one workload in a fresh process with the ingestion host's heap hint. */
function measure(kind: Kind, scale: number, documents = 1): Measurement {
  const result = spawnSync(
    process.execPath,
    [
      "--max-old-space-size=2048",
      runner,
      kind,
      String(scale),
      String(documents),
    ],
    { encoding: "utf8", timeout: 180_000 },
  );
  if (result.error !== undefined) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  const measurement = JSON.parse(result.stdout) as Measurement;
  evidence.push({ ...measurement, kind: `${kind} ${scale} x${documents}` });
  return measurement;
}

function report(measurement: Measurement): void {
  process.stdout.write(
    `[performance] ${measurement.kind}: input ${measurement.inputBytes} bytes, ${measurement.statistics.operations} operations, ${measurement.statistics.schemas} schemas, ${measurement.elapsedMs} ms, peak RSS ${Math.round(measurement.maxRssBytes / 1_048_576)} MiB, artifact ${measurement.artifactBytes} bytes, ok=${measurement.ok}\n`,
  );
}

function generateDocument(kind: Kind, scale: number): string {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `const module = await import(${JSON.stringify(new URL("./ingestion-generator.mjs", import.meta.url).href)});
       process.stdout.write(module.generate(${JSON.stringify(kind)}, ${scale}));`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1_048_576 },
  );
  if (result.error !== undefined) throw result.error;
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}
