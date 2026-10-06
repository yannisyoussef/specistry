import { createHash } from "node:crypto";
import { licenseMetadata } from "./license-policy.mjs";
import {
  NPM_REGISTRY,
  RELEASE_REPOSITORY,
  releaseIdentity,
} from "./release-identity.mjs";

export function verifyPublishableManifest(manifest, version) {
  const identity = releaseIdentity(version);
  if (
    manifest.name !== identity.package ||
    manifest.version !== version ||
    manifest.private !== false ||
    manifest.license !== "BUSL-1.1" ||
    manifest.bin?.specistry !== "./dist/bin.js" ||
    Object.keys(manifest.bin ?? {}).length !== 1 ||
    manifest.publishConfig?.access !== "public" ||
    manifest.publishConfig?.registry !== NPM_REGISTRY ||
    manifest.repository?.url !==
      `git+https://github.com/${RELEASE_REPOSITORY}.git` ||
    manifest.homepage !== `https://github.com/${RELEASE_REPOSITORY}#readme` ||
    manifest.bugs?.url !== `https://github.com/${RELEASE_REPOSITORY}/issues` ||
    manifest.engines?.node !== ">=24.20.0 <25" ||
    Object.keys(manifest.scripts ?? {}).length !== 0 ||
    manifest.exports?.["."]?.types !== "./dist/index.d.ts" ||
    manifest.exports?.["."]?.default !== "./dist/index.js" ||
    !Array.isArray(manifest.bundleDependencies) ||
    manifest.bundleDependencies.some((name) => /^@specra\//.test(name)) ||
    Object.entries(manifest.dependencies ?? {}).some(
      ([name, range]) =>
        /^@specra\//.test(name) ||
        /^(?:workspace|link|file):/.test(range) ||
        !manifest.bundleDependencies.includes(name),
    )
  )
    throw new Error(
      "Publishable CLI identity, registry, license or bundled boundary mismatch.",
    );
  for (const name of [
    "config",
    "content",
    "model",
    "openapi",
    "playground",
    "quality",
    "release",
    "search",
    "snippets",
  ])
    if (!manifest.bundleDependencies.includes(`@specistry/${name}`))
      throw new Error("Missing internal bundled closure.");
  return identity;
}

export function verifyReleaseEvidence({
  version,
  sourceCommit,
  policy,
  subjects,
  ledgerBytes,
}) {
  const identity = releaseIdentity(version);
  const names = [
    identity.tarball,
    identity.sbom,
    "license-metadata.json",
    "release-audit.json",
    `public-distribution-${version}.json`,
  ];
  const sums =
    subjects.get("SHA256SUMS")?.toString("utf8").trim().split("\n") ?? [];
  const hashes = new Map();
  for (const line of sums) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || !names.includes(match[2]) || hashes.has(match[2]))
      throw new Error("Invalid or ambiguous release checksum subject.");
    hashes.set(match[2], match[1]);
  }
  for (const name of names)
    if (!subjects.has(name) || hashes.get(name) !== digest(subjects.get(name)))
      throw new Error(`Release checksum mismatch: ${name}`);
  const audit = JSON.parse(subjects.get("release-audit.json").toString("utf8"));
  if (
    !/^[a-f0-9]{40}$/.test(sourceCommit ?? "") ||
    audit.sourceCommit !== sourceCommit ||
    audit.package !== identity.package ||
    audit.version !== version ||
    audit.artifact !== identity.tarball ||
    audit.license !== policy.currentLicense ||
    audit.sbom !== identity.sbom ||
    audit.qualification?.selfDocumentation !== "PASS" ||
    audit.qualification?.odexa !== "PASS" ||
    audit.qualification?.artifactSha256 !== hashes.get(identity.tarball) ||
    !/^[a-f0-9]{40}$/.test(audit.qualification?.odexaSource ?? "") ||
    JSON.stringify(audit.qualification?.packageManagers) !==
      JSON.stringify(["npm", "pnpm"])
  )
    throw new Error(
      "Release audit lacks exact-source, same-tarball consumer qualification.",
    );
  if (
    JSON.stringify(JSON.parse(subjects.get("license-metadata.json"))) !==
    JSON.stringify(licenseMetadata(policy, version))
  )
    throw new Error("Prepared license metadata drifted.");
  const record = subjects.get(`public-distribution-${version}.json`);
  if (!record.equals(ledgerBytes))
    throw new Error("Published record differs from reviewed master ledger.");
  const ledger = JSON.parse(record.toString("utf8"));
  if (
    typeof ledger.firstPublicDistribution !== "string" ||
    ledger.firstPublicDistribution > new Date().toISOString().slice(0, 10)
  )
    throw new Error("Invalid distribution date.");
  const expected = {
    ...licenseMetadata(policy, version, ledger.firstPublicDistribution),
    sourceCommit,
    artifact: identity.tarball,
    artifactSha256: hashes.get(identity.tarball),
  };
  if (
    JSON.stringify(ledger) !== JSON.stringify(expected) ||
    !ledger.licensorConfirmed ||
    !ledger.finalParametersOwnerApproved
  )
    throw new Error("Distribution ledger policy, digest or source mismatch.");
  return {
    identity,
    subjects: [...names, "SHA256SUMS"],
    sha256: hashes.get(identity.tarball),
  };
}

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
