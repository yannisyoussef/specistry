# Specra product definition

## Problem

Engineering teams need accurate, polished API and product documentation without surrendering deployment control, content portability, extensibility, or security policy to a hosted vendor. Raw contracts are not a reader experience, while bespoke portals tend to couple parser quirks to UI code and become expensive to maintain.

## Vision

Specra transforms specifications, authored guidance, and validated configuration into a cohesive, accessible, self-hosted developer experience. It is infrastructure reusable across products; TestInbox is its first production-realistic acceptance case, not a privileged code path.

## Users and terminology

| Term                 | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Specra author        | Writes guides, configuration, examples, navigation, branding, and contract annotations for a consuming project |
| Specra consumer      | Product or team that integrates Specra and deploys the resulting portal                                        |
| Documentation reader | Person reading guides or reference material                                                                    |
| API consumer         | Developer integrating with an API, possibly through the playground or SDK examples                             |
| Specra contributor   | Engineer evolving Specra packages, tooling, architecture, and tests                                            |

A person may hold several roles, but their trust and workflows differ. In particular, being a documentation reader never grants content-execution or upstream-network authority.

## Goals

- Render product guidance and OpenAPI 3.x reference material through one coherent information architecture.
- Isolate source-format semantics from a strongly typed, deterministic, serializable canonical model.
- Provide project-controlled navigation, branding, deployment, versions, changelog, search, real SDK examples, and safe request exploration.
- Give authors local feedback and CI-enforceable documentation quality checks.
- Default to accessible, fast, indexable output with minimal client JavaScript.
- Make risky capabilities explicit and configurable without becoming a generic proxy or arbitrary extension host.

## Primary use cases

1. An author points Specra at one or more OpenAPI contracts and a docs tree, then previews changes locally.
2. A product builds immutable documentation artifacts and deploys them on its own infrastructure.
3. A reader finds a concept or operation, understands schemas and authentication, and copies an accurate protocol or curated SDK example.
4. An API consumer chooses an approved environment and executes a request without exposing credentials to Specra persistence or telemetry.
5. CI validates source correctness, documentation completeness, architecture boundaries, and regressions.
6. A maintainer retains historical docs versions independently of application deployment versions.

## Functional boundary

Specra owns ingestion adapters, normalization, content compilation under a defined trust model, reference and guide rendering, navigation, build-time indexing, snippet generation, quality policy, a CLI orchestrator, and guarded playground integration. Consumers own contract correctness against live APIs, documentation source review, branding assets, SDK API mappings, deployment policy, upstream authorization, and environment allowlists.

Specra can expose hooks for contract-conformance tools, but does not assert that a parsing OpenAPI file matches a running service.

## Non-functional requirements

- **Correctness:** deterministic normalized output; explicit diagnostics for unsupported or invalid semantics; OpenAPI 3.1 JSON Schema behavior prioritized.
- **Security:** hostile-source assumptions, no unsanitized HTML, bounded processing, remote refs off by default, no unrestricted proxy, secret redaction.
- **Accessibility:** WCAG 2.2 AA target; automated rules, keyboard navigation, responsive layouts, and Chromium/Firefox/WebKit are continuously tested. Manual VoiceOver/NVDA qualification is planned before stable `1.0.0`; pre-1.0 RCs make no comprehensive screen-reader or formal WCAG conformance claim.
- **Performance:** static-first pages, defined payload and parser budgets, bounded schema expansion, replaceable build-time search.
- **Portability:** self-host on a Node server or static-capable target where selected features permit; no required paid SaaS.
- **Maintainability:** small dependency graph, stable package contracts, ADRs, semantic tests, centralized versions, explicit ownership.
- **Reliability:** builds fail closed on invalid inputs; historical output is reproducible from locked inputs.
- **Privacy:** no usage telemetry by default; credentials and sensitive payloads excluded from logs and analytics.
- **SEO:** stable version-aware URLs, page-specific metadata, canonical links, sitemap, redirects, and semantic headings.

Measurable initial targets live in [performance and accessibility objectives](development/performance-accessibility.md).

## Explicit non-goals

Initial development excludes AsyncAPI and GraphQL renderers, AI writing or chat, SaaS multi-tenancy, billing, hosted analytics, collaborative editing, WYSIWYG authoring, marketplaces, arbitrary runtime plugins or code, developer account management, and automatic inference of high-level SDK calls. Specra is not a general HTTP proxy or a runtime API-conformance product.

## Product principles

1. OpenAPI is input, never the UI model.
2. Every package and abstraction must own a concrete responsibility.
3. Build-time work is preferred for deterministic, cacheable transformations.
4. Security boundaries override convenience.
5. Filesystem layout does not dictate navigation.
6. Generated output must remain reviewable; structured diffs inform changelogs but never auto-publish prose.
