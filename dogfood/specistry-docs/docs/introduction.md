---
title: Introduction
description: Understand Specistry's build-time artifact architecture and supported scope.
---

Specistry separates sources, adapters, a canonical model, immutable build artifacts, and the reader. OpenAPI and authored content are processed at build time. Search indexes, snippets, playground policy, quality facts, and release metadata are derived from the same validated model.

## Product boundary

Specistry supports OpenAPI 3.0 and 3.1 plus controlled authored content. It does not ingest AsyncAPI or GraphQL, execute arbitrary MDX, infer SDK methods, proxy playground requests, or provide a hosted documentation service.

Projects can be API-first, content-first, or combine both. A content-first project omits `openapi`; it does not need a fake HTTP contract.

## Trust boundary

The configuration file is trusted build code. Authored page bodies and API descriptions are untrusted data and never execute in the reader. Artifacts are parsed and validated again before rendering.
