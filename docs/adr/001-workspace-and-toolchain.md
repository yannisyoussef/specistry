# ADR-001: Workspace, toolchain, and package boundaries

## Status

ACCEPTED — 2026-09-05

## Context

Specra needs independently testable framework-neutral contracts, an OpenAPI adapter, validated consumer configuration, and a Next.js reader. Phase 0 must avoid speculative package fragmentation while preserving dependency direction. Reproducible local and CI builds need a pinned supported runtime and package manager.

## Problem

How should one repository organize the first concrete responsibilities and orchestrate a TypeScript toolchain without prematurely adding release or build-system complexity?

## Constraints

- Node must be an actively supported LTS line.
- Install and builds must be deterministic across local and CI environments.
- Canonical contracts cannot depend on rendering or parser libraries.
- Packages are private until independent publication has real consumers.
- The repository is too small to justify distributed services or a remote build cache.

## Considered options

1. **Single Next.js package:** simplest start, but makes source/parser/UI coupling likely and future CLI reuse difficult.
2. **Many packages from the product vision:** clean-looking graph, but empty boundaries create ceremony and circular ownership.
3. **Small pnpm monorepo:** create only web, model, OpenAPI, and config boundaries; add packages with slices.
4. **Nx/Turborepo workspace:** useful caching and graph tooling, but redundant for four packages and adds dependency/operational surface.

## Decision

Use a pnpm workspace with `apps/web`, `packages/model`, `packages/openapi`, and `packages/config`. Use Node.js 24.20.0, pnpm 11.19.0, TypeScript 6.0.3, ESLint 9.39.5 (the newest line currently accepted by Next's plugin peers), Prettier 3.9.6, Vitest 5.0.0, Next.js 16.3.4, and React 19.2.8, exact-pinned. Pnpm recursive scripts provide topological builds. Packages remain private at version `0.0.0`.

## Rationale

The four boundaries already own near-term contracts and can be tested without inventing a generic `core`. Pnpm provides workspaces and deterministic locks with low machinery. Node 24 is an active LTS line; Next 16 supports its runtime. Central exact versions reduce drift while the public API is unstable.

## Consequences

- Positive: clear dependency direction, small install graph, one lockfile, reproducible CI, and room to extract content/search/snippets/CLI only when implemented.
- Negative: no remote caching and some versions repeat in app manifests; workspace scripts will become insufficient if build graph complexity grows.
- Neutral: publication layout and semantic versioning remain undecided.

## Risks

Custom architecture checks may miss exotic dynamic imports. Reevaluate a graph tool when package count or build cost makes its value measurable. Node's exact patch pin requires planned security updates.

## Security implications

Exact manifests, a frozen lockfile, engine enforcement, minimal packages, audit, license checks, and dependency review reduce supply-chain exposure. Pinned versions do not eliminate compromised dependencies; updates remain reviewed.

## References

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [Next.js 16 upgrade and runtime requirements](https://nextjs.org/docs/app/guides/upgrading/version-16)
- [pnpm installation and Corepack guidance](https://pnpm.io/installation)
