---
title: Schemas and search
description: Read complex schema projections and use private build-time search.
---

Schema pages preserve references, recursion, variants, read and write context, constraints, tuple and dictionary shapes, and bounded expansion. Focused schema routes are excluded from indexing where appropriate.

Search is produced at build time from authored pages, headings, services, groups, operations, paths, schemas, SDK labels, and changelog records. The browser loads a content-addressed, digest-checked index lazily. Queries stay in the browser; Specra has no search service, analytics pipeline, or telemetry endpoint.

If the search artifact is missing or corrupted, the reader exposes a recoverable unavailable state rather than silently querying another service.
