---
title: Configuration
description: Configure sources, branding, environments, navigation, redirects, and policy.
---

`specistry.config.ts` exports schema version 1 data through `defineConfig`. Unknown keys fail. Paths are project-relative and must remain under the canonical project root after symlink resolution.

## Main fields

- `name` identifies the project.
- `openapi` is omitted for content-only docs, a path for one service, or an ordered array for multiple services.
- `docs` defaults to `./docs`.
- `navigation` composes pages, sections, one API insertion, and external links.
- `branding` accepts an accent, logo, and favicon.
- `environments` feeds generated protocol examples.
- `sdks` contains only explicitly authored SDK examples.
- `playground` is disabled unless browser execution and exact environments are approved.
- `quality` assigns severities, thresholds, and governed suppressions.

The configuration process is bounded operationally, but it is not a sandbox. Review it with the same care as a build script.
