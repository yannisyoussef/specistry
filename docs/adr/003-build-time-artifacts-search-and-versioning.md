# ADR-003: Build-time artifacts, search, and versioning

## Status

ACCEPTED — 2026-09-05

## Context

Documentation changes far less frequently than it is read. Parsing large specifications in each browser or request wastes CPU and exposes source complexity at runtime. Search must initially remain self-hosted. Historical documentation should not follow application deployments blindly.

## Problem

Where should transformation and indexing occur, and how should artifacts and URLs express documentation versions?

## Constraints

- Reader routes must be indexable, fast, and self-hostable without a database or paid search service.
- Builds must be deterministic and able to fail on invalid sources.
- Search must be replaceable and scoped to retained versions.
- Historical releases need stable URLs and explicit retention.

## Considered options

1. **Browser parsing/indexing:** easy hosting, but large payloads, slow startup, duplicated work, and parser attack surface in every reader.
2. **Request-time server parsing:** centralizes work but makes availability/caching and source access runtime concerns.
3. **Build-time transformation and local index:** deterministic and cheap to serve, with slower builds and artifact growth.
4. **External search SaaS:** mature relevance, but adds cost, data transfer, lock-in, and an availability/privacy dependency.

## Decision

Parse, normalize, compile, highlight, index, and generate route metadata at build time. Emit immutable, partitioned artifacts consumed by server components and small client islands. Define a search port over versioned `SearchDocument` records; implement a compressed lazy local index first.

Documentation releases are explicit config objects. `/docs/{version}` retains immutable versions and is self-canonical. `/docs` is a convenience alias that sends a non-permanent `302` or `307` redirect to the configured current immutable version and is excluded from sitemaps. Redirect validation, sitemap inclusion, deprecation labels, and search scope are version-aware. Structured contract diffs create review candidates, never automatically published prose.

## Rationale

Build-time failure is safer than runtime semantic surprises and makes hosting simple. A data contract isolates the search engine. Explicit documentation releases capture guide and contract changes together without conflating deployment version.

## Consequences

- Positive: low runtime cost, SEO-ready HTML, deterministic indexes, portable artifacts, and simple rollback.
- Negative: large projects pay build cost and runtime-only private specifications need a later controlled mode.
- Neutral: dynamic personalization is outside the initial architecture.

## Risks

Artifacts and indexes may become large or stale. Partition by route/version, hash inputs, measure budgets, and fail builds rather than serving an old index. Retention policy remains consumer-controlled.

## Security implications

Only explicitly visible normalized fields enter search. Build artifacts must not contain credentials, private environment secrets, or rejected source excerpts. Generated URLs and redirects are validated against the deployment origin policy.
