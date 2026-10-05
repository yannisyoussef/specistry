# SPEC-012 principal and specialist review

## Scope

Reviewed the Odexa and Specra dogfood portals, public consumer boundary,
content-only model, shared-source ingestion, production reader/container,
release-candidate package, supply-chain evidence, accessibility plan, and
operator documentation. The approved architecture is recorded in ADR-018;
the detailed finding dispositions are in the dogfood ledger.

## Review results

- **Architecture:** PASS. Both consumers use one canonical artifact and one
  packed CLI boundary. Product-specific facts stay in Odexa. AsyncAPI and SDK
  capabilities are not fabricated.
- **OpenAPI/model:** PASS. All six Odexa OpenAPI 3.1 roots ingest; shared
  project sources are unique by id and digest; 53 operations and 46 schemas
  are preserved. Eight relative-server snippet warnings and content-quality
  findings remain visible consumer evidence, not suppressed core exceptions.
- **Security/privacy:** PASS WITH RELEASE GATES. Authored content remains inert,
  the local playground is the only approved browser destination, readiness is
  value-free, the runtime is non-root, and generated evidence contains no
  credential values. The licensor identity and authority are owner-confirmed;
  protected provenance remains required for public release.
- **Frontend/accessibility:** AUTOMATED PASS; MANUAL ACCEPTED / DEFERRED. The critical
  guide/search/API/code/playground flows have focused Chromium, Firefox, and
  WebKit coverage with axe. The separate manual AT matrix must be completed by
  a human before stable `1.0.0`. The owner accepts qualification residual
  A11Y-R01 for pre-1.0 RCs; no known defect is established by this gap and no
  comprehensive screen-reader or formal WCAG conformance claim is made.
- **DX/release:** PASS WITH RELEASE GATES. npm and pnpm install the tarball in
  clean rooms, the package audit rejects private material, and the candidate
  includes a validated SBOM and checksums. The approved BSL 1.1 terms are
  consistent across release surfaces, and the confirmed identity and authority
  pass the release-license gate. Public publish remains disabled pending the
  protected provenance and the committed public-distribution ledger. Local work does not claim signed
  provenance.
- **Operations:** PASS. Standalone Node output, liveness/readiness, immutable
  external artifacts, proxy/TLS/CSP guidance, multi-instance coherence,
  backup/restore, corruption handling, and rollback are documented.

## Decision

`TECHNICALLY_READY_WITH_RELEASE_GATES`

The implementation may merge to `develop`. The owner has confirmed the
licensor's exact legal identity and authority. It may not be promoted to the
production branch until required CI passes, or published until protected CI
emits verified attestations for the reviewed artifacts and the public-distribution
ledger is committed. The owner explicitly accepts A11Y-R01 for pre-1.0 RCs;
the manual matrix remains required before stable `1.0.0` and comprehensive
accessibility claims.
