import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RULE_IDS } from "@specra/quality";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildProject,
  checkProject,
  diffDocumentation,
  releaseProject,
} from "../../packages/cli/src/index";

/**
 * SPEC-011 §12–§17, §54–§56, §79–§82, §180: `specra check` and `specra diff`
 * as a CI would use them. Every gate case is a mutation that must actually
 * be caught: a suite that only runs the command against clean fixtures
 * proves nothing.
 */

const cliBin = fileURLToPath(
  new URL("../../packages/cli/dist/bin.js", import.meta.url),
);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

/** One documented operation and one that a rule will object to. */
const OPENAPI = `openapi: 3.1.0
info:
  title: Quality
  version: 1.0.0
components:
  securitySchemes:
    apiKey:
      type: apiKey
      name: X-Api-Key
      in: header
      description: Create a key in the dashboard and send it on every request.
  schemas:
    Inbox:
      type: object
      description: A mailbox that receives messages.
      properties:
        id:
          type: string
          description: The inbox identifier.
paths:
  /inboxes:
    get:
      operationId: listInboxes
      summary: List inboxes
      description: Returns every inbox the caller can read.
      security:
        - apiKey: []
      responses:
        '200':
          description: The inboxes.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Inbox'
              example:
                id: inb_1
  /inboxes/{id}:
    delete:
      operationId: deleteInbox
      summary: Delete an inbox
      security:
        - apiKey: []
      parameters:
        - name: id
          in: path
          required: true
          description: The inbox to delete.
          schema:
            type: string
      responses:
        '204':
          description: Deleted.
`;

async function project(quality = ""): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "specra-check-"));
  temporary.push(root);
  await mkdir(path.join(root, "docs"));
  await writeFile(
    path.join(root, "docs", "index.md"),
    "---\ntitle: Quality docs\ndescription: How to use the Quality API.\n---\n\nRead the [reference](/api).\n",
  );
  await writeFile(path.join(root, "openapi.yaml"), OPENAPI);
  await writeFile(
    path.join(root, "specra.config.ts"),
    `export default { schemaVersion: 1, name: "Quality", openapi: "./openapi.yaml", navigation: [{ api: true }]${quality} };`,
  );
  return root;
}

