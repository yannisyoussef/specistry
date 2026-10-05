import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const sourceCommit = "a".repeat(40);
const sourceTag = "v0.1.0-rc.2";
const repository = "yannisyoussef/specra";
const temporary: string[] = [];
const moduleUrl = pathToFileURL(
  path.join(root, "scripts/lib/release-binding.mjs"),
).href;
const { verifyPreparationBinding, finalizePreparedCandidate } = await import(
  moduleUrl
);
const { recordPublicDistribution } = await import(
  pathToFileURL(path.join(root, "scripts/lib/public-distribution.mjs")).href
);
const { licenseMetadata } = await import(
  pathToFileURL(path.join(root, "scripts/lib/license-policy.mjs")).href
);

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function binding() {
  return {
    repository,
    sourceCommit,
    sourceTag,
    run: {
      repository: { full_name: repository },
      head_repository: { full_name: repository },
      head_sha: sourceCommit,
      head_branch: sourceTag,
      path: ".github/workflows/release-candidate.yml",
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
    },
    jobs: [{ name: "Private candidate preparation", conclusion: "success" }],
    artifacts: [
      {
        id: 123,
        name: "prepared-specra-0.1.0-rc.2",
        expired: false,
        digest: `sha256:${"b".repeat(64)}`,
      },
    ],
    sourceToLedger: { status: "ahead" },
    ledgerToMaster: { status: "identical" },
  };
}

async function fixture() {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "specra-binding-"));
  temporary.push(repositoryRoot);
  for (const file of ["package.json", "license-policy.json"])
    await cp(path.join(root, file), path.join(repositoryRoot, file));
  const candidateDirectory = await mkdtemp(
    path.join(tmpdir(), "specra-prepared-"),
  );
  temporary.push(candidateDirectory);
  const policy = JSON.parse(
    await readFile(path.join(root, "license-policy.json"), "utf8"),
  );
  const files = new Map([
    ["specra-cli-0.1.0-rc.2.tgz", "prepared tarball"],
    ["specra-cli.cdx.json", '{"bomFormat":"CycloneDX"}'],
    [
      "license-metadata.json",
      JSON.stringify(licenseMetadata(policy, "0.1.0-rc.2")),
    ],
    [
      "release-audit.json",
      JSON.stringify({
        artifact: "specra-cli-0.1.0-rc.2.tgz",
        sourceCommit,
        version: "0.1.0-rc.2",
        license: "BUSL-1.1",
      }),
    ],
  ]);
  for (const [name, contents] of files)
    await writeFile(path.join(candidateDirectory, name), contents);
  const checksums =
    [...files]
      .map(
        ([name, contents]) =>
          `${createHash("sha256").update(contents).digest("hex")}  ${name}`,
      )
      .join("\n") + "\n";
  await writeFile(path.join(candidateDirectory, "SHA256SUMS"), checksums);
  // The supported recorder provides the reference bytes. Finalization must
  // reproduce them from an untouched copy of the private preparation artifact.
  const recordedCandidate = await mkdtemp(
    path.join(tmpdir(), "specra-recorded-"),
  );
  temporary.push(recordedCandidate);
  await cp(candidateDirectory, recordedCandidate, { recursive: true });
  await recordPublicDistribution({
    repositoryRoot,
    candidateDirectory: recordedCandidate,
    firstPublicDistribution: "2026-10-05",
    today: "2026-10-05",
  });
  return {
    repositoryRoot,
    candidateDirectory,
    ledgerDirectory: path.join(repositoryRoot, "release-ledger"),
    sourceCommit,
    sourceTag,
    recordedCandidate,
  };
}

