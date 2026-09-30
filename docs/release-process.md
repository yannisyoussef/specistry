# Release candidate and promotion

SPEC-012 prepares evidence; it does not publish a package, push an image, or
promote `develop` to `master`.

## Candidate contents

An inspectable candidate contains:

- the staged and packed `@specra/cli` tarball;
- the production reader image or its reproducible build context;
- SHA-256 checksums;
- a standard CycloneDX or SPDX SBOM;
- package-content and dependency-license audits;
- the compatibility, support, deployment, security, and license-decision
  records;
- provenance status and the exact source commit.

The initial software version is `0.1.0-rc.1`: the complete planned v1 slices
are present, while public license, human assistive-technology evidence, and
live registry/image provenance remain owner or release-manager gates. `1.0.0`
would overstate those unresolved obligations.

## Promotion sequence

1. Merge the SPEC-012 feature PR into `develop` after all required checks and
   reviews are green.
2. Verify `develop` in integration with the packed CLI, Odexa, self-docs, and
   the production reader.
3. Resolve the license and human assistive-technology blockers.
4. Generate the final candidate from the reviewed commit, verify checksums and
   SBOM, then execute the dedicated provenance-capable release workflow.
5. Open an explicit, owner-approved `develop` → `master` promotion PR.

Ordinary PR CI keeps `contents: read`. OIDC, attestations, package publication,
and registry write permissions belong only in a dedicated protected release
workflow. `.github/workflows/release-candidate.yml` is manual, targets the
protected `release` environment, refuses to run while the manifest is
`UNLICENSED`, and uses GitHub's pinned build-provenance action. It produces no
registry publication by itself. A prepared workflow is not evidence of a live
attestation; report that state as
`PROVENANCE WORKFLOW PREPARED — LIVE ATTESTATION NOT EXECUTED`.
