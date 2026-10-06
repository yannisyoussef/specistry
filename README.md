# Specistry

Documentation you can build on.

Specistry turns specifications and authored content into structured, searchable developer documentation. It is self-hosted and product-agnostic, with independently evolvable source formats, rendering, and deployment.

Specistry was previously released as Specra. The project was renamed beginning with `0.1.0-rc.3` to avoid confusion with an unrelated developer-documentation product. See the [brand migration](docs/brand-migration.md).

The repository contains the complete pre-release product through SPEC-012: bounded OpenAPI ingestion, authored content, an accessible reader, self-hosted search, generated protocol examples, an opt-in browser-direct playground, immutable documentation releases, and deterministic quality gates. The release candidate is `0.1.0-rc.3`. The owner has confirmed Specistry's Licensor, copyright ownership, licensing authority, and final Business Source License parameters. Public distribution requires verified protected-workflow provenance and a committed public-distribution ledger. Qualified external legal review is strongly recommended and has not been recorded.

Specistry is continuously tested with automated accessibility rules, keyboard navigation, responsive layouts, and Chromium, Firefox, and WebKit. Manual VoiceOver and NVDA qualification is planned before the 1.0 stable release. The owner has accepted this qualification gap for pre-1.0 release candidates as [A11Y-R01](docs/reviews/spec-012-manual-at.md); no comprehensive screen-reader or formal WCAG conformance claim is made.

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

For the reader (see [docs/reader.md](docs/reader.md); `SPECISTRY_PROJECT_ROOT` must point at a project that has run `specistry build`):

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

The packed executable name is `specistry`. See the [CLI reference](docs/cli.md) for its commands, diagnostics, and exit contract. The package is not published while the remaining release gates are open.

The first planned npm release is `@specistry/cli@0.1.0-rc.3`, under the `next` tag, never `latest`. Registry installation is **pending publication**; use a qualified candidate tarball until the [release process](docs/release-process.md) records public verification.

## Commands

| Command                      | Purpose                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `pnpm dev`                   | Run the reader shell in development                                  |
| `pnpm build`                 | Build all packages and applications in dependency order              |
| `pnpm format`                | Apply repository formatting                                          |
| `pnpm lint`                  | Lint TypeScript, React, and Markdown                                 |
| `pnpm typecheck`             | Type-check every workspace project                                   |
| `pnpm test`                  | Run deterministic unit, security, accessibility, and smoke tests     |
| `pnpm test:coverage`         | Run tests and emit coverage summaries                                |
| `pnpm test:e2e`              | Run Chromium browser and accessibility smoke tests                   |
| `pnpm test:cross-browser`    | Run critical release flows in Chromium, Firefox, and WebKit          |
| `pnpm test:security`         | Run the malicious-input foundation tests                             |
| `pnpm test:performance`      | Run fresh-process ingestion and model performance evidence           |
| `pnpm check:architecture`    | Enforce dependency directions, manifest edges, and opaque loads      |
| `pnpm check:dependencies`    | Enforce exact dependency and private-package manifest policy         |
| `pnpm check:licenses`        | Reject denied production dependency licenses                         |
| `pnpm check:public-boundary` | Reject consumer coupling to workspace-private implementation paths   |
| `pnpm check:quality`         | Dogfood `specistry check` on a real fixture and prove the gate fails |
| `pnpm check:secrets`         | Reject likely committed secrets without printing their values        |
| `pnpm check`                 | Run the local fast quality gate                                      |

## Repository map

```text
specistry/
├── apps/web/                 Next.js reader (artifact loader, projection, routes)
├── packages/cli/             Thin CLI and reusable orchestration context
├── packages/config/          Validated consumer configuration contract
├── packages/content/         Authored Markdown/MDX compiler: bounded AST, components, highlighting
├── packages/search/          Build-time search projection and index, browser-safe query engine
├── packages/snippets/        Pure request projection and cURL/HTTP/JS/TS/Java/Python generators
├── packages/quality/         Documentation quality facts, rule registry, policy evaluation
├── packages/release/         Release manifests, catalog, route tables, redirects, structured diff, changelog
├── packages/model/           Framework-neutral canonical documentation model
├── packages/openapi/         OpenAPI 3.0/3.1 ingestion: bounded parse, confined refs, normalization
├── tests/                    Unit, security, accessibility, performance, and browser tests
├── scripts/                  Architecture, license, and secret-policy checks
└── docs/                     Product, architecture, security, ADRs, and roadmap
```

