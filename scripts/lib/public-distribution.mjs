import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  confirmedLicensor,
  licenseMetadata,
  readLicensePolicy,
} from "./license-policy.mjs";

export async function recordPublicDistribution({
  repositoryRoot,
  candidateDirectory,
  firstPublicDistribution,
  today = new Date().toISOString().slice(0, 10),
}) {
  const policy = await readLicensePolicy(repositoryRoot);
  if (confirmedLicensor(policy) === null)
    throw new Error(
      "Public distribution cannot be recorded until the exact licensor legal name and licensing authority are owner-confirmed.",
    );
  if (policy.finalParametersOwnerApproved !== true)
    throw new Error(
      "Public distribution cannot be recorded until the final populated license parameters are owner-approved.",
    );
  if (firstPublicDistribution > today)
    throw new Error("First public distribution cannot be a future date.");

  const repositoryManifest = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );
  const candidateMetadata = JSON.parse(
    await readFile(
      path.join(candidateDirectory, "license-metadata.json"),
      "utf8",
    ),
  );
  const audit = JSON.parse(
    await readFile(path.join(candidateDirectory, "release-audit.json"), "utf8"),
  );
  if (
    candidateMetadata.version !== repositoryManifest.version ||
    audit.version !== repositoryManifest.version
  )
    throw new Error(
      "Candidate version does not match the repository release version.",
    );
  if (
    candidateMetadata.firstPublicDistribution !== null ||
    candidateMetadata.changeDate !== null
  )
    throw new Error("Candidate license metadata is not an undated dry run.");
  if (candidateMetadata.licensorConfirmed !== true)
    throw new Error(
      "Candidate was not built with confirmed licensor metadata.",
    );
  const expectedCandidateMetadata = licenseMetadata(
    policy,
    repositoryManifest.version,
  );
  if (
    JSON.stringify(candidateMetadata) !==
    JSON.stringify(expectedCandidateMetadata)
  )
    throw new Error(
      "Candidate license metadata does not match the confirmed repository policy.",
    );
  if (
    audit.license !== policy.currentLicense ||
    typeof audit.sourceCommit !== "string" ||
    audit.sourceCommit.trim() === "" ||
    typeof audit.artifact !== "string" ||
    path.basename(audit.artifact) !== audit.artifact
  )
    throw new Error("Candidate release audit is incomplete or inconsistent.");

  const artifact = path.join(candidateDirectory, audit.artifact);
  const artifactSha256 = sha256(await readFile(artifact));
  const checksumPath = path.join(candidateDirectory, "SHA256SUMS");
  const checksums = parseChecksums(await readFile(checksumPath, "utf8"));
  for (const [name, expected] of checksums) {
    const actual = sha256(await readFile(path.join(candidateDirectory, name)));
    if (actual !== expected)
      throw new Error(`Candidate artifact ${name} does not match SHA256SUMS.`);
  }
  if (checksums.get(audit.artifact) !== artifactSha256)
    throw new Error("Candidate tarball is absent from SHA256SUMS.");

  const metadata = {
    ...licenseMetadata(
      policy,
      repositoryManifest.version,
      firstPublicDistribution,
    ),
    sourceCommit: audit.sourceCommit,
    artifact: audit.artifact,
    artifactSha256,
  };
  const ledgerDirectory = path.join(repositoryRoot, "release-ledger");
  const output = path.join(
    ledgerDirectory,
    `${repositoryManifest.version}.json`,
  );
  const candidateRecord = path.join(
    candidateDirectory,
    `public-distribution-${repositoryManifest.version}.json`,
  );
  for (const candidate of [output, candidateRecord]) {
    try {
      await access(candidate);
      throw new Error(
        `A public-distribution record already exists for ${repositoryManifest.version}.`,
      );
    } catch (error) {
      if (error instanceof Error && !error.message.includes("ENOENT"))
        throw error;
    }
  }

  const serialized = `${JSON.stringify(metadata, null, 2)}\n`;
  await mkdir(ledgerDirectory, { recursive: true });
  await writeFile(output, serialized, { flag: "wx" });
  await writeFile(candidateRecord, serialized, { flag: "wx" });
  checksums.set(path.basename(candidateRecord), sha256(serialized));
  const checksumLines = [...checksums.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, digest]) => `${digest}  ${name}`);
  await writeFile(checksumPath, `${checksumLines.join("\n")}\n`);
  return output;
}

function parseChecksums(value) {
  const checksums = new Map();
  for (const line of value.trim().split("\n")) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (match === null) throw new Error("SHA256SUMS contains an invalid line.");
    checksums.set(match[2], match[1]);
  }
  return checksums;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
