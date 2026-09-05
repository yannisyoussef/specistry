# Reader reference

The reader (`apps/web`) renders a project's canonical artifacts as an indexable API reference. It consumes only what `specra build` writes into `.specra/artifacts`; it never reads OpenAPI sources, never runs the ingestion pipeline, and never imports parser vocabulary (the architecture gate allows `apps/web` to depend on `@specra/model` and `@specra/config` only).

## Pipeline

```text
specra build
  → .specra/artifacts/documentation.json + manifest.json
  → artifact loader (manifest + model validation, memoized per process)
  → reader projection (services → groups → operations, slugs, views)
  → Next.js routes (React Server Components)
  → two client islands (mobile drawer, copy control)
```

Every route renders on demand from the memoized artifact so the per-request nonce policy applies (ADR-010). A missing, malformed, incompatible, or inconsistent artifact fails `next build` and `next start` with a message that names the file and tells you to run `specra build`; the reader never serves an empty site in its place.

## Configuration

| Variable              | Purpose                                                                                                           | Default                                               |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `SPECRA_PROJECT_ROOT` | Absolute path of the project whose `.specra/artifacts` the reader serves                                          | The working directory of the Next process             |
| `SPECRA_SITE_URL`     | Public origin used for the canonical `<link>`, `sitemap.xml`, and `robots.txt`; must be an absolute `http(s)` URL | The artifact's `project.canonicalUrl`, otherwise none |

Without a site origin the sitemap is intentionally empty and canonical links stay relative rather than pointing at a guessed host. Set both variables when building and when starting the server:

```bash
SPECRA_PROJECT_ROOT=/srv/docs-project SPECRA_SITE_URL=https://docs.example.com pnpm --filter @specra/web build
SPECRA_PROJECT_ROOT=/srv/docs-project SPECRA_SITE_URL=https://docs.example.com pnpm --filter @specra/web start
```

The repository's own CI and browser suites point these at the committed TestInbox fixture (`tests/fixtures/reader/testinbox`).

## Routes

| Route                                       | Content                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/`                                         | Project home: name, description, "API reference" entry, groups with endpoint counts |
| `/api`                                      | API reference index: every group with its operations                                |
| `/api/<group>`                              | One tag group (single-service projects)                                             |
| `/api/<group>/<operation>`                  | Operation page                                                                      |
| `/api/<service>`, `/api/<service>/<group>…` | The same tree with a service segment when a project documents several services      |
| `/sitemap.xml`, `/robots.txt`               | Indexable routes and crawl policy (`/theme` is disallowed)                          |
| `/theme`                                    | `POST` only: stores the light/dark/system choice in a cookie and redirects back     |

Group slugs are slugified tag names; operation slugs are the contract `operationId` in kebab case or `<method>-<path>` without one; collisions gain `-2`, `-3` suffixes in canonical order. Untagged operations live in the `operations` group. Operation pages expose deterministic deep links: `#authentication`, `#parameters`, `#parameters-<location>`, `#request-body`, `#request-body-<media>`, `#responses`, `#response-<status>`, and `#servers`. The full policy is ADR-010.

## Operation page

In order: breadcrumb, title (with a `Deprecated` badge when applicable), method and path with a copy control, description, deprecation callout, authentication (OR alternatives of AND-joined schemes, anonymous alternatives spelled out), parameters grouped by location with required/optional/deprecated stated in words, request body per media type with a schema summary and one level of properties, responses in deterministic order (numeric codes, `1XX`–`5XX` ranges, `default`) with headers and either media blocks or "No response body", and the servers the operation applies to.

Schema detail is deliberately restrained: a type phrase, a constraints line, and direct properties. Nested structure is announced as not expanded; the SPEC-005 schema renderer replaces this summary.

## Security posture

- `proxy.ts` sets a per-request `Content-Security-Policy` with a nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `base-uri 'self'`, `img-src 'self' data:`, `font-src 'self'`, `upgrade-insecure-requests`. Development adds `'unsafe-eval'` for React's debugging tooling only. Fixed headers (`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`) come from `next.config.ts` and also cover static assets.
- Canonical strings are rendered as text. Paired backticks become inline `<code>`; no Markdown, HTML, or link is interpreted, so `<script>`, event handlers, and `javascript:` URLs display literally.
- Route segments must match the slug grammar before lookup; anything else is a 404.
- The theme handler only follows absolute same-origin paths.
- Fonts are self-hosted from `node_modules` (OFL variable fonts) and served under `font-src 'self'`.

## Deployment notes

The default deployment is the Node server (`next start`), which is required for the nonce policy. A static export cannot carry per-request nonces; hosts that need static output must keep the SPEC-000 header policy (with `'unsafe-inline'`) at the host level and accept the weaker script policy. Serve `/_next/static` with long-lived caching; documentation routes are cheap to render because the artifact is validated once per process.

## Budgets

Measured on the TestInbox fixture (25 operations) and enforced in CI:

| Measure                                      | Baseline | Budget                        |
| -------------------------------------------- | -------- | ----------------------------- |
| Operation page client JavaScript (gzip)      | 134.7 KB | 150 KiB (`pnpm check:bundle`) |
| Route-specific chunks beyond the framework   | 4.5 KB   | 40 KiB                        |
| Operation page HTML                          | ~77 KB   | 200 KiB (browser test)        |
| Navigation with 600 operations (server HTML) | static   | no client nodes per item      |

The framework bootstrap (React 19 and the Next runtime, about 130 KB gzip) dominates; the reader's own client code is the two islands.
