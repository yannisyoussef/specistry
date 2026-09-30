---
title: OpenAPI ingestion
description: Ingest bounded local OpenAPI 3.0 and 3.1 contracts into the canonical model.
---

Each configured OpenAPI root becomes a distinct service. Local references resolve through a confined acquisition boundary; remote references remain disabled. Separate contracts are not merged merely because their paths or operation identifiers look similar.

## Build guarantees

- JSON and YAML are parsed under byte, depth, node, alias, document, reference, operation, schema, and diagnostic limits.
- Duplicate keys, malformed references, escapes, and identity collisions fail closed.
- Parser objects stop at the adapter boundary.
- Unsupported semantics produce stable, value-free diagnostics.
- Output serialization is deterministic.

AsyncAPI is outside the current adapter set. Describe event-driven behavior in authored guidance without claiming first-class event-schema rendering.
