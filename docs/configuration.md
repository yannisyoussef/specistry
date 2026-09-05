# Configuration reference

The canonical local filename is `specra.config.ts`. `@specra/config` exposes the strict data contract and `defineConfig`; `@specra/cli` loads and validates that file through the SPEC-002 orchestration boundary.

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

| Field                       | Required/default        | Rules                                                                                                                                                                  |
| --------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`             | Required; currently `1` | Future incompatible config changes increment this value                                                                                                                |
| `name`                      | Required                | Trimmed, 1–120 characters                                                                                                                                              |
| `openapi`                   | Required                | One project-relative path or a non-empty array of at most 64 distinct entries; each entry becomes one service; URLs, absolute paths, null bytes, and `..` are rejected |
| `docs`                      | `./docs`                | Project-relative path under the same policy                                                                                                                            |
| `branding.logo` / `favicon` | Omitted                 | Project-relative paths; asset validation arrives with authored content                                                                                                 |
| `environments`              | `{}`                    | Named base URLs; HTTPS required except loopback HTTP; credentials, query, and fragment are forbidden                                                                   |
| `playground.mode`           | `disabled`              | `browser` is reserved for the future browser-direct slice; parsing config does not implement execution                                                                 |

Objects are strict: unknown keys fail with path-aware validation issues. `specra validate` maps library issues to stable, value-free `CONFIG_INVALID` diagnostics whose paths use the unified grammar (`config#/environments/*/baseUrl`, `config#/openapi/1`); raw Zod errors, source values, exception text, and stacks are not the terminal/JSON contract. The OpenAPI documents themselves are validated by the ingestion pipeline described in the [OpenAPI ingestion reference](openapi.md).

Paths first pass cross-platform lexical constraints, then orchestration canonicalizes the project root and resolves existing paths/symlinks beneath it. OpenAPI and branding paths must be files; `docs` must be a directory. Missing, wrong-type, absolute, traversing, or symlink-escaping paths fail closed. Environment base paths are allowed and operation paths will be resolved against a normalized trailing-slash base in the playground slice.

The project root defaults to the invocation directory. `--root` accepts one relative or absolute host path; relative values resolve from the invocation directory. Specra does not search parent directories. The deterministic artifact root is `.specra/artifacts`; validation resolves it through the nearest existing ancestor but does not create or delete it, and `specra build` writes it atomically.

## Trust and migration

`specra.config.ts` is trusted build code with the operating-system authority and environment of its isolated child process. The process bounds time, output, memory hints, cancellation, descendant lifecycle, and result serialization, but is not a security sandbox. Config exceptions and output are discarded from normal diagnostics to avoid leaking ambient secrets. `NODE_OPTIONS` is removed when starting the child so parent execution flags and loaders are not re-evaluated. Untrusted or hosted builds must use a data-only JSON/YAML equivalent. After v1 stabilizes, deprecated keys warn for at least one documented release window; migrations are explicit and deterministic. See [ADR-004](adr/004-content-and-configuration-trust.md), [ADR-008](adr/008-cli-orchestration-and-config-execution.md), and the [CLI reference](cli.md).
