# Specra implementation roadmap

Each slice is a deployable or author-visible vertical increment. Its work item must retain the fields below; scope changes update this roadmap rather than reusing an identifier. Completion requires implementation, semantic tests, threat-model/ADR review, documentation, Principal Engineer self-review, independent named specialist review, no open P0, and no unresolved/undispositioned P1.

## SPEC-000 — Engineering foundation

- **Objective/scope:** establish product boundaries, architecture, threat model, draft canonical contracts, toolchain, repository, tests, CI, review protocol, and roadmap.
- **Non-goals:** product rendering, content compilation, search, snippets, request execution, and a public CLI.
- **Architecture impact:** creates the source → adapter → canonical model → reader dependency direction and trust boundaries.
- **Acceptance/tests:** all Phase 0 gates pass locally; a GitHub run must be green once a remote exists; fixture, malicious-input, architecture, accessibility, performance-smoke, build, license, audit, and frozen-install checks exist.
- **Security/docs/DoD:** threat model, ADRs, contributor docs, and review dispositions are versioned; P0 closed and P1 resolved or explicitly assigned to a blocking slice.
- **Dependencies/risks/reviewers:** no dependency; risk is false confidence from scaffolding; all specialist roles review.

## SPEC-001 — Canonical documentation model

- **Objective/scope:** finalize source-independent API/document semantics, diagnostics, identities, deterministic serialization, and model migrations.
- **Non-goals:** OpenAPI parsing, React rendering, CLI command UX, search implementation, or request execution.
- **Architecture impact:** freezes the dependency-free contract consumed by adapters, renderers, indexers, snippets, and quality rules.
- **Acceptance:** the [normalization contract](architecture/normalization-contract.md) is executable; keyword-only/mixed JSON Schema stance is decided; request/response/header/parameter/server/auth semantics are faithful; recursive, composed, boolean, tuple, const/enum, and unknown schemas round-trip deterministically; no parser types leak.
- **Tests/security:** golden canonical fixtures, type tests, property/reordered-source serialization tests, cycle/non-finite/limit tests, stable value-free diagnostics, and compatibility fixtures.
- **Docs/DoD:** model reference, invariants, migration policy, ADR update, and capability-diagnostic catalog are complete.
- **Dependencies/risks/reviewers:** SPEC-000; risk is lossy or OpenAPI-shaped abstraction; OpenAPI/JSON Schema, frontend, QA, security, search/snippet consumer reviewers.

## SPEC-002 — Thin CLI and build orchestrator

- **Objective/scope:** deliver the first author workflow: `specra validate`, programmatic build context, config loading/diagnostics, project-root confinement, and deterministic artifact directories. Reserve `dev`/`build` command surfaces for the next ingest-to-reader integration.
- **Non-goals:** documentation scoring, contract diffing, content rendering, or full OpenAPI normalization.
- **Architecture impact:** creates a thin orchestration package over stable ports; it coordinates packages but owns no parser/content/rendering semantics.
- **Acceptance:** a sample project loads trusted `specra.config.ts` in an isolated process, emits only validated serializable config, validates paths without symlink escape, supports human and JSON diagnostics, deterministic exit codes, cancellation, and `--help`.
- **Tests/security:** CLI subprocess/golden diagnostics, Windows/POSIX path cases, malicious config/path/symlink cases, environment-secret redaction, config-process timeout, and clean-room package test.
- **Docs/DoD:** command/config reference and troubleshooting are complete; executable config trust is explicit.
- **Dependencies/risks/reviewers:** SPEC-001; risks are build-code authority and CLI contract churn; Product/DX, security, QA, and architecture reviewers.

## SPEC-003 — OpenAPI ingestion

