import { createHash } from "node:crypto";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { releaseIdentity } from "./release-identity.mjs";

import {
  confirmedLicensor,
  licenseMetadata,
  readLicensePolicy,
} from "./license-policy.mjs";

export function verifyPreparationBinding({
  repository,
  sourceCommit,
  sourceTag,
  run,
  jobs,
  artifacts,
  sourceToLedger,
  ledgerToMaster,
}) {
  if (
    !/^[a-f0-9]{40}$/.test(sourceCommit ?? "") ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.head_sha !== sourceCommit ||
    run.head_branch !== sourceTag ||
    run.path !== ".github/workflows/release-candidate.yml" ||
    run.event !== "workflow_dispatch" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    !jobs.some(
      (job) =>
        job.name === "Reviewed candidate preparation" &&
        job.conclusion === "success",
    ) ||
    !["ahead", "identical"].includes(sourceToLedger.status) ||
    !["ahead", "identical"].includes(ledgerToMaster.status)
  )
    throw new Error(
      "Preparation run or reviewed master ledger does not bind to the frozen release source.",
    );
  const matches = artifacts.filter(
    (artifact) =>
      artifact.name === releaseIdentity(sourceTag.slice(1)).preparedArtifact &&
      artifact.expired === false,
  );
  if (
    matches.length !== 1 ||
    !Number.isSafeInteger(matches[0].id) ||
    !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest ?? "")
  )
    throw new Error(
      "Exactly one immutable, digest-bound preparation artifact is required.",
    );
  return matches[0];
}

export async function finalizePreparedCandidate({
  repositoryRoot,
  candidateDirectory,
  ledgerDirectory,
  sourceCommit,
  sourceTag,
}) {
  const { version } = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? "") || sourceTag !== `v${version}`)
    throw new Error("Candidate source/tag does not match the release version.");
  const identity = releaseIdentity(version);
  const names = [
    identity.tarball,
    identity.sbom,
    "license-metadata.json",
    "release-audit.json",
  ];
  const suppliedNames = (await readdir(candidateDirectory)).sort();
  if (
    JSON.stringify(suppliedNames) !==
    JSON.stringify([...names, "SHA256SUMS"].sort())
  )
    throw new Error(
      "Prepared candidate must contain exactly the five expected files.",
    );
  for (const name of suppliedNames) {
    if (!(await lstat(path.join(candidateDirectory, name))).isFile())
      throw new Error(
        "Prepared candidate subjects must be regular files, not links.",
      );
  }
  const hashes = new Map();
  for (const line of (
    await readFile(path.join(candidateDirectory, "SHA256SUMS"), "utf8")
  )
    .trim()
    .split("\n")) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || !names.includes(match[2]) || hashes.has(match[2]))
      throw new Error(
        "Prepared checksum manifest has an unknown, duplicate, or invalid subject.",
      );
    hashes.set(match[2], match[1]);
  }
  for (const name of names) {
    if (
      hashes.get(name) !==
      sha256(await readFile(path.join(candidateDirectory, name)))
    )
      throw new Error(`Prepared subject ${name} fails checksum verification.`);
  }
  const policy = await readLicensePolicy(repositoryRoot);
  if (
    confirmedLicensor(policy) === null ||
    policy.finalParametersOwnerApproved !== true
  )
    throw new Error("Release license policy is not owner-confirmed.");
  const metadata = JSON.parse(
    await readFile(
      path.join(candidateDirectory, "license-metadata.json"),
      "utf8",
    ),
  );
  if (
    JSON.stringify(metadata) !==
    JSON.stringify(licenseMetadata(policy, version))
  )
    throw new Error(
      "Prepared metadata is not the exact undated, owner-confirmed release policy.",
    );
  const audit = JSON.parse(
    await readFile(path.join(candidateDirectory, "release-audit.json"), "utf8"),
  );
  if (
    audit.sourceCommit !== sourceCommit ||
    audit.version !== version ||
    audit.license !== policy.currentLicense ||
    audit.artifact !== names[0]
  )
    throw new Error(
      "Prepared audit source, version, license, or artifact mismatch.",
    );
  const ledgerBytes = await readFile(
    path.join(ledgerDirectory, `${version}.json`),
  );
  const ledger = JSON.parse(ledgerBytes.toString("utf8"));
  const expected = {
    ...licenseMetadata(policy, version, ledger.firstPublicDistribution),
    sourceCommit,
    artifact: names[0],
    artifactSha256: hashes.get(names[0]),
  };
  if (
    typeof ledger.firstPublicDistribution !== "string" ||
    ledger.firstPublicDistribution > new Date().toISOString().slice(0, 10) ||
    JSON.stringify(ledger) !== JSON.stringify(expected)
  )
    throw new Error(
      "Committed ledger date, policy, source, version, or tarball digest mismatch.",
    );
  const record = `public-distribution-${version}.json`;
  await writeFile(path.join(candidateDirectory, record), ledgerBytes, {
    flag: "wx",
  });
  hashes.set(record, sha256(ledgerBytes));
  await writeFile(
    path.join(candidateDirectory, "SHA256SUMS"),
    `${[...hashes]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, digest]) => `${digest}  ${name}`)
      .join("\n")}\n`,
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