function run(
  root: string,
  args: readonly string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cliBin, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

describe("specra check", () => {
  it("reports the candidate, passes by default, and is read-only", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    const before = await readdir(path.join(root, ".specra"));

    const result = await checkProject({ cwd: root });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!("quality" in result)) throw new Error("no evaluation");
    expect(result.quality.qualityFormat).toBe(1);
    expect(result.quality.target).toEqual({ kind: "candidate" });
    expect(result.quality.summary.gate).toBe("passed");
    // `deleteInbox` has no description: the default catalogue notices.
    expect(result.quality.findings.map((finding) => finding.rule)).toContain(
      "operation-description",
    );
    expect(await readdir(path.join(root, ".specra"))).toEqual(before);
    expect(await readdir(root)).not.toContain("specra-quality.json");
  });

  it("fails the gate only when the policy says so", async () => {
    const strict = await project(
      `, quality: { rules: { "operation-description": "error" } }`,
    );
    expect((await buildProject({ cwd: strict })).ok).toBe(true);
    const failed = await checkProject({ cwd: strict });
    expect(failed.ok).toBe(false);
    expect(failed.outcome).toBe("quality-failure");
    if (!("quality" in failed)) throw new Error("no evaluation");
    expect(failed.quality.summary).toMatchObject({
      gate: "failed",
      reason: "error",
    });

    const lenient = await project(`, quality: { failOn: "never" }`);
    expect((await buildProject({ cwd: lenient })).ok).toBe(true);
    expect((await checkProject({ cwd: lenient })).ok).toBe(true);
  });

  it("fails on a warning budget and passes once the debt is suppressed", async () => {
    const budget = await project(`, quality: { maxWarnings: 0 }`);
    expect((await buildProject({ cwd: budget })).ok).toBe(true);
    const failed = await checkProject({ cwd: budget });
    expect(failed.ok).toBe(false);
    if (!("quality" in failed)) throw new Error("no evaluation");
    expect(failed.quality.summary.reason).toBe("maxWarnings");
    const warnings = failed.quality.findings
      .filter((finding) => finding.severity === "warning")
      .map((finding) => finding.target.identity);

    const suppressions = [...new Set(warnings)]
      .map(
        (identity) =>
          `{ rule: "operation-description", target: ${JSON.stringify(identity)}, reason: "Documented in DOC-14; scheduled for the next release." }`,
      )
      .join(", ");
    const governed = await project(
      `, quality: { maxWarnings: 0, suppressions: [${suppressions}] }`,
    );
    expect((await buildProject({ cwd: governed })).ok).toBe(true);
    const passed = await checkProject({ cwd: governed });
    if (!("quality" in passed)) throw new Error("no evaluation");
    expect(passed.quality.summary.gate).toBe("passed");
    // Suppressed debt is still visible; it is not erased.
    expect(passed.quality.summary.suppressed).toBeGreaterThan(0);
    expect(
      passed.quality.findings.some(
        (finding) => finding.suppressed?.reason.includes("DOC-14") === true,
      ),
    ).toBe(true);
  });

  it("diagnoses a stale suppression instead of accepting it quietly", async () => {
    const stale = await project(
      `, quality: { suppressions: [{ rule: "operation-description", target: "openapi.yaml~noSuchOperation", reason: "Left over from an earlier contract." }] }`,
    );
    expect((await buildProject({ cwd: stale })).ok).toBe(true);
    const result = await checkProject({ cwd: stale });
    if (!("quality" in result)) throw new Error("no evaluation");
    expect(
      result.quality.findings.some(
        (finding) => finding.rule === "suppression-unused",
      ),
    ).toBe(true);
  });

  it("treats an unknown rule as a configuration error, not a gate failure", async () => {
    const typo = await project(
      `, quality: { rules: { "operation-descriptin": "error" } }`,
    );
    expect((await buildProject({ cwd: typo })).ok).toBe(true);
    const result = await checkProject({ cwd: typo });
    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("validation-failure");
    expect("quality" in result).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "QUALITY_RULE_UNKNOWN",
      path: "config#/quality/rules/operation-descriptin",
    });
  });

  it("asks for a build instead of checking artifacts that are not there", async () => {
    const root = await project();
    const result = await checkProject({ cwd: root });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("CANDIDATE_MISSING");
  });

  it("checks a retained release and compares it with an earlier one", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);

    // v2 removes an operation and makes authentication mandatory-only.
    await writeFile(
      path.join(root, "openapi.yaml"),
      OPENAPI.replace(/  \/inboxes\/\{id\}:[\s\S]*$/u, ""),
    );
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    expect(
      (await releaseProject({ cwd: root, noDiff: true, version: "v2" })).ok,
    ).toBe(true);

    const compared = await checkProject({
      cwd: root,
      from: "v1",
      version: "v2",
    });
    if (!("quality" in compared)) throw new Error("no evaluation");
    expect(compared.quality.target).toEqual({ kind: "release", version: "v2" });
    expect(compared.quality.comparison).toEqual({ from: "v1" });
    expect(
      compared.quality.findings.filter(
        (finding) => finding.rule === "api-operation-removed",
      ),
    ).toHaveLength(1);
    expect(compared.ok).toBe(false);
    expect(compared.outcome).toBe("quality-failure");

    // The same release checked without a base has no compatibility finding.
    const alone = await checkProject({ cwd: root, version: "v2" });
    if (!("quality" in alone)) throw new Error("no evaluation");
    expect(
      alone.quality.findings.some(
        (finding) => finding.category === "compatibility",
      ),
    ).toBe(false);
  });

  it("refuses a release whose bytes disagree with its manifest", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);
    const component = path.join(
      root,
      ".specra",
      "releases",
      "v1",
      "documentation.json",
    );
    await writeFile(component, `${await readFile(component, "utf8")} `);
    const result = await checkProject({ cwd: root, version: "v1" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "RELEASE_MANIFEST_INVALID",
      path: "cli#/version",
    });
  });

  it("refuses an unknown version rather than checking something else", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    const result = await checkProject({ cwd: root, version: "v9" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: "VERSION_NOT_FOUND",
      path: "cli#/version",
    });
  });
});

