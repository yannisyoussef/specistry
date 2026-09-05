# ADR-007: Testing, CI, and supply-chain foundations

## Status

ACCEPTED — 2026-09-05

## Context

Specra processes adversarial structured input and will present security-sensitive interactive UI. A green build alone does not establish semantic correctness, accessibility, dependency direction, or supply-chain safety. CI must give fast feedback without becoming one monolithic slow job.

## Problem

What test and CI foundation provides credible gates from Phase 0 and scales with vertical slices?

## Constraints

- Semantic assertions are primary; visual snapshots are complementary.
- P0/P1 findings block slice completion unless P1 is explicitly dispositioned.
- Fast deterministic failures should precede builds and browsers.
- Dependencies, actions, licenses, and secrets require review.

## Considered options

1. **Build plus unit tests:** fast but blind to architecture, docs, security, accessibility, and supply chain.
2. **One full serial pipeline:** simple but slow feedback and poor failure isolation.
3. **Layered fast/build/security/dependency jobs:** more configuration, but clear and scalable.
4. **External hosted testing services:** useful later for browsers/visuals, but unnecessary Phase 0 dependency.

## Decision

Use Vitest for unit/cross-package/security/performance tests, Testing Library and axe for component accessibility, Playwright plus axe for browser-level behavior, ESLint/markdownlint/Prettier for source quality, TypeScript strict mode, an architecture boundary script, V8 coverage reporting, Next production build, high/critical pnpm audit, a denied-license gate, dependency review, and redacted secret scanning. Split fast validation from build/coverage/audit/browser jobs. Add deterministic visual baselines with the first interactive reader slice.

Use a difficult fixture corpus and generated scale cases. Record manual accessibility, OpenAPI semantics, and security checks that automation cannot prove.

## Rationale

This makes Phase 0 contracts and delivered HTTP headers executable. Independent jobs keep browser weight out of the fast feedback path while retaining meaningful validation.

## Consequences

- Positive: failures are actionable, architecture/security regressions are visible, and test categories grow with features.
- Negative: custom scripts need maintenance; axe and coverage can create false confidence if mistaken for complete review.
- Neutral: coverage is reported initially; per-package thresholds are set when executable behavior expands in SPEC-001/002.

## Risks

Pinned CI action commits still require deliberate update review, and performance timing can be noisy. Automate update proposals without automatic merge; keep smoke budgets generous and add dedicated benchmark baselines before tightening.

## Security implications

Jobs use least permissions, frozen installs, no production secrets, audit and dependency review. Secret scans redact output. Untrusted pull-request code must not receive privileged tokens or deployment credentials.
