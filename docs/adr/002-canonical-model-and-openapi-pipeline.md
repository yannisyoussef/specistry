# ADR-002: Canonical model and OpenAPI ingestion pipeline

## Status

ACCEPTED — 2026-09-05

## Context

OpenAPI 3.0 and 3.1 expose different JSON Schema dialect behavior, parser-specific shapes, `$ref` graphs, and source quirks. Rendering, indexing, snippets, and future source adapters need stable semantics without importing arbitrary OpenAPI structures.

## Problem

What representation and pipeline preserve difficult API semantics, deterministic output, serializability, and future adapter independence?

## Constraints

- OpenAPI is untrusted source input, not a rendering model.
- OpenAPI 3.1 correctness and recursive/cyclic schemas are priorities.
- Output must support search, snippets, schema rendering, tests, and artifact caching.
- Unsupported constructs must be visible rather than silently discarded.
- A resolver dependency must prove security controls against the corpus before selection.

## Considered options

1. **Pass parser objects to React:** low initial transformation cost, but leaks dialect/library quirks everywhere and prevents stable contracts.
2. **Bundle/dereference into an object tree:** convenient reads, but cycles, duplication, memory amplification, and lost source identity are dangerous.
3. **Versioned canonical graph with registries and ID references:** explicit conversion cost, but stable and serializable.
4. **Generic universal API AST:** promises future formats early, but would erase useful semantics before those adapters exist.

## Decision

Use the pipeline bytes → parse → resolve → validate → normalize → canonical model v1 → purpose-specific projections. Parser and resolved models are adapter-private. The canonical model represents source-independent API/service/operation/auth/body/response/example/schema semantics and authored-page metadata. Registries plus stable IDs represent schema cycles. Unknown or unsupported constructs carry explicit diagnostics. Normalization fixes ordering and identifiers deterministically.

Local references resolve within an approved project root with symlink/path-escape controls. Remote references are off by default and require HTTPS host allowlists, public pinned resolution, redirect denial, size/time limits, and isolated egress. A production parser/resolver is selected in SPEC-003 through corpus evidence, not brand recognition.

## Rationale

A graph preserves identity and recursion without non-serializable object cycles. A versioned boundary lets search and UI evolve independently and lets future AsyncAPI or GraphQL adapters target useful shared semantics without pretending their differences do not exist.

## Consequences

- Positive: renderer isolation, deterministic artifacts, focused tests, replaceable parsers, safe recursion, and clear adapter ownership.
- Negative: normalization is substantial work and the model needs explicit migrations as semantics improve.
- Neutral: source-specific extensions remain JSON data and are not automatically understood by renderers.

## Risks

The model may be too OpenAPI-shaped or too generic. SPEC-001 validates it against rendering/search/snippet consumers and difficult schemas before full ingestion. Callback/event concepts stay diagnostic until a justified canonical abstraction exists.

## Security implications

Limits apply before and during parsing/resolution. Remote fetch is fail-closed. Raw strings remain untrusted even after normalization; rendering still encodes them. Stable diagnostic pointers must redact source values and credentials.
