import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  ADDITIONAL_USE_GRANT,
  CHANGE_DATE_YEARS,
  CHANGE_LICENSE,
  CURRENT_LICENSE,
  LICENSED_WORK,
  TRADEMARK_NOTICE,
  expectedLicensePreamble,
  expectedNotice,
  readLicensePolicy,
} from "./lib/license-policy.mjs";

const root = process.cwd();
const manifestPaths = await workspaceManifestPaths(root);
const state = {
  apacheText: await readFile(
    path.join(root, "LICENSES", "Apache-2.0.txt"),
    "utf8",
  ),
  licenseText: await readFile(path.join(root, "LICENSE"), "utf8"),
  manifests: await Promise.all(
    manifestPaths.map(async (manifestPath) => ({
      manifestPath,
      manifest: JSON.parse(
        await readFile(path.join(root, manifestPath), "utf8"),
      ),
    })),
  ),
  notice: await readFile(path.join(root, "NOTICE"), "utf8"),
  policy: await readLicensePolicy(root),
};

const violations = validate(state);
selfTest(state);
if (violations.length > 0) {
  console.error(`Project license policy failed:\n${violations.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `Project license policy passed (${manifestPaths.length} manifests inspected; confirmed licensor and final parameters verified).`,
  );
}

export function validate(candidate) {
  const failures = [];
  const policy = candidate.policy;
  if (policy.currentLicense !== CURRENT_LICENSE)
    failures.push(
      `license-policy.json: currentLicense must be ${CURRENT_LICENSE}`,
    );
  if (policy.additionalUseGrant !== ADDITIONAL_USE_GRANT)
    failures.push(
      "license-policy.json: Additional Use Grant differs from the owner-approved text",
    );
  if (policy.licensedWork !== LICENSED_WORK)
    failures.push(`license-policy.json: licensedWork must be ${LICENSED_WORK}`);
  if (policy.trademarkNotice !== TRADEMARK_NOTICE)
    failures.push(
      "license-policy.json: trademark notice differs from the approved text",
    );
  if (
    policy.changeDatePolicy?.yearsAfterFirstPublicDistribution !==
      CHANGE_DATE_YEARS ||
    policy.changeDatePolicy?.appliesPerVersion !== true
  )
    failures.push(
      "license-policy.json: Change Date must be three years after each version's first public distribution",
    );
  if (policy.changeLicense !== CHANGE_LICENSE)
    failures.push(
      `license-policy.json: changeLicense must be ${CHANGE_LICENSE}`,
    );
  if (policy.licensor?.proposedName !== "INFINITY VENTURES")
    failures.push(
      "license-policy.json: proposedName must remain INFINITY VENTURES as the decision history",
    );
  if (policy.licensor?.legalName !== "INFINITY VENTURES")
    failures.push(
      "license-policy.json: legalName must be the confirmed INFINITY VENTURES name",
    );
  if (policy.licensor?.legalForm !== "SASU")
    failures.push("license-policy.json: legalForm must be SASU");
  if (policy.licensor?.legalNameConfirmed !== true)
    failures.push(
      "license-policy.json: legalNameConfirmed must record owner confirmation",
    );
  if (policy.licensor?.licensingAuthorityConfirmed !== true)
    failures.push(
      "license-policy.json: licensingAuthorityConfirmed must record owner confirmation",
    );
  if (policy.finalParametersOwnerApproved !== true)
    failures.push(
      "license-policy.json: finalParametersOwnerApproved must record owner approval",
    );
  if (
    policy.externalLegalReview?.status !== "not-recorded" &&
    policy.externalLegalReview?.status !== "recorded"
  )
    failures.push(
      "license-policy.json: externalLegalReview status must be recorded or not-recorded",
    );
  if (
    policy.externalLegalReview?.status === "recorded" &&
    (typeof policy.externalLegalReview.reference !== "string" ||
      policy.externalLegalReview.reference.trim() === "")
  )
    failures.push(
      "license-policy.json: a recorded external legal review requires a reference",
    );

  const versions = new Set();
  for (const { manifestPath, manifest } of candidate.manifests) {
    if (manifest.license !== CURRENT_LICENSE)
      failures.push(`${manifestPath}: license must be ${CURRENT_LICENSE}`);
    if (typeof manifest.version !== "string" || manifest.version.length === 0)
      failures.push(`${manifestPath}: version must be explicit`);
    else versions.add(manifest.version);
  }
  if (versions.size !== 1)
    failures.push("workspace manifests must declare one release version");

  const canonicalStart = candidate.licenseText.indexOf(
    "License text copyright",
  );
  if (
    canonicalStart < 0 ||
    sha256(candidate.licenseText.slice(canonicalStart)) !==
      "49f7d282c4f8c1fca669f0eb57a6cee4758fd4b33defbe9d825f664437173656"
  )
    failures.push(
      "LICENSE: canonical Business Source License 1.1 terms changed",
    );
  const canonicalTerms =
    canonicalStart < 0 ? "" : candidate.licenseText.slice(canonicalStart);
  if (
    candidate.licenseText !==
    `${expectedLicensePreamble(policy)}${canonicalTerms}`
  )
    failures.push(
      "LICENSE: parameter block must contain only the exact permitted BSL parameters",
    );
  if (
    sha256(candidate.apacheText) !==
    "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4"
  )
    failures.push(
      "LICENSES/Apache-2.0.txt: canonical future license text changed",
    );
  if (candidate.notice !== expectedNotice(policy))
    failures.push(
      "NOTICE: trademark or licensor statement is missing, stale, or inconsistent",
    );
  return failures;
}

function selfTest(validState) {
  if (validate(validState).length > 0) return;
  for (let index = 0; index < validState.manifests.length; index += 1) {
    const manifests = structuredClone(validState.manifests);
    manifests[index].manifest.license = "UNLICENSED";
    if (
      !validate({ ...validState, manifests }).some((failure) =>
        failure.includes(manifests[index].manifestPath),
      )
    ) {
      throw new Error(
        `License gate self-test did not reject ${manifests[index].manifestPath}.`,
      );
    }
  }
  if (
    !validate({
      ...validState,
      policy: { ...validState.policy, additionalUseGrant: "changed" },
    }).some((failure) => failure.includes("Additional Use Grant"))
  )
    throw new Error(
      "License gate self-test did not reject changed grant wording.",
    );
}

async function workspaceManifestPaths(workspaceRoot) {
  const paths = ["package.json"];
  for (const group of ["apps", "packages"]) {
    for (const entry of await readdir(path.join(workspaceRoot, group), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory())
        paths.push(path.join(group, entry.name, "package.json"));
    }
  }
  return paths.sort();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
