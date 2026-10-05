import process from "node:process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  confirmedLicensor,
  expectedLicensePreamble,
  expectedNotice,
  readLicensePolicy,
} from "./lib/license-policy.mjs";

const root = process.cwd();
const policy = await readLicensePolicy(root);
const blockers = [];
if (policy.currentLicense !== "BUSL-1.1")
  blockers.push("current license is not BUSL-1.1");
if (policy.licensor?.legalNameConfirmed !== true)
  blockers.push("exact licensor legal name is not owner-confirmed");
if (policy.licensor?.licensingAuthorityConfirmed !== true)
  blockers.push(
    "licensor copyright ownership or licensing authority is not owner-confirmed",
  );
if (
  typeof policy.licensor?.legalName !== "string" ||
  policy.licensor.legalName.trim() === ""
)
  blockers.push("confirmed licensor legal name is missing");
if (policy.licensor?.legalName !== "INFINITY VENTURES")
  blockers.push("confirmed licensor legal name is not INFINITY VENTURES");
if (policy.licensor?.legalForm !== "SASU")
  blockers.push("confirmed licensor legal form is not SASU");
if (policy.finalParametersOwnerApproved !== true)
  blockers.push("final populated license parameters are not owner-approved");
const licensor = confirmedLicensor(policy);
const licenseText = await readFile(path.join(root, "LICENSE"), "utf8");
const notice = await readFile(path.join(root, "NOTICE"), "utf8");
if (
  licensor !== null &&
  !licenseText.startsWith(expectedLicensePreamble(policy))
)
  blockers.push(
    "LICENSE does not name the exact confirmed licensor or has stale parameters",
  );
if (licensor !== null && notice !== expectedNotice(policy))
  blockers.push("NOTICE has stale or inconsistent licensor text");

if (blockers.length > 0) {
  console.error(`Public release license gate blocked:\n${blockers.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(
    `Public release license gate passed for ${policy.licensor.legalName}.`,
  );
}