- **Objective/scope:** parse, resolve, validate, and normalize OpenAPI 3.0/3.1 into canonical artifacts; wire `specra validate`/`build` through that pipeline. `dev` stays reserved until SPEC-004 gives it a reader to serve.
- **Non-goals:** polished API routes, remote refs by default, AsyncAPI/GraphQL, or runtime conformance.
- **Architecture impact:** selects an adapter-private resolver/validator behind one mandatory acquisition policy; raw models end at the adapter.
- **Acceptance:** the [dialect map](architecture/openapi-dialects.md) and fixture matrix map correctly; local cycles terminate; invalid refs diagnose; remote retrieval stays off unless every hardened policy test passes; output bytes are deterministic; 10 MiB/10k-operation budgets are measured.
- **Tests/security:** 3.0/3.1 paired goldens, local/external/circular refs, root/symlink escape, alias/depth/node/string/example/ref budgets, DNS/redirect policy harness, malformed/malicious input, fresh-process RSS/time benchmarks.
- **Docs/DoD:** dependency evaluation, supported/downgraded constructs, diagnostics, limits, and author setup are published.
- **Dependencies/risks/reviewers:** SPEC-001 and SPEC-002; risks are dialect errors, SSRF/path escape, and memory exhaustion; OpenAPI/JSON Schema, security, QA, performance.

## SPEC-004 — Minimal API reference

- **Objective/scope:** render discoverable service, tag, and operation routes from canonical artifacts with metadata and responsive navigation.
- **Non-goals:** deep schema trees, authored MDX, search, snippets, playground, versions, or product-specific logic.
- **Architecture impact:** introduces route-specific rendering projections and owned server-first UI primitives; client islands require explicit review.
- **Acceptance:** a production-realistic fixture builds to indexable routes; method/path, parameters, bodies, responses, auth, deep links, canonical metadata, sitemap, keyboard flow, 320 px/400% reflow, light/dark, and mobile reading work within HTML/JS budgets.
- **Tests/security:** server rendering, browser E2E, axe, response headers/CSP, XSS strings, SEO, bundle budgets, visual baselines, keyboard/focus/manual AT matrix.
- **Docs/DoD:** reader IA, component contracts, static-host header guidance, browser/viewport baseline workflow, and accessibility evidence are complete.
- **Dependencies/risks/reviewers:** SPEC-003; risks are hydration/payload growth, mobile IA, CSP, and XSS; Product/DX, frontend, accessibility, security, performance, QA.

## SPEC-005 — Schema Renderer

- **Objective/scope:** explain complex JSON Schema projections with bounded, accessible expansion, references, variants, and read/write contexts.
- **Non-goals:** validation-engine equivalence, schema editing, or code generation.
- **Architecture impact:** derives a schema view model from canonical nodes; cycles remain ID links and DOM expansion is budgeted.
- **Acceptance:** recursive, deeply composed, tuple, dictionary, boolean, type-less, discriminator, constraint, and large schemas remain understandable with no recursion overflow and sub-100 ms bounded interactions.
- **Tests/security:** semantic assertions, expansion fuzz/cycles, keyboard/screen-reader states, axe/manual AT, malicious labels, DOM/memory/performance, light/dark/mobile visuals.
- **Docs/DoD:** supported semantics, projection limitations, interaction/a11y guide, and performance evidence are complete.
- **Dependencies/risks/reviewers:** SPEC-004; risks are semantic loss and inaccessible/huge trees; OpenAPI, frontend, accessibility, performance, security, QA.

## SPEC-006 — Authored content and navigation

- **Objective/scope:** compile controlled Markdown/MDX and combine configured navigation, branding, and generated API routes.
- **Non-goals:** arbitrary React imports/expressions/CSS, WYSIWYG editing, or remote asset execution.
- **Architecture impact:** adds a restricted content compiler and navigation model independent of filesystem layout.
- **Acceptance:** callouts, tabs, steps, cards, code groups, diagrams, breadcrumbs, previous/next, assets, and version-ready navigation work; raw HTML/imports/expressions/path escapes fail closed.
- **Tests/security:** AST capability tests, XSS/sanitizer tests, include cycles/limits, SVG/asset policy, contrast/focus/component browser tests, navigation determinism and visuals.
- **Docs/DoD:** authoring/component/navigation/branding references and trust model are complete.
- **Dependencies/risks/reviewers:** SPEC-004; risks are build execution, XSS, asset tracking, and confusing authorship; security, Product/DX, frontend, accessibility, QA.

## SPEC-007 — Build-time search

