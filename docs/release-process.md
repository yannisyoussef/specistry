# Release candidate and promotion

The next candidate is **Specistry 0.1.0-rc.3**, the first planned npm release
as `@specistry/cli@next`. It is not yet published. Source packages are private;
only the explicitly staged, qualified CLI artifact is publishable.

## Immutable history

The [brand migration](brand-migration.md) preserves Specra 0.1.0-rc.2 under its
original identity. Never move its tag or change its release, assets, SBOM,
checksums, provenance or `release-ledger/0.1.0-rc.2.json`. Its first distribution
was 2026-10-06 and its Apache-2.0 Change Date is 2029-10-06. Historical signer
identities remain the original repository identity even after redirects.

## Reviewed promotion

1. Review BRAND-001 against `develop`. All existing CI gates and specialist
   reviews must pass; resolve every P0/P1 finding. Merge under the repository's
   normal policy and verify exact post-merge integration CI.
2. Promote only that green source through an explicit `develop` → `master`
   PR, then verify exact post-merge production CI.
3. Secure npm organization/scope `specistry` with owner publishing authority.
   Do not use a substitute scope. Confirm release infrastructure is ready.
4. Only then rename `yannisyoussef/specra` to `yannisyoussef/specistry` and
   verify old GitHub URLs redirect. Active metadata names the new repository;
   historical records retain their original names.
5. Freeze green production source and create its annotated version tag. Add
   that exact tag to the `release` environment deployment policy; retain
   historical policies, never broaden to unreviewed branches or wildcard tags.

## Build once, qualify once, publish the same bytes

Dispatch `.github/workflows/release-candidate.yml` on the exact version tag with
`mode=prepare`. The protected, read-only preparation job requires an annotated
tag resolving to successful exact-source production CI and master ancestry.
It runs all quality/build/audit/license gates, stages and packs once, and runs
npm/pnpm self-documentation and pinned reviewed Odexa integration against that
**same tarball**. Qualification is recorded in `release-audit.json`, bound to the
tarball digest and Odexa source. The package remains unchanged.

The prepared artifact contains five files: `specistry-cli-<version>.tgz`,
`specistry-cli.cdx.json`, `license-metadata.json`, `release-audit.json`, and
`SHA256SUMS`. Its metadata deliberately leaves distribution dates null:
building or testing does not invent a distribution event.

Record the actual earliest public distribution of this specific version,
including public versioned source where applicable. Never reuse another
version's record or date. Use the verified candidate and immutable recorder:

```bash
pnpm release:record-public-distribution -- YYYY-MM-DD .release/candidate
```

The recorder refuses existing records, future dates, license drift and
source/version/digest mismatches. It derives the Apache-2.0 Change Date three
calendar years later. Commit the record via a reviewed PR to `master`; leave
the version tag on the artifact-producing source. A later artifact upload does
not reset the version's earlier public-source distribution date.

Dispatch `mode=attest` on the original tag with the successful preparation run
ID and reviewed ledger commit. This protected job downloads the immutable,
digest-bound preparation artifact, checks every subject and ledger ancestry,
copies the exact record and updates checksums without rebuilding. Only this
job receives OIDC/attestation-write permissions. Cryptographically verify all
six signed subjects against the canonical repository, exact tag, source and
workflow digest and hosted runner before publishing the GitHub pre-release.
Preserve the signed bundle and actual verification output as separate evidence.
The audit's preparation-time `attestation.executed: false` stays truthful.

Ordinary CI remains read-only. A prepared workflow is not live provenance;
until execution and verification, report
`PROVENANCE WORKFLOW PREPARED — LIVE ATTESTATION NOT EXECUTED`.

## First npm publication and Trusted Publishing

The owner must create/claim organization `specistry` and log in with publishing
authority. If first publication requires login/2FA, stop for that owner action:
do not bypass 2FA, publish a placeholder or add a persistent `NPM_TOKEN`.
Publish the verified RC3 `.tgz` with
`--ignore-scripts --access public --tag next --registry=https://registry.npmjs.org`.
Never publish a directory, repack, rebuild or reuse a name/version pair.

Once package settings are available, configure npm's GitHub Trusted Publisher:

| Field             | Value                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| Organization/user | `yannisyoussef`                                                         |
| Repository        | `specistry`                                                             |
| Workflow filename | `npm-publish.yml`                                                       |
| Environment       | `release`                                                               |
| Allowed actions   | Enable **Allow npm publish** (new configurations default to stage-only) |

Normal publication uses short-lived OIDC on GitHub-hosted runners, npm ≥11.5.1,
and Node 24. The dedicated workflow compiles nothing: it resolves the reviewed
release, verifies all signed subjects, GitHub asset digests, checksums, exact
ledger, tarball manifest, legal files, private bundled closure and consumer
qualification, then publishes that `.tgz`. RCs use `next`; stable releases use
`latest`. No separate dist-tag-management permission is needed. See
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/).

After publication, anonymously compare npm's downloaded tarball SHA-256 and
SHA-512 integrity with the qualified GitHub bytes; verify `next` and that RC3 is
not `latest`. A fresh registry installation must execute `specistry --help`,
build and check self-docs before publication is reported complete. Only then
present registry installation commands as live in the documentation.

## Accepted residuals

BUSL-1.1, Licensor INFINITY VENTURES (SASU), the Additional Use Grant and future
Apache-2.0 policy remain owner-confirmed and unchanged. External legal review
is strongly recommended and `not-recorded`; it is not an RC blocker.
Automated accessibility and cross-browser gates remain required. Manual
VoiceOver/NVDA is **DEFERRED TO 1.0.0**, under existing A11Y-R01; no comprehensive
screen-reader validation or formal WCAG conformance is claimed. Existing
advisory decisions and review dates are not reset by the rename.
