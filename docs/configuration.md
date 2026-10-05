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
    mode: "browser",
    environments: ["local"],
  },
});
```

## Current fields and defaults

| Field                           | Required/default        | Rules                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                 | Required; currently `1` | Future incompatible config changes increment this value                                                                                                                                                                                                                                                                                                                                                                                       |
| `name`                          | Required                | Trimmed, 1–120 characters                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `openapi`                       | `[]`                    | One project-relative path or an array of at most 64 distinct entries; each entry becomes one service. An empty array creates an authored-content-only site without a fake API. URLs, absolute paths, null bytes, and `..` are rejected                                                                                                                                                                                                        |
| `docs`                          | `./docs`                | Project-relative path under the same policy                                                                                                                                                                                                                                                                                                                                                                                                   |
| `branding.logo` / `favicon`     | Omitted                 | Project-relative files, checked by content at build time (PNG, JPEG, WebP, GIF; SVG without scripts for the logo; ICO for the favicon), at most 512 KiB, copied to the artifact assets                                                                                                                                                                                                                                                        |
| `branding.accent`               | Omitted                 | Six-digit hex colour (`#2a6fdb`) applied as the reader accent                                                                                                                                                                                                                                                                                                                                                                                 |
| `navigation`                    | Omitted                 | Ordered sidebar: page slugs, `{ page, label }`, `{ section, items }` (two levels), one `{ api: true, label? }`, `{ label, link }` (`https`/`http`); at most 500 root nodes, 200 per section; see the [content authoring reference](content-authoring.md#navigation)                                                                                                                                                                           |
| `environments`                  | `{}`                    | Named base URLs used by the code examples' Environment selector (author order; the first is the default); names are identifiers (`[A-Za-z0-9][A-Za-z0-9._~-]*`); HTTPS required except loopback HTTP; credentials, query, and fragment are forbidden                                                                                                                                                                                          |
| `sdks`                          | `[]`                    | Explicit SDK example mappings: `{ id, label, language, package?, coverage?, examples }` where `examples` is inline records `{ operation, code \| file, title?, description? }` or a project-relative JSON file; see the [code samples reference](code-samples.md#sdk-mappings)                                                                                                                                                                |
| `playground.mode`               | `disabled`              | `browser` enables the browser-direct playground for the environments listed under `playground.environments`; see the [playground reference](playground.md)                                                                                                                                                                                                                                                                                    |
| `playground.environments`       | `[]`                    | Ids from `environments` approved for live execution; each must be an exact HTTPS origin (plain HTTP only on loopback) with no credentials, query, fragment, or wildcard, and the list requires `mode: "browser"`; configuring an environment for examples does not approve it                                                                                                                                                                 |
| `playground.responseLimitBytes` | `1048576`               | 1 byte to 4 MiB; the response body read stops at this size and the page labels the body partial                                                                                                                                                                                                                                                                                                                                               |
| `playground.timeoutMs`          | `30000`                 | 1 to 120 000 ms; the request is aborted at the limit                                                                                                                                                                                                                                                                                                                                                                                          |
| `redirects`                     | `[]`                    | Internal redirects frozen with each release (SPEC-010): `{ from, to }` where both are unversioned site paths (`/`, `/docs/<slugs>`, `/api/<slugs>`; `to` may carry an anchor); no scheme, host, query, backslash, or encoded separator; at most 10,000; validated against the release's routes at build and release time (no duplicates, shadowing, missing destinations, or cycles); see the [versioning reference](versioning.md#redirects) |
| `quality`                       | Defaults below          | Documentation quality policy (SPEC-011): `rules` maps a published rule id to `off`, `info`, `warning`, or `error`; `failOn` is `error` (default), `warning`, `info`, or `never`; `maxWarnings` is an optional non-negative integer; `suppressions` is at most 1,000 `{ rule, target, reason, expires? }` entries. Shape is checked here, rule ids by the quality engine; see the [quality reference](quality.md#configuring-policy)           |

Omitting `quality` is the same as `{ rules: {}, failOn: "error", suppressions: [] }`; existing configurations stay valid and unchanged.

Objects are strict: unknown keys fail with path-aware validation issues. `specra validate` maps library issues to stable, value-free `CONFIG_INVALID` diagnostics whose paths use the unified grammar (`config#/environments/*/baseUrl`, `config#/openapi/1`); raw Zod errors, source values, exception text, and stacks are not the terminal/JSON contract. The OpenAPI documents themselves are validated by the ingestion pipeline described in the [OpenAPI ingestion reference](openapi.md).

Paths first pass cross-platform lexical constraints, then orchestration canonicalizes the project root and resolves existing paths/symlinks beneath it. OpenAPI, branding, and SDK example paths must be files; `docs` must be a directory. Missing, wrong-type, absolute, traversing, or symlink-escaping paths fail closed. Environment base paths are allowed; the code examples and the playground resolve operation paths against the normalized base, and the playground refuses any composed URL that leaves the approved origin or its base path.

The project root defaults to the invocation directory. `--root` accepts one relative or absolute host path; relative values resolve from the invocation directory. Specra does not search parent directories. The deterministic artifact root is `.specra/artifacts`; validation resolves it through the nearest existing ancestor but does not create or delete it, and `specra build` writes it atomically.

## Trust and migration

`specra.config.ts` is trusted build code with the operating-system authority and environment of its isolated child process. The process bounds time, output, memory hints, cancellation, descendant lifecycle, and result serialization, but is not a security sandbox. Config exceptions and output are discarded from normal diagnostics to avoid leaking ambient secrets. `NODE_OPTIONS` is removed when starting the child so parent execution flags and loaders are not re-evaluated. Untrusted or hosted builds must use a data-only JSON/YAML equivalent. After v1 stabilizes, deprecated keys warn for at least one documented release window; migrations are explicit and deterministic. See [ADR-004](adr/004-content-and-configuration-trust.md), [ADR-008](adr/008-cli-orchestration-and-config-execution.md), and the [CLI reference](cli.md).
