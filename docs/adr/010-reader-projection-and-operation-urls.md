# ADR-010: Reader projection boundary and operation URL policy

## Status

ACCEPTED — 2026-09-05

## Context

SPEC-004 turns canonical artifacts into the first developer-facing reader. Two durable decisions were needed that no earlier ADR covers: how the reader consumes and reshapes the frozen canonical model without growing a second domain model, and how public documentation URLs are derived so that they stay stable and readable as contracts and slices evolve. A third operational decision, how the reader is rendered under a strict Content Security Policy, follows from ADR-006's deferral of nonce hardening to this slice.

## Problem

Where does presentation-specific preparation live, what shape do API reference URLs take, and how are pages rendered so that the CSP needs neither `'unsafe-inline'` nor `'unsafe-eval'`?

## Constraints

- The reader may depend on `@specra/model` and `@specra/config` only; parser, resolver, and YAML vocabulary never reach `apps/web` (architecture gate).
- Canonical semantics stay in the model; the reader must not re-derive or contradict them.
- URLs are a public developer-experience contract: deterministic, readable, free of registry hashes, and independent of encounter order in the source document.
- Server-first rendering (ADR-006); client islands only for genuine interaction.
- Artifacts are trusted only after model validation (ADR-003).

## Considered options

1. **Components read the model directly.** No extra layer, but every component repeats grouping, ordering, slug, and anchor logic and the URL contract is implicit.
2. **A reader package (`@specra/reader`) with its own model.** Clean boundary but a second domain model to keep in sync with the frozen canonical model, and a new package for one consumer.
3. **A thin projection module inside `apps/web`.** Pure functions from `DocumentationArtifact` to route identity, navigation grouping, and display-ready operation views; canonical types pass through untouched. One consumer, unit-testable without a browser.

URL shapes considered: registry ids (`/api/op_9f3a…`), method-and-path everywhere (`/api/post-inboxes`), operationId-only (`/api/create-inbox`), and grouped operationId with a method-and-path fallback (`/api/inboxes/create-inbox`).

Rendering considered: static export with a hash-based CSP (impossible: Next's per-page inline bootstrap varies), dynamic rendering with a per-request nonce, and keeping `'unsafe-inline'`.

## Decision

**Projection.** `apps/web/lib/reader` is the only place that shapes canonical data for presentation. `createReaderIndex` derives services, groups, ordered operation summaries, slugs, and hrefs once per artifact; `createOperationView` derives grouped parameters, media-type blocks, deterministically ordered responses, OR-of-AND security views, and deep-link anchors; `summarizeSchema` produces the restrained type phrase, constraints line, and one level of properties that SPEC-005 will replace. Components receive these views and render them; they never receive parser objects and never re-sort or re-group. The artifact is loaded once per process through `loadReaderArtifact`, which validates both files through the model's contracts and cross-checks the manifest; a missing or invalid artifact fails the build or start with an actionable error.

**URLs.** The reference lives under `/api`. Groups are tags; the group slug is the slugified tag name. Operation slugs come from the contract `operationId` in kebab case, and from `<method>-<path>` when no identifier exists. Collisions within a namespace are resolved by canonical order with numeric suffixes, never by source order. An operation with several tags has one canonical URL under its first canonical tag and is listed under the others. Single-service projects use `/api/<group>/<operation>`; multi-service projects insert the service slug (`/api/<service>/<group>/<operation>`). Adding a second service to a single-service project is therefore a deliberate URL change, which SPEC-010's redirect infrastructure will own. Deep links inside an operation are fixed fragments (`#authentication`, `#parameters`, `#parameters-<location>`, `#request-body`, `#request-body-<media>`, `#responses`, `#response-<status>`).

**Rendering and CSP.** Documentation routes render on demand from the memoized artifact. `apps/web/proxy.ts` sets a per-request nonce and a policy with `script-src 'self' 'nonce-…' 'strict-dynamic'` and `style-src 'self' 'nonce-…'`; Next attaches the nonce to every script and stylesheet it emits. The theme choice is a cookie written by a form-post route handler so no inline script is needed. Static export remains possible only with the SPEC-000 header policy and is documented as the degraded path.

## Rationale

A projection inside the web app keeps one canonical model while giving components stable, testable inputs. Contract identifiers make the most readable and most stable URLs because API authors already treat `operationId` as a public name; tag grouping mirrors the approved sidebar and breadcrumb; hashes would be stable but unreadable, and method-and-path alone is verbose and changes whenever a path is edited. Per-request rendering is the only way Next can emit a nonce, and the artifact cache makes each render cheap.

## Consequences

- Positive: no parser leakage, deterministic and readable URLs, one validated artifact per process, a strict production CSP, and a clean seam for the SPEC-005 schema renderer.
- Negative: pages are not statically exported; deployments run the Node server. Renaming an `operationId` or tag changes a URL until SPEC-010 adds redirects.
- Neutral: model v1 carries no component names, so referenced schemas read as their shape (`object`, `array of object`); naming them is tracked for SPEC-005 as an additive model change.

## Security implications

Every canonical string is rendered as text; paired backticks become inline `<code>` and nothing else is interpreted. Route segments are validated against the slug grammar before lookup, so path traversal or prototype-named segments are 404s. The theme handler follows only same-origin absolute paths. The CSP removes inline script execution as an XSS amplifier; the reader's remaining trust boundary is the validated artifact itself.