describe("public-first release binding", () => {
  it("accepts only the successful private preparation from the exact source tag", () => {
    expect(verifyPreparationBinding(binding()).id).toBe(123);
    for (const patch of [
      { head_sha: "c".repeat(40) },
      { head_branch: "master" },
      { event: "pull_request" },
      { conclusion: "failure" },
      { path: ".github/workflows/ci.yml" },
      { head_repository: { full_name: "attacker/specra" } },
    ]) {
      const value = binding();
      Object.assign(value.run, patch);
      expect(() => verifyPreparationBinding(value)).toThrow("does not bind");
    }
    for (const status of ["behind", "diverged"]) {
      const value = binding();
      value.ledgerToMaster.status = status;
      expect(() => verifyPreparationBinding(value)).toThrow("does not bind");
    }
    const wrongJob = binding();
    wrongJob.jobs[0].name = "Verify and attest frozen candidate";
    expect(() => verifyPreparationBinding(wrongJob)).toThrow("does not bind");
  });

  it("rejects missing, expired, duplicated, or unbound preparation archives", () => {
    const value = binding();
    value.artifacts = [];
    expect(() => verifyPreparationBinding(value)).toThrow("Exactly one");
    for (const patch of [
      { expired: true },
      { digest: "" },
      { name: "specra-0.1.0-rc.1" },
    ]) {
      const value = binding();
      Object.assign(value.artifacts[0], patch);
      expect(() => verifyPreparationBinding(value)).toThrow("Exactly one");
    }
    const duplicate = binding();
    duplicate.artifacts.push(duplicate.artifacts[0]);
    expect(() => verifyPreparationBinding(duplicate)).toThrow("Exactly one");
  });

  it("matches the supported recorder exactly without rebuilding or mutating prepared subjects", async () => {
    const value = await fixture();
    const before = await readFile(
      path.join(value.candidateDirectory, "specra-cli-0.1.0-rc.2.tgz"),
    );
    await finalizePreparedCandidate(value);
    for (const name of ["SHA256SUMS", "public-distribution-0.1.0-rc.2.json"])
      expect(await readFile(path.join(value.candidateDirectory, name))).toEqual(
        await readFile(path.join(value.recordedCandidate, name)),
      );
    expect(
      await readFile(
        path.join(value.candidateDirectory, "specra-cli-0.1.0-rc.2.tgz"),
      ),
    ).toEqual(before);
    await expect(finalizePreparedCandidate(value)).rejects.toThrow(
      "exactly the five",
    );
  });

  it("fails closed on source, version, ledger digest, date, or policy drift", async () => {
    const value = await fixture();
    await expect(
      finalizePreparedCandidate({ ...value, sourceTag: "v0.1.0-rc.1" }),
    ).rejects.toThrow("source/tag");
    await expect(
      finalizePreparedCandidate({ ...value, sourceCommit: "c".repeat(40) }),
    ).rejects.toThrow("audit source");
    const ledgerPath = path.join(value.ledgerDirectory, "0.1.0-rc.2.json");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    for (const patch of [
      { artifactSha256: "d".repeat(64) },
      { version: "0.1.0-rc.1" },
      { licensor: "Other Corp" },
      { firstPublicDistribution: "2099-01-01" },
      { changeDate: "2030-10-05" },
    ]) {
      await writeFile(ledgerPath, JSON.stringify({ ...ledger, ...patch }));
      await expect(finalizePreparedCandidate(value)).rejects.toThrow(
        "Committed ledger",
      );
    }
  });

  it("rejects tampered, unexpected, linked, and duplicate checksum subjects", async () => {
    const value = await fixture();
    const checksumPath = path.join(value.candidateDirectory, "SHA256SUMS");
    const checksums = await readFile(checksumPath, "utf8");
    await writeFile(checksumPath, checksums + checksums.split("\n")[0] + "\n");
    await expect(finalizePreparedCandidate(value)).rejects.toThrow("duplicate");
    await writeFile(
      checksumPath,
      checksums.replace("specra-cli.cdx.json", "../escaped.json"),
    );
    await expect(finalizePreparedCandidate(value)).rejects.toThrow(
      "invalid subject",
    );
    await writeFile(checksumPath, checksums);
    await writeFile(
      path.join(value.candidateDirectory, "specra-cli.cdx.json"),
      "tampered",
    );
    await expect(finalizePreparedCandidate(value)).rejects.toThrow(
      "checksum verification",
    );
    await symlink(checksumPath, path.join(value.candidateDirectory, "extra"));
    await expect(finalizePreparedCandidate(value)).rejects.toThrow(
      "exactly the five",
    );
    await rm(path.join(value.candidateDirectory, "extra"));
    await rm(path.join(value.candidateDirectory, "specra-cli.cdx.json"));
    await symlink(
      checksumPath,
      path.join(value.candidateDirectory, "specra-cli.cdx.json"),
    );
    await expect(finalizePreparedCandidate(value)).rejects.toThrow(
      "regular files",
    );
  });
});