- **Objective/scope:** provide fast keyboard-accessible self-hosted discovery across pages, headings, operations, paths, tags, schemas, SDK docs, and changelog-ready records.
- **Non-goals:** paid SaaS, semantic/AI search, analytics, or cross-project private indexing.
- **Architecture impact:** implements the version-scoped `SearchDocument`/query port with a compressed lazy worker index.
- **Acceptance:** deterministic relevance goldens find expected entities; index ≤5 MiB gzip for 10k records; first query <100 ms after worker load; reader works when the chunk is unavailable.
- **Tests/security:** ranking/tokenization, index determinism/size, secret/hidden-field exclusion, keyboard/dialog/focus/AT, worker failure and performance.
- **Docs/DoD:** index contract, replacement adapter, author troubleshooting, privacy, and measurements are complete.
- **Dependencies/risks/reviewers:** SPEC-005 and SPEC-006; risks are relevance, index growth, focus, and leakage; Product/DX, accessibility, performance, security, QA.

## SPEC-008 — Code samples and SDK mappings

- **Objective/scope:** generate cURL/HTTP/JavaScript/TypeScript/Java/Python protocol examples and render explicitly authored SDK mappings.
- **Non-goals:** inferring high-level SDK methods or executing requests.
- **Architecture impact:** adds a pure snippet projection/generator port and config-backed SDK example mapping.
- **Acceptance:** methods, parameter serialization, media bodies, auth placeholders, escaping, environment selection, tabs, copy, and missing-mapping diagnostics are correct; SDK APIs are never invented.
- **Tests/security:** language goldens, shell/string injection, secret-placeholder redaction, fixtures across serialization/media/auth, copy/tab accessibility and visuals.
- **Docs/DoD:** generator guarantees, SDK mapping reference, extension boundary, and diagnostics are complete.
- **Dependencies/risks/reviewers:** SPEC-003 and SPEC-004; risks are executable injection and misleading requests; OpenAPI, security, Product/DX, QA, SDK owners.

## SPEC-009 — Browser-direct playground

- **Objective/scope:** execute requests against configured approved environments with environment/auth/parameter/body forms, preview, cancellation, and bounded response presentation.
- **Non-goals:** server proxy, arbitrary destination, credential persistence, automatic mutation retry, or OAuth provider-specific portals.
- **Architecture impact:** introduces a client island and request policy fed only by validated environment + canonical operation data; CSP `connect-src` is generated from exact origins.
- **Acceptance:** arbitrary destinations are impossible; credentials remain memory-only and redacted; CORS failures are actionable; status/headers/body/latency and sample synchronization work; no proxy endpoint exists.
- **Tests/security:** destination composition, redirects, credentials/log/URL canaries, timeout/cancel/body limits, malicious responses, browser CORS, forms/keyboard/screen readers, CSP and visuals.
- **Docs/DoD:** credential/CORS/browser support, environment policy, privacy, and manual security evidence are complete.
- **Dependencies/risks/reviewers:** SPEC-008; risks are credential leakage, unsafe navigation, and complex forms; security, accessibility, frontend, QA, Product/DX.

## SPEC-010 — Versioning, redirects, and changelog

- **Objective/scope:** retain immutable documentation releases and author reviewed changelogs from structured contract-diff candidates.
- **Non-goals:** coupling to deployment versions or auto-publishing generated prose.
- **Architecture impact:** adds version manifests, the selected alias policy, scoped search/navigation, redirect validation, and structured diff records.
- **Acceptance:** `/docs/{version}` is immutable and self-canonical; `/docs` redirects non-permanently to current and is absent from sitemaps; retained routes/artifacts are link-correct; redirects, deprecation UI, search scope, diff candidates, and author review work.
- **Tests/security:** historical build reproducibility, cross-version links, redirect/open-redirect cases, sitemap/canonical SEO, diff semantics, unpublished-candidate isolation.
- **Docs/DoD:** release/retention/migration/changelog workflow and operational guidance for the selected canonical-URL policy are complete.
- **Dependencies/risks/reviewers:** SPEC-006 through SPEC-009; risks are duplicate indexing, stale links, and misleading diffs; Product/DX, SEO/frontend, OpenAPI, QA, security.
- **Outcome:** implemented ([ADR-016](adr/016-immutable-documentation-releases.md), [versioning reference](versioning.md)): `specra release`/`current`/`deprecate`, an immutable release store with manifests and an explicit catalog, versioned self-canonical routes with 307 aliases and frozen 308 redirects, release-scoped reader loading, structured diff candidates under `.specra/candidates`, and the human-reviewed changelog; the structural diff port is what SPEC-011 consumes.

