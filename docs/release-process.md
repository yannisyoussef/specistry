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
- `license-metadata.json`, with the current license, future license, per-version
  Change Date policy, and deliberately null distribution dates for an
  unpublished candidate;
- provenance status and the exact source commit.

The next software version is `0.1.0-rc.2`: the complete planned v1 slices, the
owner-confirmed Licensor and authority, and the approved BSL 1.1 policy are
present. The owner accepts manual VoiceOver/NVDA qualification as P2 residual
[A11Y-R01](reviews/spec-012-manual-at.md) for pre-1.0 RCs. It remains a blocker
for stable `1.0.0` and comprehensive accessibility claims. Verified protected
provenance, candidate integrity, and the committed public-distribution ledger
remain required for RC publication. GitHub repository visibility and a GitHub
pre-release with artifacts are the initial public distribution channel; npm and
container registry publication may follow separately.

## Promotion sequence

1. Merge the SPEC-012 feature PR into `develop` after all required checks and
   reviews are green.
2. Verify `develop` in integration with the packed CLI, Odexa, self-docs, and
   the production reader.
3. Treat the owner confirmation of the Licensor, ownership, licensing
   authority, and final populated license parameters as complete. Commit the
   owner-accepted manual AT deferral and preserve its stable-release obligation.
   Qualified external legal review remains strongly recommended and unrecorded;
   it is not an RC blocker.
4. Freeze the exact green `develop` source, open its explicit `develop` →
   `master` promotion PR, merge only after green checks, and verify post-merge CI.
5. Run the protected candidate workflow against the reviewed `master` release
   source. Verify attestations for the actual artifact digests, checksums, SBOM,
   licensing metadata, and source commit before preparing publication.
6. Generate and commit the immutable ledger through a reviewed PR, attest its
   identical candidate copy and updated checksum manifest, and tag the original
   artifact-producing source. Make the repository public and publish the GitHub
   pre-release on the recorded first-public-distribution date.

Ordinary PR CI keeps `contents: read`. OIDC, attestations, package publication,
and registry write permissions belong only in a dedicated protected release
workflow. `.github/workflows/release-candidate.yml` is manual, targets the
protected `release` environment, validates every manifest and authoritative
license surface, including the confirmed licensor identity and authority. It
uses GitHub's pinned build-provenance action
and produces no registry publication by itself. A prepared workflow is not
evidence of a live attestation; report that state as
`PROVENANCE WORKFLOW PREPARED — LIVE ATTESTATION NOT EXECUTED`.

## Per-version Change Date record

Building, testing, uploading a private CI artifact, or conducting a dry run is
not recorded as public distribution. Candidate metadata therefore keeps
`firstPublicDistribution` and `changeDate` null. The candidate workflow never
accepts a distribution date. At the actual public distribution event, a future
protected publication transaction must run:

```bash
pnpm release:record-public-distribution -- YYYY-MM-DD .release/specra-0.1.0-rc.2
```

The command derives a canonical versioned record name inside the repository's
`release-ledger/` authority, rejects future dates and version or digest
mismatches, refuses to overwrite a record, requires the licensor
confirmations and final owner approval, binds the record to the source commit
and tarball digest, writes an identical candidate copy, updates `SHA256SUMS`,
and deterministically derives the Change Date three calendar years later.

That future transaction must commit the ledger record through branch
protection and attest its identical checksummed candidate copy before making
the version public. It is deliberately not part of the candidate-only workflow
and has not been executed or claimed here. Publication must never reuse a date
record from another version or create an uncommitted or unchecksummed side
record.
