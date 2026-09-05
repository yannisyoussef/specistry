# Dependency and supply-chain policy

Prefer native platform capability, then a focused established dependency, then custom code. Specra does not wrap a complete documentation renderer.

## Admission review

Every production dependency requires a pull-request note covering purpose, why native code is insufficient, license, maintainership and recent releases, security history, transitive graph, install scripts, runtime/bundle cost, ESM and TypeScript quality, supported Node versions, lock-in, and replacement boundary. Risky packages receive a short proof or are rejected.

Dependencies and the package manager are exact-pinned in manifests and lockfile. CI uses frozen installs. Renovate or Dependabot proposes reviewed updates; no automatic production merge. Security patches may use an expedited review but still run full gates.

Pnpm may record exact, reviewable `minimumReleaseAgeExclude` entries when a newly selected version has not yet aged through its supply-chain policy. These are dependency-specific exceptions, not wildcards; the dependency review, lockfile, audit, and full gates still apply. Remove an exception after the release ages out during a routine update.

## Current significant dependencies

| Dependency              | Role and decision                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Next.js + React         | Server-first routing/rendering baseline with static and Node deployment paths; selected in ADR-006                    |
| `yaml`                  | Focused YAML 1.2 parser with alias controls; JSON remains accepted as YAML-compatible input; not a validator/resolver |
| Zod                     | Strict runtime validation and useful path-aware errors for the public config boundary                                 |
| Vitest                  | ESM/TypeScript-aligned semantic tests and V8 coverage                                                                 |
| ESLint + Next config    | TypeScript/React correctness and framework rules                                                                      |
| Prettier + markdownlint | Deterministic source and documentation formatting                                                                     |
| Testing Library + axe   | User-oriented component queries and automated accessibility checks                                                    |
| Playwright              | Chromium HTTP-header, keyboard, reflow, metadata, and axe browser smoke coverage                                      |

No OpenAPI resolver/validator is selected until SPEC-003 evaluates current candidates against the corpus, OpenAPI 3.1 semantics, remote-reference controls, maintenance, license, and parser-model leakage.

## Enforcement and response

`pnpm audit --audit-level high` blocks CI for high/critical advisories. The production license script denies AGPL and GPL-family licenses by default; exceptions require legal review, an ADR, scope, owner, and review date. Pull requests receive dependency review. Secrets scanning is redacted.

Advisories are triaged by reachability, runtime/dev scope, exploitability, and fixes. High/critical reachable production findings block release. Document any deferral with owner and review date. Never suppress install scripts or verification merely to make the pipeline green; use pnpm's dependency build allowlist deliberately when a package requires scripts.
