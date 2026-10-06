#!/usr/bin/env node
/**
 * Dogfoods the public `specistry check` command against the production-realistic
 * TestInbox fixture, exactly as a consumer's CI would call it (SPEC-011 §80,
 * §184, §205): the packed binary, no private import, no repository-internal
 * hook.
 *
 * A gate that only ever runs against clean input proves nothing, so this also
 * mutates the policy and proves the command actually fails: a promoted rule
 * must exit 3, and a misspelled rule must exit 2 rather than passing quietly
 * (SPEC-011 §81–§82).
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = path.join(repositoryRoot, "packages/cli/dist/bin.js");
const fixture = path.join(repositoryRoot, "tests/fixtures/reader/testinbox");
const failures = [];

function run(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

/** A copy of the fixture whose configuration carries an extra policy. */
function projectWithPolicy(quality) {
  const root = mkdtempSync(path.join(tmpdir(), "specistry-quality-gate-"));
  cpSync(fixture, root, { recursive: true });
  const config = path.join(root, "specistry.config.ts");
  const original = readFileSync(config, "utf8");
  const marker = "const config = {";
  if (!original.includes(marker)) {
    throw new Error("unexpected fixture configuration");
  }
  writeFileSync(
    config,
    original.replace(marker, `${marker}\n  quality: ${quality},`),
  );
  return root;
}

// 1. The real project must pass its own gate with the published defaults.
const passing = run(fixture, ["check", "--json"]);
expect(
  passing.status === 0,
  `specistry check exited ${passing.status} on the TestInbox fixture:\n${passing.stderr}`,
);
expect(
  passing.stderr === "",
  "specistry check --json wrote to stderr; machine mode must stay silent there.",
);
let report;
try {
  report = JSON.parse(passing.stdout);
} catch {
  failures.push(
    "specistry check --json did not write exactly one JSON envelope.",
  );
}
if (report !== undefined) {
  expect(
    report.quality?.summary?.gate === "passed",
    `The fixture's gate reported ${report.quality?.summary?.gate}.`,
  );
  expect(
    report.quality?.qualityFormat === 1,
    "The quality envelope did not declare format 1.",
  );
  expect(
    report.quality?.summary?.truncated === false,
    "The fixture evaluation was truncated, so its result cannot be trusted.",
  );
}

// 2. Self-test: a promoted rule must actually fail the command.
const strict = projectWithPolicy(
  '{ rules: { "operation-description": "error" } }',
);
try {
  const failed = run(strict, ["check"]);
  expect(
    failed.status === 3,
    `A promoted rule exited ${failed.status}; the gate cannot fail, so it is not a gate.`,
  );
  expect(
    failed.stderr.includes("Quality gate failed"),
    "A failed gate did not say so.",
  );
} finally {
  rmSync(strict, { force: true, recursive: true });
}

// 3. Self-test: a misspelled rule is a configuration error, not a pass.
const typo = projectWithPolicy(
  '{ rules: { "operation-descriptin": "error" } }',
);
try {
  const invalid = run(typo, ["check", "--json"]);
  expect(
    invalid.status === 2,
    `An unknown rule exited ${invalid.status}; a typo must not weaken a gate.`,
  );
  expect(
    invalid.stdout.includes("QUALITY_RULE_UNKNOWN"),
    "An unknown rule produced no diagnostic.",
  );
} finally {
  rmSync(typo, { force: true, recursive: true });
}

// 4. Self-test: a warning budget must be enforced.
const budget = projectWithPolicy("{ maxWarnings: 0 }");
try {
  const exceeded = run(budget, ["check"]);
  expect(
    exceeded.status === 3,
    `maxWarnings: 0 exited ${exceeded.status} on a fixture with warnings.`,
  );
} finally {
  rmSync(budget, { force: true, recursive: true });
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  const summary = report?.quality?.summary ?? {};
  process.stdout.write(
    `Documentation quality gate passed on the TestInbox fixture ` +
      `(${summary.error ?? 0} error(s), ${summary.warning ?? 0} warning(s), ` +
      `${summary.info ?? 0} info) and the gate self-tests proved it can fail.\n`,
  );
}
