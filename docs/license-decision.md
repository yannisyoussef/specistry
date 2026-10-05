# Software license decision

Status: **BUSINESS TERMS DECIDED — licensor identity, authority, and legal
effectiveness still require confirmation before public distribution.**

The owner selected the Business Source License 1.1 (`BUSL-1.1`) business model
for Specra. The exact Licensor parameter and legal effectiveness are not final
until the confirmations below are recorded.
The current license is source-available, not open source. Each specific
version changes to the Apache License, Version 2.0 (`Apache-2.0`) three years
after that version's first public distribution.

## Approved parameters

- **Proposed licensor:** INFINITY VENTURES.
- **Licensed Work:** Specra. The standard BSL terms apply separately to each
  version.
- **Change Date:** three years after the first publicly available distribution
  of each specific version.
- **Change License:** Apache License, Version 2.0.
- **Additional Use Grant:** “You may make production use of the Licensed Work
  to create, host, and publish documentation for products, services, APIs,
  projects, or internal systems owned or operated by you or your organization,
  including for commercial purposes, provided that you do not offer the
  Licensed Work itself, or a service whose primary value is the functionality
  of the Licensed Work, as a hosted or managed service to third parties.”

The authoritative current text is [LICENSE](../LICENSE). The future license
text is retained at [LICENSES/Apache-2.0.txt](../LICENSES/Apache-2.0.txt).
`license-policy.json` is the machine-readable policy used by release gates and
candidate metadata.

## Usage guide

While a version remains under BSL 1.1, the Additional Use Grant permits:

- personal self-hosting;
- internal company use;
- production documentation for products, services, APIs, projects, or
  internal systems owned or operated by you or your organization, including
  commercial use; and
- modification where the resulting use remains within the license and grant.

Offering the Licensed Work itself, or a service whose primary value is its
functionality, as a hosted or managed service to third parties is outside the
Additional Use Grant and may require a separate commercial agreement with the
Licensor while that version remains under BSL.

These examples are explanatory and do not replace the license text:

| Scenario                                                                                   | Guidance                                                                                                                 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| A company hosts `docs.example.com` with Specra for its own product                         | Permitted by the Additional Use Grant.                                                                                   |
| A source-available or open-source project self-hosts its own documentation with Specra     | Permitted by the Additional Use Grant.                                                                                   |
| A consultant installs Specra in a customer's infrastructure for that customer's own docs   | Evaluate the exact grant and deployment facts; do not assume rights beyond the license. Contact the Licensor if unclear. |
| A vendor sells a multi-tenant “Hosted Specra” documentation service to third-party clients | A commercial agreement is required while the applicable version remains under BSL.                                       |

For edge cases, rely on the authoritative license and obtain guidance from the
Licensor rather than extending these examples by analogy.

## Required owner confirmation

Repository and nearby company records do not establish the legal suffix or
jurisdiction of INFINITY VENTURES, nor do they prove that it owns the relevant
copyrights or is authorized to license them. Before any public distribution,
an authorized owner must record:

1. the exact legal entity name, including its legal form and jurisdiction;
2. confirmation that the entity owns or is authorized to license the work;
3. approval of the final populated license parameters.

Qualified external legal review of those final parameters is strongly
recommended before release, but no such review is currently recorded and this
repository does not claim that it occurred.

Until then, the protected release workflow fails closed. The current LICENSE
parameter identifies the proposed name and pending confirmation without adding
an invented corporate suffix or copyright claim. It must be regenerated with
the exact confirmed legal name before release.

## Operational policy

There is no runtime license key, phone-home check, feature restriction, or DRM.
The policy is enforced through authoritative license files, consistent package
metadata, immutable release records, and a release gate. Candidate metadata
keeps `firstPublicDistribution` and `changeDate` null because a build or dry run
is not a public distribution. At actual publication, the release operator must
create the immutable per-version record; its Change Date is derived from the
recorded first-public-distribution date.

The Specra name, Specra logo, and associated branding are trademarks or brand
assets of their respective owner. The software license grants no trademark
rights except as expressly required by the license. This repository record is
implementation evidence, not legal advice; external counsel should validate
the final licensor identity, ownership chain, and approved grant before release.
