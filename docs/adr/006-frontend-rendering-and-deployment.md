# ADR-006: Frontend rendering and deployment

## Status

ACCEPTED — 2026-09-05

## Context

Specra needs indexable, accessible reference and guide routes plus selective interaction for search, schema trees, code tabs, and requests. Large specifications make a fully client-rendered SPA unsuitable. Consumers need self-hosted Node and static-compatible deployment paths.

## Problem

Which frontend boundary balances SEO, performance, interaction, responsive information architecture, and deployment portability?

## Constraints

- Next.js/React is the preferred baseline.
- Minimize hydration and source payloads in the browser.
- WCAG 2.2 AA, mobile-specific flows, deep links, and meaningful metadata are mandatory.
- Specra owns primitives and theme quality; a heavy component framework is not desired.

## Considered options

1. **Client SPA:** simple state but poor initial payload, SEO, and large-spec behavior.
2. **Static-only generator:** excellent hosting, but constrains future authenticated/private and controlled runtime features.
3. **Next.js App Router with server-first routes:** static generation and Node rendering with explicit client islands.
4. **Adopt a full docs theme/renderer:** fast initial polish but undermines Specra's architectural and UX ownership.

## Decision

Use Next.js App Router and React Server Components by default. Pre-render public content where possible; load route-scoped canonical projections. Client components are leaf islands for interaction and must declare accessibility/state behavior. Use owned CSS/design tokens and selective accessible primitives only after dependency review. Support Node deployment and static output for compatible feature sets.

Desktop uses navigational, reading, and optional tools regions when space permits. Mobile prioritizes one reading task, with modal/drawer navigation and deliberate transitions rather than stacking desktop columns. Routes, headings, operations, and versions remain deep-linkable.

## Rationale

Server-first composition makes HTML and metadata primary, while the same framework supports static and controlled dynamic deployments. Small client boundaries constrain hydration and credential-bearing state.

## Consequences

- Positive: indexable pages, route-level code splitting, low default JS, flexible deployment, and explicit interaction boundaries.
- Negative: server/client boundary discipline and Next upgrades require care; static mode cannot support every future runtime feature.
- Neutral: Tailwind may be evaluated when component volume proves it useful; Phase 0 uses owned CSS.

## Risks

Large serialized props and accidental client imports can erase benefits. Bundle, HTML, hydration, and model-payload budgets become CI gates with API reference implementation.

## Security implications

Baseline headers deny framing/objects and restrict origins. React escaping remains mandatory. The initial CSP permits framework-required inline scripts/styles; nonce/hash hardening is dispositioned to SPEC-004 before production-ready interactive rendering.