Start with the [architecture entry point](docs/architecture/README.md), [product definition](docs/product-definition.md), [CLI reference](docs/cli.md), [OpenAPI ingestion reference](docs/openapi.md), [configuration reference](docs/configuration.md), [content authoring reference](docs/content-authoring.md), [search reference](docs/search.md), [code samples reference](docs/code-samples.md), [playground reference](docs/playground.md), [versioning reference](docs/versioning.md), [quality reference](docs/quality.md), [threat model](docs/security/threat-model.md), [deployment requirements](docs/deployment.md), [compatibility policy](docs/compatibility.md), [support policy](docs/support.md), [release process](docs/release-process.md), [license decision](docs/license-decision.md), and [roadmap](docs/roadmap.md). Contributors should read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Development integrates through `develop`; reviewed, green promotion pull requests move releases to the production branch, `master`. The complete branch and hotfix workflow is documented in [CONTRIBUTING.md](CONTRIBUTING.md#branch-workflow).

## Current guarantees

- Rendering code cannot depend on raw OpenAPI parser objects.
- Canonical schema recursion uses IDs, so the model remains serializable.
- OpenAPI parsing is bounded and YAML aliases are denied. Remote references remain inert strings during parsing; any future retrieval is denied without an exact HTTPS-origin policy and additional resolver controls.
- `specistry.config.ts` is trusted build code evaluated in a bounded, cancellable child process. The process is operational isolation, not a malicious-code sandbox.
- `specistry validate` checks config v1, canonical project-root confinement, symlinks, source-path existence/types, and the deterministic `.specistry/artifacts` policy. It does not claim OpenAPI semantic validity.
- The browser-direct playground (SPEC-009) executes requests from the reader's browser against explicitly approved environments only, with memory-only credentials, exact-origin enforcement, and no server proxy; see the [playground reference](docs/playground.md).
- Authored Markdown/MDX never executes: pages compile to a validated content model with a fixed component vocabulary; expressions, imports, and raw HTML are build errors with a line and column, and assets are checked by content, size-limited, and served only by content-addressed name.
- Search is generated at build time and answered in the browser from a digest-checked, content-addressed artifact; queries never leave the reader and no search service or telemetry exists.
- Code examples in six protocol languages are projected from the canonical operation by a pure, deterministic generator with hardened escaping and placeholder credentials; SDK examples are rendered only when the project author mapped them explicitly. Nothing in the reader sends a request or accepts a destination the build did not validate.
- Documentation versions (SPEC-010) are immutable release sets promoted explicitly from a verified candidate; `/docs/{version}` and `/api/{version}` are self-canonical and never fall back to newer content, `/docs` is a non-permanent alias to the explicit current release, redirects are validated internal data, and changelogs are human-reviewed from value-free structured diff candidates; see the [versioning reference](docs/versioning.md).
- Documentation quality (SPEC-011) is a deterministic gate, not a score: a static rule catalogue produces findings from normalized facts, project policy assigns severities, thresholds, and governed suppressions, and `specistry check` maps the result to an exit code. `specistry diff` exposes the SPEC-010 structured diff as a read-only public command. Neither runs user code, reaches the network, or writes anything; see the [quality reference](docs/quality.md).
- Critical dependency boundaries, accessibility smoke coverage, malicious-input controls, and production-license policy run in CI.

## License

Specistry is source-available under the Business Source License 1.1
(`BUSL-1.1`). The Additional Use Grant permits individuals and companies to
self-host Specistry in production to create, host, and publish documentation for
their own products, services, APIs, projects, and internal systems, including
commercial uses. Offering Specistry itself, or a service whose primary value is
Specistry's functionality, as a hosted or managed service to third parties falls
outside that grant and requires a commercial agreement while the BSL applies.

Each specific version changes to Apache-2.0 three years after that version's
first public distribution. Specistry is not open source before the applicable
Change Date. See the authoritative [license decision](docs/license-decision.md)
and [LICENSE](LICENSE).

The confirmed Licensor and copyright owner is INFINITY VENTURES (legal form:
SASU), and the release-license gate passes. Public distribution requires the
protected provenance and committed ledger evidence in the
[release process](docs/release-process.md).
