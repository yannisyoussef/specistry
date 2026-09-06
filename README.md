# Specra

Specra is a self-hosted, product-agnostic developer documentation platform. It transforms API specifications, authored guidance, and project configuration into an accessible developer experience while keeping source formats, rendering, and deployment independently evolvable.

The repository currently contains the engineering foundation, canonical model v1, and the SPEC-002 thin validation CLI/orchestrator. It intentionally does not yet contain OpenAPI normalization, a complete API reference, search, playground, or content rendering.

## Requirements

- Node.js 24.20.0 (the pinned active LTS runtime)
- pnpm 11.19.0
- Git

Use the checked-in `.node-version` or `.nvmrc`. The exact pnpm release is declared by `packageManager` and enforced by the workspace.

## Setup

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

For the reader (see [docs/reader.md](docs/reader.md); `SPECRA_PROJECT_ROOT` must point at a project that has run `specra build`, for example `tests/fixtures/reader/testinbox`):

```bash
pnpm dev
```

Then open `http://localhost:3000`.

To exercise the built CLI:

```bash
pnpm build
./packages/cli/dist/bin.js --help
./packages/cli/dist/bin.js validate --root /path/to/consumer/project
```

The future published executable name is `specra`. See the [CLI reference](docs/cli.md) for its current scope, programmatic API, diagnostics, and exit contract.

## Commands

| Command                   | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `pnpm dev`                | Run the reader shell in development                              |
| `pnpm build`              | Build all packages and applications in dependency order          |
| `pnpm format`             | Apply repository formatting                                      |
| `pnpm lint`               | Lint TypeScript, React, and Markdown                             |
| `pnpm typecheck`          | Type-check every workspace project                               |
| `pnpm test`               | Run deterministic unit, security, accessibility, and smoke tests |
| `pnpm test:coverage`      | Run tests and emit coverage summaries                            |
| `pnpm test:e2e`           | Run Chromium browser and accessibility smoke tests               |
| `pnpm test:security`      | Run the malicious-input foundation tests                         |
| `pnpm test:performance`   | Run fresh-process ingestion and model performance evidence       |
| `pnpm check:architecture` | Enforce dependency directions, manifest edges, and opaque loads  |
| `pnpm check:dependencies` | Enforce exact dependency and private-package manifest policy     |
| `pnpm check:licenses`     | Reject denied production dependency licenses                     |
| `pnpm check:secrets`      | Reject likely committed secrets without printing their values    |
| `pnpm check`              | Run the local fast quality gate                                  |

## Repository map

```text
specra/
├── apps/web/                 Next.js reader (artifact loader, projection, routes)
├── packages/cli/             Thin CLI and reusable orchestration context
├── packages/config/          Validated consumer configuration contract
├── packages/content/         Authored Markdown/MDX compiler: bounded AST, components, highlighting
├── packages/search/          Build-time search projection and index, browser-safe query engine
├── packages/snippets/        Pure request projection and cURL/HTTP/JS/TS/Java/Python generators
├── packages/model/           Framework-neutral canonical documentation model
├── packages/openapi/         OpenAPI 3.0/3.1 ingestion: bounded parse, confined refs, normalization
├── tests/                    Unit, security, accessibility, performance, and browser tests
├── scripts/                  Architecture, license, and secret-policy checks
└── docs/                     Product, architecture, security, ADRs, and roadmap
```

Start with the [architecture entry point](docs/architecture/README.md), [product definition](docs/product-definition.md), [CLI reference](docs/cli.md), [OpenAPI ingestion reference](docs/openapi.md), [configuration reference](docs/configuration.md), [content authoring reference](docs/content-authoring.md), [search reference](docs/search.md), [code samples reference](docs/code-samples.md), [playground reference](docs/playground.md), [threat model](docs/security/threat-model.md), [deployment requirements](docs/deployment.md), and [roadmap](docs/roadmap.md). Contributors should read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Development integrates through `develop`; reviewed, green promotion pull requests move releases to the production branch, `master`. The complete branch and hotfix workflow is documented in [CONTRIBUTING.md](CONTRIBUTING.md#branch-workflow).

## Current guarantees

- Rendering code cannot depend on raw OpenAPI parser objects.
- Canonical schema recursion uses IDs, so the model remains serializable.
- OpenAPI parsing is bounded and YAML aliases are denied. Remote references remain inert strings during parsing; any future retrieval is denied without an exact HTTPS-origin policy and additional resolver controls.
- `specra.config.ts` is trusted build code evaluated in a bounded, cancellable child process. The process is operational isolation, not a malicious-code sandbox.
- `specra validate` checks config v1, canonical project-root confinement, symlinks, source-path existence/types, and the deterministic `.specra/artifacts` policy. It does not claim OpenAPI semantic validity.
- The browser-direct playground (SPEC-009) executes requests from the reader's browser against explicitly approved environments only, with memory-only credentials, exact-origin enforcement, and no server proxy; see the [playground reference](docs/playground.md).
- Authored Markdown/MDX never executes: pages compile to a validated content model with a fixed component vocabulary; expressions, imports, and raw HTML are build errors with a line and column, and assets are checked by content, size-limited, and served only by content-addressed name.
- Search is generated at build time and answered in the browser from a digest-checked, content-addressed artifact; queries never leave the reader and no search service or telemetry exists.
- Code examples in six protocol languages are projected from the canonical operation by a pure, deterministic generator with hardened escaping and placeholder credentials; SDK examples are rendered only when the project author mapped them explicitly. Nothing in the reader sends a request or accepts a destination the build did not validate.
- Critical dependency boundaries, accessibility smoke coverage, malicious-input controls, and production-license policy run in CI.

A project license, release process, and independently published packages are deliberately deferred until repository ownership and distribution policy are decided.
