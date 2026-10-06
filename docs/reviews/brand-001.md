# BRAND-001 — migration qualification

Scope: active product identity changes beginning with Specistry 0.1.0-rc.3.
Historical ADRs, completed reviews and Specra RC2 distribution evidence are not
rewritten. No application feature, architecture boundary or licensing business
term is changed.

## Specialist findings

Product/DX, Release/Supply Chain, Security, npm packaging, Architecture and QA
reviews found no outstanding P0/P1 findings after correction:

| Finding                                                          | Resolution                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| P1: pnpm exposes a shell executable shim, not a JavaScript entry | Qualification executes the public bin directly for both package managers. |
| P2: historical local Odexa output could become unignored         | Both current and historical generated-output paths stay ignored.          |
| P2: CLI reference described only two commands                    | Introduction now matches the seven executable commands.                   |
| P2: ledger README incorrectly denied an existing public release  | Current explanatory text distinguishes immutable RC2 from pending RC3.    |

## Qualification evidence

- Source CLI and internal workspace packages remain private; only the staged
  CLI has explicit public npm publication configuration.
- Active-brand and public-consumer boundary checks pass; obsolete active names
  fail, with explicit historical allowances.
- The initial full local unit/security/rendering suite passed 1,190 tests.
  New targeted brand/release-binding regressions passed 12 tests.
- Format, lint, typecheck, architecture, dependency, license and working-tree
  secret-pattern gates passed. The high-severity dependency audit passed under
  the existing accepted advisory policy; its review deadline is unchanged.
- A single local candidate tarball installed and executed with npm and pnpm,
  built/checks the 15-page self-documentation site with no quality findings, and
  built/checks Odexa's 14 pages and 53 operations through the public package.
  Odexa's pre-existing 57 quality warnings remain within its unchanged policy.
- The RC2 ledger SHA-256 remains
  `76928299b2f83e5f9698b0a8cfb55753ee9e37ad913889b50d0bc97743c5058f`.
- The fetched public-history scan found no private paths or credential patterns
  across 1,941 blobs and 879 historical paths, with no oversized unscanned blobs.

Local qualification is not production release provenance. Exact-head CI,
post-merge integration/production CI, frozen protected preparation, signed
subject verification, GitHub publication and npm/GitHub byte equality remain
separate release gates. npm scope ownership is owner-confirmed; registry
publication is pending. Manual VoiceOver/NVDA remains **DEFERRED TO 1.0.0**,
without a comprehensive screen-reader or WCAG-conformance claim.

## Protected preparation preflight

The first protected preparation run, `37471834797`, at production source
`16f56994f00babe437719cfa2b3bcb35cb2e19ca` failed before packing or uploading
any artifact. Repository-wide Markdown lint included the external Odexa checkout
and reported formatting in its existing documents. The release workflow now
checks out that pinned consumer only after Specistry's quality gates and packing,
immediately before public-boundary consumer qualification. No gate is removed,
no Odexa document is rewritten, and no lint waiver is introduced.

The initial RC3 annotated tag object was
`3590e698dca63bc934f55ba2f91fc5bf83905d22`. Moving this not-yet-released tag
was explicitly authorized by the owner on 2026-10-06, conditional on corrected
source review and green production CI. Historical RC2 remains immutable.
