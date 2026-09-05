# Configuration reference

The canonical local filename is `specra.config.ts`. In Phase 0, `@specra/config` exposes the data contract and `defineConfig`; loading executable TypeScript is intentionally deferred to the thin CLI/build-orchestrator slice.

```typescript
import { defineConfig } from "@specra/config";

export default defineConfig({
  schemaVersion: 1,
  name: "Example API",
  openapi: "./openapi.yaml",
  docs: "./docs",
  branding: {
    logo: "./public/logo.svg",
    favicon: "./public/favicon.svg",
  },
  environments: {
    production: {
      label: "Production",
      baseUrl: "https://api.example.com/v1",
    },
    local: {
      baseUrl: "http://localhost:8080",
    },
  },
  playground: {
    mode: "disabled",
  },
});
```

## Current fields and defaults

| Field                       | Required/default        | Rules                                                                                                   |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `schemaVersion`             | Required; currently `1` | Future incompatible config changes increment this value                                                 |
| `name`                      | Required                | Trimmed, 1–120 characters                                                                               |
| `openapi`                   | Required                | One project-relative path or a non-empty array; URLs, absolute paths, null bytes, and `..` are rejected |
| `docs`                      | `./docs`                | Project-relative path under the same policy                                                             |
| `branding.logo` / `favicon` | Omitted                 | Project-relative paths; asset validation arrives with authored content                                  |
| `environments`              | `{}`                    | Named base URLs; HTTPS required except loopback HTTP; credentials, query, and fragment are forbidden    |
| `playground.mode`           | `disabled`              | `browser` is reserved for the future browser-direct slice; parsing config does not implement execution  |

Objects are strict: unknown keys fail with path-aware validation issues. The future CLI maps library validation issues to stable Specra diagnostic codes; raw Zod errors are not the public terminal/JSON contract.

Paths are lexical configuration constraints, not a complete filesystem sandbox. The loader must resolve real paths and symlinks beneath the consumer project root before reading. Environment base paths are allowed and operation paths are resolved against a normalized trailing-slash base in the playground slice.

## Trust and migration

`specra.config.ts` is trusted build code with the authority of its isolated worker. Untrusted or hosted builds must use a data-only JSON/YAML equivalent. After v1 stabilizes, deprecated keys warn for at least one documented release window; migrations are explicit and deterministic. See [ADR-004](adr/004-content-and-configuration-trust.md).
