# Specra licensing decision review

Date: 2026-10-05

Scope: narrow implementation of the owner-selected BSL 1.1 business terms on
the green `develop` baseline. This review is a consistency and release-safety
review, not legal advice or evidence of external counsel approval.

## Review passes

- **Principal Engineer / Supply Chain:** pass after fixes. The candidate builder
  now stages outside the repository, packs the canonical real path, proves the
  bundled dependency set, performs strict npm inventory for the SBOM, and
  verifies that every packed dependency is represented. The exact generated
  tarball is clean-installed in the licensing test.
- **Documentation / Product / DX:** pass after fixes. Public and dogfood wording
  consistently says source-available rather than open source, installation
  leads with the unpublished tarball, and the future release record is
  checksummed, versioned, artifact-bound, and backed by a durable tracked
  ledger rather than per-run temporary state.
- **License consistency:** pass with owner and counsel gates. The canonical BSL
  and Apache texts are hash-locked. The entire BSL parameter preamble is exact,
  not merely substring-checked. Confirmed owner data must match both `LICENSE`
  and `NOTICE`, so changing flags alone cannot authorize a release.

## Findings resolved

- P1: protected release could not stage inside `.release` — fixed with an
  external canonical staging directory.
- P1: a symlinked staging path could produce a dependency-free tarball and a
  mismatched SBOM — fixed by packing the staging script's canonical path and
  asserting the complete bundle and SBOM sets.
- P1: owner-confirmation flags could pass while shipped legal files remained
  provisional — fixed with exact conditional `LICENSE` and `NOTICE` checks and
  a regression test.
- P1: extra or duplicate pre-body terms could evade the license gate — fixed by
  generating and comparing the complete permitted parameter block and hashing
  the canonical standard terms.
- P1: distribution dates were arbitrary unbound side files — fixed with a
  canonical per-version tracked ledger, future-date and overwrite rejection,
  source and artifact binding, and a checksummed candidate copy. A future
  protected publication transaction must commit and attest that record; the
  candidate-only workflow cannot create a date.
- P1: dogfood docs still claimed no license decision existed — corrected and
  covered by wording-drift tests.

## Open owner/legal items

Before public distribution, the owner still needs to confirm the exact legal
entity name, copyright ownership or licensing authority, and approve the final
populated license parameters. Qualified external counsel should review the
Additional Use Grant, identity and ownership chain, trademark wording, and
contribution/relicensing terms; that review is strongly recommended and is not
currently recorded. External contributions requiring commercial relicensing
must not be accepted until the inbound-rights approach is resolved. The
protected release gate intentionally remains closed until the licensor identity,
authority, and final owner approval are recorded.
