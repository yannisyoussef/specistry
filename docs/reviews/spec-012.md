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
  human AT and protected provenance remain open.
- **Frontend/accessibility:** AUTOMATED PASS; MANUAL BLOCKED. The critical
  guide/search/API/code/playground flows have focused Chromium, Firefox, and
  WebKit coverage with axe. The separate manual AT matrix must be completed by
  a human before public release.
- **DX/release:** PASS WITH RELEASE GATES. npm and pnpm install the tarball in
  clean rooms, the package audit rejects private material, and the candidate
  includes a validated SBOM and checksums. The approved BSL 1.1 terms are
  consistent across release surfaces, and the confirmed identity and authority
  pass the release-license gate. Public publish remains disabled pending the
  human AT matrix and protected provenance. Local work does not claim signed
  provenance.
- **Operations:** PASS. Standalone Node output, liveness/readiness, immutable
  external artifacts, proxy/TLS/CSP guidance, multi-instance coherence,
  backup/restore, corruption handling, and rollback are documented.

## Decision

`TECHNICALLY_READY_WITH_RELEASE_GATES`

The implementation may merge to `develop`. The owner has confirmed the
licensor's exact legal identity and authority. It may not be promoted to the
production branch or published until the manual assistive-technology matrix
passes and protected CI emits the release attestation for the reviewed commit.
No reviewer is authorized to silently convert those gates into
documentation-only follow-ups.