describe("specra diff", () => {
  it("compares a release with the candidate and never writes", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);
    await writeFile(
      path.join(root, "openapi.yaml"),
      OPENAPI.replace(/  \/inboxes\/\{id\}:[\s\S]*$/u, ""),
    );
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    const candidates = await readFile(
      path.join(root, ".specra", "candidates", "diff.json"),
      "utf8",
    );

    const result = await diffDocumentation({ cwd: root, from: "v1" });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!("diff" in result)) throw new Error("no diff");
    expect(result.diff.diffFormat).toBe(1);
    expect(result.diff).toMatchObject({ from: "v1", to: "candidate" });
    expect(result.diff.candidates.map((candidate) => candidate.kind)).toContain(
      "operation-removed",
    );
    // Read-only: the private review file is untouched and no changelog appears.
    expect(
      await readFile(
        path.join(root, ".specra", "candidates", "diff.json"),
        "utf8",
      ),
    ).toBe(candidates);
    expect(await readdir(root)).not.toContain("changelog");
  });

  it("resolves current through the catalog and refuses an unknown source", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);
    const viaCurrent = await diffDocumentation({ cwd: root, from: "current" });
    if (!("diff" in viaCurrent)) throw new Error("no diff");
    expect(viaCurrent.diff.from).toBe("v1");
    const unknown = await diffDocumentation({ cwd: root, from: "v7" });
    expect(unknown.ok).toBe(false);
    expect(unknown.diagnostics[0]).toMatchObject({
      code: "VERSION_NOT_FOUND",
      path: "cli#/from",
    });
  });
});

describe("packaged binary", () => {
  it("maps outcomes to exit codes and keeps JSON alone on stdout", async () => {
    const root = await project(
      `, quality: { rules: { "operation-description": "error" } }`,
    );
    expect((await buildProject({ cwd: root })).ok).toBe(true);

    const failing = run(root, ["check", "--json"]);
    expect(failing.status).toBe(3);
    expect(failing.stderr).toBe("");
    const parsed = JSON.parse(failing.stdout) as {
      ok: boolean;
      quality: { summary: { gate: string } };
    };
    expect(parsed.ok).toBe(false);
    expect(parsed.quality.summary.gate).toBe("failed");
    // Exactly one envelope, no progress lines, no ANSI.
    expect(failing.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(failing.stdout).not.toMatch(/\u001b/);

    const human = run(root, ["check"]);
    expect(human.status).toBe(3);
    expect(human.stderr).toContain("Quality gate failed");
    expect(human.stderr).toContain("operation-description");

    const passing = run(root, ["check", "--json", "--root", "."]);
    expect(passing.status).toBe(3);

    const usage = run(root, ["check", "--version"]);
    expect(usage.status).toBe(64);
    expect(usage.stderr).toContain("--version requires a version id");

    const help = run(root, ["check", "--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("read-only");

    const diffUsage = run(root, ["diff"]);
    expect(diffUsage.status).toBe(64);
    expect(diffUsage.stderr).toContain("diff requires --from");

    const rootHelp = run(root, ["--help"]);
    expect(rootHelp.stdout).toContain("check");
    expect(rootHelp.stdout).toContain("diff");
  });

  it("succeeds with exit 0 when the gate passes and prints a summary", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    const result = run(root, ["check"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Quality gate passed.");
    expect(result.stdout).toMatch(/0 error\(s\)/);
    expect(result.stderr).toBe("");
  });

  it("prints a human diff grouped by entity", async () => {
    const root = await project();
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    expect((await releaseProject({ cwd: root, version: "v1" })).ok).toBe(true);
    await writeFile(
      path.join(root, "openapi.yaml"),
      OPENAPI.replace(/  \/inboxes\/\{id\}:[\s\S]*$/u, ""),
    );
    expect((await buildProject({ cwd: root })).ok).toBe(true);
    const result = run(root, ["diff", "--from", "v1"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Specra diff v1 → candidate");
    expect(result.stdout).toContain("Operations:");
    expect(result.stdout).toContain("- DELETE /inboxes/{id}");
    expect(result.stdout).toContain("1 change(s)");
    const json = run(root, ["diff", "--from", "v1", "--json"]);
    expect(json.status).toBe(0);
    expect(json.stderr).toBe("");
    expect(JSON.parse(json.stdout)).toMatchObject({
      diff: { diffFormat: 1, from: "v1", to: "candidate" },
      ok: true,
    });
  });
});

describe("rule catalogue and documentation", () => {
  it("documents every published rule, and documents no rule that does not exist", async () => {
    const catalogue = await readFile(
      fileURLToPath(new URL("../../docs/quality.md", import.meta.url)),
      "utf8",
    );
    const documented = new Set(
      [...catalogue.matchAll(/^\| `([a-z][a-z0-9-]*)`/gmu)].map(
        (match) => match[1] ?? "",
      ),
    );
    expect([...documented].sort()).toEqual([...RULE_IDS].sort());
  });
});
