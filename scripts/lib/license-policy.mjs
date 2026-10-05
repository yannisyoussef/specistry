import { readFile } from "node:fs/promises";
import path from "node:path";

export const CURRENT_LICENSE = "BUSL-1.1";
export const CHANGE_LICENSE = "Apache-2.0";
export const CHANGE_DATE_YEARS = 3;
export const LICENSED_WORK = "Specra";
export const ADDITIONAL_USE_GRANT =
  "You may make production use of the Licensed Work to create, host, and publish documentation for products, services, APIs, projects, or internal systems owned or operated by you or your organization, including for commercial purposes, provided that you do not offer the Licensed Work itself, or a service whose primary value is the functionality of the Licensed Work, as a hosted or managed service to third parties.";
export const TRADEMARK_NOTICE =
  "The Specra name, Specra logo, and associated branding are trademarks or brand assets of their respective owner. The software license does not grant trademark rights except as expressly required by the license.";

export async function readLicensePolicy(repositoryRoot) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, "license-policy.json"), "utf8"),
  );
}

export function licenseMetadata(policy, version, firstPublicDistribution) {
  const publicDate =
    firstPublicDistribution === undefined
      ? null
      : parseIsoDate(firstPublicDistribution);
  return {
    schemaVersion: 1,
    version,
    currentLicense: policy.currentLicense,
    licensor: policy.licensor.legalName ?? policy.licensor.proposedName,
    legalForm: policy.licensor.legalForm ?? null,
    licensorConfirmed:
      policy.licensor.legalNameConfirmed === true &&
      policy.licensor.licensingAuthorityConfirmed === true,
    finalParametersOwnerApproved: policy.finalParametersOwnerApproved === true,
    firstPublicDistribution: publicDate,
    changeDate:
      publicDate === null
        ? null
        : addCalendarYears(
            publicDate,
            policy.changeDatePolicy.yearsAfterFirstPublicDistribution,
          ),
    changeDatePolicy: policy.changeDatePolicy,
    changeLicense: policy.changeLicense,
  };
}

export function expectedLicensePreamble(policy) {
  const confirmed = confirmedLicensor(policy);
  const licensor =
    confirmed ??
    `${policy.licensor.proposedName} (exact legal entity name and licensing authority\npending owner confirmation before public distribution)`;
  return `Business Source License 1.1

Parameters

Licensor: ${licensor}

Licensed Work: ${LICENSED_WORK}

Additional Use Grant: ${ADDITIONAL_USE_GRANT}

Change Date: Three years after the first public distribution of each specific
version of the Licensed Work.

Change License: Apache License, Version 2.0

-----------------------------------------------------------------------------

`;
}

export function expectedNotice(policy) {
  const confirmed = confirmedLicensor(policy);
  const identity = confirmed
    ? `Copyright © ${confirmed}

${confirmed} is a société par actions simplifiée unipersonnelle (${policy.licensor.legalForm}).`
    : `The exact legal entity name and licensing authority for the proposed licensor,
${policy.licensor.proposedName}, must be confirmed by the owner before public distribution.`;
  return `Specra

${identity}

The Specra name, Specra logo, and associated branding are trademarks or brand
assets of their respective owner. The software license does not grant
trademark rights except as expressly required by the license.
`;
}

export function confirmedLicensor(policy) {
  if (
    policy.licensor?.legalNameConfirmed !== true ||
    policy.licensor?.licensingAuthorityConfirmed !== true ||
    typeof policy.licensor?.legalName !== "string" ||
    policy.licensor.legalName.trim() === ""
  )
    return null;
  return policy.licensor.legalName.trim();
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      "First public distribution must be an ISO date (YYYY-MM-DD).",
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("First public distribution must be a real calendar date.");
  }
  return value;
}

function addCalendarYears(value, years) {
  const [year, month, day] = value.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year + years, month, 0)).getUTCDate();
  return [
    String(year + years).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
}
