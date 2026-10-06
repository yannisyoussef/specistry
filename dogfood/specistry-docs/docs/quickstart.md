---
title: Quickstart
description: Create and build a minimal authored-content project.
---

Create `specistry.config.ts` at the project root:

```ts
import { defineConfig } from "@specistry/config";

export default defineConfig({
  schemaVersion: 1,
  name: "Acme developer docs",
  openapi: ["./contracts/public.json"],
});
```

Create `docs/index.md` with frontmatter and a body, then run:

```bash
specistry validate
specistry build
specistry check
```

The build writes a complete candidate under `.specistry/artifacts`. Validation reads sources but writes nothing. Quality reads an existing candidate and never rebuilds it.

For authored-content-only documentation, omit `openapi`. For API-only documentation, keep the docs directory empty and configure one or more contracts.