## SPEC-011 — Documentation quality gates and diff CLI

- **Objective/scope:** add `specra check`, configurable rules/severities/thresholds, deterministic reporting, and reviewed `specra diff` support.
- **Non-goals:** runtime API conformance or an arbitrary rule-plugin marketplace.
- **Architecture impact:** quality rules consume canonical artifacts and authored metadata through stable ports; CLI remains an orchestrator.
- **Acceptance:** operation/schema/example/auth/SDK rules have defined weights or no percentage; any score formula is deterministic and documented; warning/failure modes and exit codes work in CI; machine output is stable.
- **Tests/security:** rule unit/goldens, threshold math, config compatibility, huge diagnostic sets, terminal-control/secret redaction, CLI subprocess and example-project CI.
- **Docs/DoD:** rule catalog, scoring formula if used, CI recipes, suppression governance, and migration policy are complete.
- **Dependencies/risks/reviewers:** SPEC-003, SPEC-006, SPEC-008, SPEC-010; risks are vanity metrics and noisy gates; Product/DX, QA, OpenAPI, security.
- **Outcome:** implemented ([ADR-017](adr/017-documentation-quality-facts-rules-policy.md), [quality reference](quality.md)): the pure `@specra/quality` engine with a static 25-rule registry across operations, schemas, examples, authentication, SDK mappings, authored content, compatibility, and suppression governance; `specra check` (exit 3 on a failed gate, 2 on a policy error) and public `specra diff` over the SPEC-010 port; severity overrides, `failOn`, `maxWarnings`, and governed suppressions with expiry and stale detection. **No percentage score**, by decision. The public commands are dogfooded in CI with self-tests that prove the gate can fail.

## SPEC-012 — Odexa dogfooding and release readiness

- **Objective/scope:** build Odexa and Specra's own docs using only the packed public CLI, public config, contracts, authored content, and branding; close production-readiness gaps.
- **Non-goals:** Odexa branches in core, AsyncAPI ingestion, invented SDK mappings, unrelated API conformance, SaaS hosting, or a plugin marketplace.
- **Architecture impact:** validates public boundaries and deployment artifacts; product-specific behavior stays in the consumer project.
- **Acceptance:** both portals build without private hooks; no `if (project === "testinbox")`; real-scale budgets, broken-link/accessibility/visual/E2E/quality gates, rollback, provenance, and deployment runbooks pass.
- **Tests/security:** full example builds, contract/content drift integration, cross-browser/manual AT, load/bundle/build benchmarks, supply-chain/release audit, disaster/rollback exercise.
- **Docs/DoD:** operator/release/support policy, public compatibility and license decisions, dogfood findings, and residual-risk acceptance are complete.
- **Dependencies/risks/reviewers:** SPEC-011; risks are hidden coupling, real-spec scale, and release operations; all specialists and Odexa owners.
- **Outcome:** technically ready with release gates. Odexa's six real OpenAPI 3.1 services and fourteen authored pages, plus Specra's authored-content-only self-documentation, build through the packed `0.1.0-rc.2` public CLI. Production Node/container deployment, liveness/readiness, rollback/restore, cross-browser critical flows, package audit, CycloneDX SBOM, checksums, and the public-boundary gate are implemented. The BSL 1.1 policy, Licensor identity, ownership, licensing authority, and final parameters are owner-confirmed. The owner accepts manual AT qualification as P2 A11Y-R01 for pre-1.0 RCs; it remains required before stable `1.0.0` and comprehensive accessibility claims. Public RC release requires verified protected provenance and a committed public-distribution ledger. AsyncAPI ingestion remains a future capability and Odexa documents its events from the authoritative source without pretending Specra ingests it.

## Deferred dedicated proxy

A dedicated playground proxy receives a new identifier only after browser-direct evidence proves demand. It requires its own threat model, deployment/operations owner, exact egress and credential controls, abuse tests, and accepted ADR; it is never an implicit part of SPEC-009.
