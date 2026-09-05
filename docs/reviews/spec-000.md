# SPEC-000 review record

Date: 2026-09-05

The Principal Engineer completed a cross-cutting review before independent review. Independent review then covered Product/DX, frontend architecture, QA, accessibility and performance as one reader-facing review; OpenAPI/JSON Schema correctness; and security. The Principal Engineer validated and integrated findings below.

## Severity summary

- **P0:** 0 open; 1 resolved.
- **P1:** 0 undispositioned; 9 resolved and 2 assigned as blocking acceptance work in the owning slice.
- **P2:** 6 tracked; 7 resolved during SPEC-000.
- **P3:** 0 open; 3 resolved.

## P0

| Finding                                                                                                | Disposition                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The production-license gate classified private workspace packages as unknown and failed a clean check. | Resolved: all private packages explicitly use `UNLICENSED`; the gate now evaluates the actual production closure, rejects unknown licenses, and passes on 24 inspected packages. |

## P1

| Finding                                                                                                                                       | Disposition                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The schema draft could silently narrow JSON Schema keyword-without-type and mixed-vocabulary behavior.                                        | Explicit blocking disposition to SPEC-001: the model is documented as a documentation projection, `const`/`enum` accept JSON values, unsupported semantics require capability diagnostics, and model v1 cannot freeze until the stance is tested. |
| Request/response, parameter serialization/content, response headers, server variables, and OAuth flows were too lossy.                        | Resolved in the draft types and semantic traversal; SPEC-001 must prove the contracts with compatibility fixtures before freezing them.                                                                                                           |
| JSON serialization was only a TypeScript claim; cycles, non-finite numbers, negative zero, exotic objects, and oversized graphs could escape. | Resolved with iterative serializability validation, bounded strings/nodes, cycle detection, generic value-free diagnostics, and tests.                                                                                                            |
| A boolean remote-reference switch was too permissive.                                                                                         | Resolved: references are inert at parse time, remote use requires a structured exact-HTTPS-origin policy, and unsupported schemes/userinfo are rejected. Network retrieval remains disabled.                                                      |
| Normalization identity, ordering, diagnostics, and byte determinism were underspecified.                                                      | Resolved with the normalization contract and OpenAPI dialect map; executable conformance remains SPEC-001/SPEC-003 acceptance work.                                                                                                               |
| CI actions relied on obsolete runtimes or movable tags.                                                                                       | Resolved: Node 24-compatible actions are pinned to reviewed full commit SHAs, credentials are not persisted, permissions are minimal, and jobs have timeouts.                                                                                     |
| Diagnostics could reflect attacker-controlled keys or secret values.                                                                          | Resolved: current diagnostics use stable generic messages and index-based paths; redaction canary coverage was added.                                                                                                                             |
| The architecture checker could miss relative imports that resolve across a package boundary.                                                  | Resolved with component-aware relative/bare import resolution and an explicit checker self-test.                                                                                                                                                  |
| Delaying the CLI until the end made the author/build contract unstable.                                                                       | Resolved in sequencing: SPEC-002 now creates the thin CLI/config/build orchestration surface before OpenAPI integration.                                                                                                                          |
| Phase 0 lacked a real browser test for delivered headers, focus, reflow, metadata, and accessibility.                                         | Resolved with pinned Playwright/axe coverage on desktop and mobile Chromium projects and a separate CI job.                                                                                                                                       |
| The baseline CSP still allows inline script/style required by the current Next shell.                                                         | Explicit blocking disposition to SPEC-004: the production shell has no untrusted HTML, `unsafe-eval` is development-only, and nonce/hash evaluation is required before the interactive reader is production-ready.                                |

## Tracked P2

| Finding                                                                                        | Owner / exit condition                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Post-parse structural limits do not prevent all parser allocation before traversal.            | SPEC-003 selects and wraps the production parser/resolver with acquisition, worker time/memory, and aggregate reference/example limits.               |
| Local-reference root and symlink confinement and remote DNS/redirect defenses are design-only. | SPEC-002 proves project-root confinement; SPEC-003 must pass resolver network/root tests before remote retrieval can be enabled.                      |
| The paired 3.0/3.1 and pathological fixture corpus is only a sentinel set.                     | SPEC-001/SPEC-003 expand every row in the dialect matrix into semantic fixtures and goldens.                                                          |
| Branding/SVG/font sanitation is not executable because asset ingestion does not exist.         | SPEC-006 must validate, sanitize/rasterize, size-limit, and origin-control assets before accepting them.                                              |
| CSP `connect-src` generation and nonce/hash behavior are not implemented.                      | SPEC-004 owns script/style tightening; SPEC-009 generates exact origins for browser-direct requests.                                                  |
| Private vulnerability reporting depends on a repository setting outside this local workspace.  | Repository owner enables GitHub private vulnerability reporting before external release; `SECURITY.md` defines the private route and response target. |

## Resolved P2/P3 highlights

- Added strict project-relative config paths and HTTPS/loopback environment URL rules, including credential/query/fragment rejection.
- Added deployment header-equivalence guidance, a single canonical URL policy, a manual accessibility matrix, a 320 px layout correction, and focused skip-link behavior.
- Added OpenAPI 3.0 and 3.1 sentinels, limit-boundary tests, production dependency/license auditing, secret scanning, and dependency-update automation.
- Removed an unused OpenAPI-to-model package dependency and clean package build output before compilation so test artifacts cannot leak into `dist`.
- Corrected toolchain documentation to match the deliberately compatible ESLint 9/Next 16 stack.

## Principal Engineer decision

The two remaining P1 dispositions do not authorize shipping unsupported behavior. They are explicit gates on model freezing in SPEC-001 and production reader readiness in SPEC-004. They are not open Phase 0 design ambiguity: ownership, safeguards, and exit criteria are documented and testable.
