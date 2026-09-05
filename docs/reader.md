# Reader reference

The reader (`apps/web`) renders a project's canonical artifacts as an indexable API reference. It consumes only what `specra build` writes into `.specra/artifacts`; it never reads OpenAPI sources, never runs the ingestion pipeline, and never imports parser vocabulary (the architecture gate allows `apps/web` to depend on `@specra/model` and `@specra/config` only).

## Pipeline

```text
specra build
  → .specra/artifacts/documentation.json + manifest.json
  → artifact loader (manifest + model validation, memoized per process)
  → reader projection (services → groups → operations, slugs, views)
  → Next.js routes (React Server Components)
  → three client islands (mobile drawer, copy control, sidebar scroll position)
```

Every route renders on demand from the memoized artifact so the per-request nonce policy applies (ADR-010). A missing, malformed, incompatible, or inconsistent artifact fails `next build` and `next start` with a message that names the file, includes the first model diagnostics, and tells you to run `specra build`; the reader never serves an empty site in its place. The artifact is loaded once per process (at startup through `instrumentation.ts`) and kept in memory; a very large artifact costs its parsed size in server heap, which is the documented trade for validation-once rendering.

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

Group slugs are slugified tag names; operation slugs are the contract `operationId` in kebab case or `<method>-<path>` without one; collisions gain `-2`, `-3` suffixes in canonical order. Service slugs come from the document's `info.title`. Groups are ordered alphabetically (case-folded) because the canonical model does not yet record tag declaration order or tag descriptions; the untagged `operations` group always comes last. Unknown or malformed `/api/*` routes are rewritten by `proxy.ts` to a server-rendered 404 page with status 404, so crawlers and no-script clients receive real HTML rather than a client-rendered error shell. Operation pages expose deterministic deep links: `#authentication`, `#parameters`, `#parameters-<location>`, `#request-body`, `#request-body-<media>`, `#responses`, `#response-<status>`, and `#servers`. The full policy is ADR-010.

## Operation page

In order: breadcrumb, title (with a `Deprecated` badge when applicable), method and path with a copy control, description, deprecation callout, authentication (OR alternatives of AND-joined schemes, anonymous alternatives spelled out), parameters grouped by location with required/optional/deprecated stated in words, request body per media type with a schema summary and one level of properties, responses in deterministic order (numeric codes, `1XX`–`5XX` ranges, `default`) with headers and either media blocks or "No response body", and the servers the operation applies to.

Schema detail is deliberately restrained: a type phrase, a constraints line, and direct properties (capped at 200 rows). Nested structure is announced as not expanded; the SPEC-005 schema renderer replaces this summary. Contract examples are shown verbatim as pretty-printed JSON, truncated at 4,000 characters with a visible notice.

Contracts above 150 operations switch to a compact navigation: every group is listed, only the current group expands, and the reference index previews eight operations per group with a link to the full group page.

## Security posture

- `proxy.ts` sets a per-request `Content-Security-Policy` with a nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `script-src-attr 'none'`, `style-src 'self' 'nonce-…'`, `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`, `worker-src 'none'`, `manifest-src 'none'`, `media-src 'none'`, `form-action 'self'`, `base-uri 'self'`, `img-src 'self'`, `font-src 'self'`, `connect-src 'self'`, `upgrade-insecure-requests`. Development adds `'unsafe-eval'` for React's debugging tooling only. The proxy runs for every request (prefetch-shaped requests included), strips any inbound policy header, and overwrites the internal `x-specra-pathname` header so a client cannot spoof it. Fixed headers (`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`) come from `next.config.ts` and also cover static assets.
- Canonical strings are rendered as text. Paired backticks become inline `<code>`; no Markdown, HTML, or link is interpreted, so `<script>`, event handlers, and `javascript:` URLs display literally.
- Route segments must match the slug grammar before lookup; anything else is a 404.
- The theme handler accepts `POST` only, rejects cross-site submissions (`Sec-Fetch-Site`, then `Origin` against the host) with 403, follows only printable-ASCII absolute same-origin paths, and sets an `HttpOnly`, `SameSite=Lax` cookie that is `Secure` behind HTTPS (direct or via `X-Forwarded-Proto`).
- `SPECRA_SITE_URL` must be a bare origin; values with credentials, a path, a query, or a fragment are ignored.
- Fonts are self-hosted from `node_modules` (OFL variable fonts) and served under `font-src 'self'`.

## Deployment notes

The default deployment is the Node server (`next start`), which is required for the nonce policy. A static export cannot carry per-request nonces; hosts that need static output must keep the SPEC-000 header policy (with `'unsafe-inline'`) at the host level and accept the weaker script policy. Serve `/_next/static` with long-lived caching; documentation routes are cheap to render because the artifact is validated once per process. Documentation HTML carries no `Cache-Control` of its own because each response embeds a fresh nonce and the theme cookie; a CDN in front of the reader must either bypass caching for HTML or key on the `specra-mode` cookie and accept that cached pages share a nonce, which weakens the policy to the cache lifetime.

## Budgets

Measured on the TestInbox fixture (25 operations) and enforced in CI:

| Measure                                      | Baseline | Budget                        |
| -------------------------------------------- | -------- | ----------------------------- |
| Operation page client JavaScript (gzip)      | 135.6 KB | 150 KiB (`pnpm check:bundle`) |
| Route-specific chunks beyond the framework   | 5.0 KB   | 40 KiB                        |
| Operation page HTML                          | ~77 KB   | 200 KiB (browser test)        |
| Navigation with 600 operations (server HTML) | static   | no client nodes per item      |
| Navigation above 150 operations              | compact  | one expanded group per page   |

The framework bootstrap (React 19 and the Next runtime, about 130 KB gzip) dominates; the reader's own client code is the two islands.
