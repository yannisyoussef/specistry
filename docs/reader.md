# Reader reference

The reader (`apps/web`) renders a project's canonical artifacts as an indexable API reference together with the authored pages of SPEC-006. It consumes only what `specistry build` writes into `.specistry/artifacts`; it never reads OpenAPI or Markdown sources, never runs the ingestion or content pipelines, and never imports parser vocabulary (the architecture gate allows `apps/web` to depend on `@specistry/model`, `@specistry/config`, and the artifact readers of `@specistry/content` only).

## Pipeline

```text
specistry build
  → .specistry/artifacts/documentation.json + manifest.json
    (+ content.json, navigation.json, assets/ when the project has docs)
  → artifact loader (manifest + model + content validation, memoized per process)
  → reader projection (services → groups → operations, slugs, views)
  → reader content (pages by route, composed navigation, breadcrumbs, prev/next)
  → Next.js routes (React Server Components)
  → five client islands (mobile drawer, copy control, sidebar scroll position, tabs, search trigger)
  → one lazy chunk (search palette + engine + index) on first ⌘K
```

Every route renders on demand from the memoized artifact so the per-request nonce policy applies (ADR-010). A missing, malformed, incompatible, or inconsistent artifact fails `next build` and `next start` with a message that names the file, includes the first model diagnostics, and tells you to run `specistry build`; the reader never serves an empty site in its place. The artifact is loaded once per process (at startup through `instrumentation.ts`) and kept in memory; a very large artifact costs its parsed size in server heap, which is the documented trade for validation-once rendering.

## Configuration

| Variable                 | Purpose                                                                                                                  | Default                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `SPECISTRY_PROJECT_ROOT` | Absolute path of the project whose `.specistry/artifacts` the reader serves                                              | The working directory of the Next process               |
| `SPECISTRY_SITE_URL`     | Public origin used for the canonical `<link>`, `sitemap.xml`, and `robots.txt`; must be an absolute `http(s)` URL        | The artifact's `project.canonicalUrl`, otherwise none   |
| `SPECISTRY_SERVE`        | `candidate` serves `.specistry/artifacts` with the unversioned routes even when a release catalog exists (local preview) | Releases when a catalog exists, otherwise the candidate |

Without a site origin the sitemap is intentionally empty and canonical links stay relative rather than pointing at a guessed host. Set both variables when building and when starting the server:

```bash
SPECISTRY_PROJECT_ROOT=/srv/docs-project SPECISTRY_SITE_URL=https://docs.example.com pnpm --filter @specistry/web build
SPECISTRY_PROJECT_ROOT=/srv/docs-project SPECISTRY_SITE_URL=https://docs.example.com pnpm --filter @specistry/web start
```

The repository's own CI and browser suites point these at the committed TestInbox fixture (`tests/fixtures/reader/testinbox`).

## Routes

| Route                                       | Content                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/`                                         | The authored `docs/index.*` page when present; otherwise the generated project home |
| `/docs/<slug…>`                             | Authored pages (`docs/<path>.md` or `.mdx`); `/docs` redirects to `/`               |
| `/assets/<sha256:16>.<ext>`                 | Images and branding copied by the build; served only by manifest name               |
| `/search/index.<sha256:16>.json`            | The validated search artifact, immutable; any other name is a 404                   |
| `/api`                                      | API reference index: every group with its operations                                |
| `/api/<group>`                              | One tag group (single-service projects)                                             |
| `/api/<group>/<operation>`                  | Operation page                                                                      |
| `/api/<service>`, `/api/<service>/<group>…` | The same tree with a service segment when a project documents several services      |
| `/sitemap.xml`, `/robots.txt`               | Indexable routes and crawl policy (`/theme` is disallowed)                          |
| `/theme`                                    | `POST` only: stores the light/dark/system choice in a cookie and redirects back     |

Once the project has released versions (`.specistry/releases/catalog.json` exists, SPEC-010) the reader serves release mode instead: `/docs/{version}`, `/docs/{version}/<slug…>`, `/docs/{version}/changelog`, and `/api/{version}/…` are the self-canonical routes of each immutable release; `/`, `/docs`, `/api`, and the unversioned routes above become 307 aliases to the current release; frozen author redirects answer 308 inside their release; unknown versions and routes are real 404s; `/sitemap.xml` becomes an index of one sitemap per release under `/sitemaps/<version>[-part].xml`. Every link, search result, code sample, SDK example, asset, and playground policy on a versioned page belongs to that release, and only the current release executes requests. See the [versioning reference](versioning.md#routes).

Group slugs are slugified tag names; operation slugs are the contract `operationId` in kebab case or `<method>-<path>` without one; collisions gain `-2`, `-3` suffixes in canonical order. Service slugs come from the document's `info.title`. Groups follow the contract's declared tag order (the service's `tags`, SPEC-006); tags that operations use without declaring follow in case-folded alphabetical order, and the untagged `operations` group always comes last. A declared tag description is shown on the group page and the reference index. Unknown or malformed `/api/*` and `/docs/*` routes are rewritten by `proxy.ts` to a server-rendered 404 page with status 404, so crawlers and no-script clients receive real HTML rather than a client-rendered error shell. Operation pages expose deterministic deep links: `#authentication`, `#parameters`, `#parameters-<location>`, `#request-body`, `#request-body-<media>`, `#responses`, `#response-<status>`, and `#servers`. The full policy is ADR-010.

## Authored pages and navigation

An authored page renders breadcrumbs derived from its navigation trail (`Docs › section › title`), the frontmatter title as the only `<h1>`, the description as lede, an "On this page" outline of `##`/`###` headings (hidden on the homepage), the body, and previous/next links that follow the configured reading order with the API reference as one entry. The homepage uses the display type scale and no breadcrumbs. Every block of the content model has one explicit renderer: paragraphs, headings with anchor links, lists (task items announce "Done"/"To do"), blockquotes, tables inside a focusable horizontal scroller, images from the assets route, code blocks with a header, a copy control, build-time token classes and a focusable scroller, callouts (kind spelled out as text), steps as an ordered list whose titles continue the heading outline (or the homepage workflow strip), cards, tabs, and the homepage blocks: the hero (title and lede from frontmatter, ink and outline actions, an optional media placeholder whose play chrome is decorative), the Install chips with a command line and sample, and the Start-here rows.

The sidebar is one composed navigation: authored sections and pages in configured order with the generated API groups inserted at the `api` node (or after every page when nothing is configured), the current item marked with `aria-current`, external links marked with a cue and `rel="noopener noreferrer"`. The header shows `Guides` and `API reference` primary tabs when the project has docs; the mobile drawer clones the composed navigation. Branding replaces the wordmark mark with the configured logo, sets the favicon, and applies the accent through one nonce-bearing `<style>` that defines `--brand`. Tabs and code groups are progressive: the server renders every panel under a heading, and the client turns the headings into a WAI-ARIA tab list. The [content authoring reference](content-authoring.md) documents the source vocabulary; ADR-012 records the pipeline and route decisions.

## Search

The header shows a Search control (⌘K on macOS, Ctrl K elsewhere) whenever the artifact carries a search index, which every `specistry build` produces. The control is the only search code a page ships; the palette, the engine, and the index load on first open and stay cached for the session. The palette is a modal dialog with a combobox: results are grouped by source (API reference, Guides) in rank order, the active option is announced through `aria-activedescendant`, Enter opens the selected destination, Escape closes and returns focus, and a polite status announces the count once typing pauses. Every destination is a route the build validated; the query never becomes part of a URL. Queries run in the browser only; see the [search reference](search.md) for what is indexed, how ranking works, and the artifact contract.

## Operation page

In order: breadcrumb, title (with a `Deprecated` badge when applicable), method and path with a copy control, description, deprecation callout, authentication (OR alternatives of AND-joined schemes, anonymous alternatives spelled out), parameters grouped by location with required/optional/deprecated stated in words, request body per media type with a schema summary and one level of properties, responses in deterministic order (numeric codes, `1XX`–`5XX` ranges, `default`) with headers and either media blocks or "No response body", and the servers the operation applies to.

Contract examples are shown verbatim as pretty-printed JSON, truncated at 4,000 characters with a visible notice. Schemas are rendered by the schema renderer described below.

## Code rail

When the artifact carries `snippets.json` (every `specistry build` since SPEC-008 does), the operation page renders the endpoint context rail in Code mode: a `Code` heading, a `Protocol` or `Protocol · SDK` eyebrow, selectors for the environment, body format, and security alternative when there is more than one choice, one language control (a native select grouped into Protocol and SDK options), the selected example on the code surface with a `Copy <label> example` control, the contract's first success-response example when it has one, and a note that examples use placeholders and nothing is sent. The six protocol examples (cURL, HTTP, JavaScript, TypeScript, Java, Python) are generated on the server from the operation's request projection for the selected environment, body, and alternative; SDK examples are the project's authored code and appear only for operations the author mapped. When the build also approved playground environments (SPEC-009), the rail's bar becomes a `Code | Try it` control and the Try it island loads on first activation; see the [playground reference](playground.md). Without a policy there is no Try it control at all.

Layout follows the design contract: from 1280 px the rail is a third glass panel beside the document (340 px, 380 px from 1440 px, 480 px from 1600 px) and sticks under the header with its own scroll; below 1280 px it is an inline bordered section after the page header; below 768 px a bar with a single `Code` link follows the viewport bottom and jumps to that section. The language choice is remembered for the browser session in `sessionStorage`; environment, body, and alternative are URL query state (`?env=…&body=…&auth=…`) validated on the server, so a link shares the selection, the canonical URL stays the operation, and non-default selections are `noindex`. Without JavaScript the cURL example is visible, the other languages sit behind a native disclosure, and the selectors submit with an Apply control. The [code samples reference](code-samples.md) documents the generators, placeholders, escaping, and the SDK mapping contract.

## Schema rendering

The renderer (SPEC-005) explains canonical schema projections without becoming a JSON Schema engine. It runs on the server in two steps: `apps/web/lib/reader/schema-view.ts` projects a canonical `SchemaNode` into a bounded, context-aware `SchemaView` tree, and `apps/web/components/reader/schema/` lays that tree out as HTML with native `<details>` disclosures. No client JavaScript is involved.

### What each canonical kind reads as

| Canonical node                            | Reads as                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scalar`                                  | `string`, `string · email`, `integer`, `string · enum`, `string · constant`; constraints as `1–254 chars`, `0–10`, `default 3`, `always card`                            |
| `any`                                     | `any value` with the note "Free-form: no constraints are declared."                                                                                                      |
| `boolean-schema` `true` / `false`         | `any value` / `no value` with the note "Explicit `true`/`false` schema: …" so they never look like empty objects                                                         |
| `type-less`                               | `unspecified type` (`constant` or `enum` when only those keywords exist) with the note "No type is declared; the constraints apply to … values."                         |
| `unknown`                                 | `not represented` with the reason (unsupported vocabulary, invalid source, unresolved reference) and a pointer to the build diagnostics                                  |
| `object`                                  | property rows in canonical display order; `map of X` when it declares no properties and typed additional properties; "No additional properties are allowed." when closed |
| `array` / `tuple`                         | `array of User`, `tuple of 3 items` with slot rows and the remainder rule                                                                                                |
| `composition` `allOf` / `oneOf` / `anyOf` | "All of the following, combined:", "Exactly one of the following:", "One or more of the following (any combination):" with each part or variant as its own disclosure    |
| `composition` `not`                       | `not string` with a "must not match" row                                                                                                                                 |
| `ref`                                     | the definition's display `name` (ADR-011), then its `title`, then its shape                                                                                              |

`X or null` (an `anyOf`/`oneOf` of one schema and `null`) reads as `X or null` on the concrete schema rather than as a two-variant composition.

### References and recursion

Registry entries carry their definition name, so references read as `User`, `array of Address`, or `Payment`, never as an ID. A referenced structure is expanded inline within the budgets below and offers "Open User ↗", which renders that definition as the root of a focused view. When a reference points at a schema that is already open above it (direct, indirect, array, or composed recursion), the renderer shows `↻ User · recursive` with an "Open" link instead of expanding, so recursion never grows the DOM. The focused view of a recursion marker opens exactly one more level and marks the next repetition the same way.

### Composition and polymorphism

`allOf` is never flattened: each part is a disclosure (open by default) labelled by its name, so provenance, required sets, and annotations stay visible. `oneOf` and `anyOf` are disclosure lists (closed by default) with distinct wording; a discriminator renders as "Selected by `type`: `card` → CardPayment, …", each value linking to its variant, and every variant shows the values that select it. Compositions beyond twenty variants show the count and a link to the focused view.

### Request and response context

Every block knows whether it documents a request (request bodies, parameters) or a response (response bodies, headers), and the media-type header says so ("Request schema" / "Response schema"). In request context, read-only properties are omitted; in response context, write-only properties are omitted. The omission is always stated on the object: "Not sent in requests (read-only): id, createdAt" or "Not returned in responses (write-only): password". Properties that remain keep their `read-only`/`write-only` flag. The same referenced schema therefore renders differently in the two contexts, and nothing is cached across contexts.

### Expansion behaviour and budgets

The root of a block shows its own line and its first level open; nested structure sits behind native disclosures that are closed by default. Budgets (`DEFAULT_SCHEMA_BUDGET`) bound every block:

| Budget                | Value | When exceeded                                                                        |
| --------------------- | ----- | ------------------------------------------------------------------------------------ |
| Nesting depth         | 6     | "nested deeper than shown" with an "Open …" link to the focused view                 |
| View nodes per block  | 400   | "more than shown here" with an "Open …" link                                         |
| Properties shown open | 30    | the rest sits behind "Show N more properties"                                        |
| Properties per object | 200   | "N further properties not shown here" with "Open all N properties"                   |
| Variants              | 20    | "N further variants not shown here" with "Open all N variants"                       |
| Enum values previewed | 8     | the rest behind "Show N more values"; beyond 200, "N further values not listed here" |

Expansion identity is a structural locator from the block root (`p3.i.v1`: property 3, its items, variant 1), never object identity, so the same schema in two branches has two locators and every locator resolves deterministically in both contexts.

### Focused view

Links from recursion markers, budget cut-offs, and named references open `/api/<group>/<operation>?schema=<block>&at=<locator>`: the operation page renders that node as the root, with a trail (`Request body · application/json › content › HtmlContent`), the method and path, and a "Back to <operation>" link. Both query values are matched against strict grammars (`schema` is a block anchor, `at` is a locator of at most 40 steps) before any lookup; anything else redirects to the operation. Focused views carry `robots: noindex` and a canonical link to the operation, so they add no indexable URLs.

### Accessibility and no-script behaviour

Disclosures are native `<details>`/`<summary>` pairs, so Enter and Space toggle them, focus stays on the control, and the expanded state is announced by the platform; there is no ARIA tree. Summary labels are short ("3 properties", "items", "3 variants") with the property name appended visually hidden ("3 properties of content"), which keeps screen-reader output proportional to the structure rather than repeating "property, type, required" for every row. Required state, read/write state, deprecation, recursion, and budget cut-offs are words, not colour. Without JavaScript everything still works: disclosures open natively and the focused view is a plain link.

### Known projection limitations

- Definition names are display data and may repeat inside one registry (two files that both define `User`); the reader shows them as they are and relies on IDs for navigation.
- `allOf` parts are shown separately; the renderer does not compute the merged object or detect conflicting constraints.
- Discriminator mapping links resolve only to variants of the same composition; values mapped to schemas outside it show the name without a link.
- Schema-level `examples` are not rendered; media-type examples are (SPEC-004 policy).
- Deep links exist for variants (`#<block>--<locator>`) and focused views only; individual property rows are not addressable.

### Performance

Measured by `pnpm test:performance` (`tests/performance/schema-render.test.ts`, evidence in `schema-measurements.json`): a 20-property object renders as ~200 elements, a 200-property object as ~1,950 elements and 69 KB, a worst-case block at the node budget as ~5,100 elements and ~190 KB, and the edge fixture's largest response as ~3,000 elements and 114 KB; projection takes well under a millisecond in every case and rendering under 35 ms. The complex-page HTML budget is 512 KiB uncompressed (edge fixture), the TestInbox pages stay under 200 KiB, and the focused view of a 250-property object stays under 6,000 DOM elements. Client JavaScript is unchanged by the renderer.

Contracts above 150 operations switch to a compact navigation: every group is listed, only the current group expands, and the reference index previews eight operations per group with a link to the full group page.

## Security posture

- `proxy.ts` sets a per-request `Content-Security-Policy` with a nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`, `script-src-attr 'none'`, `style-src 'self' 'nonce-…'`, `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`, `worker-src 'none'`, `manifest-src 'none'`, `media-src 'none'`, `form-action 'self'`, `base-uri 'self'`, `img-src 'self'`, `font-src 'self'`, and least-privilege `connect-src`. Development adds `'unsafe-eval'` for React's debugging tooling only. TLS and HSTS belong at the production reverse proxy; the application deliberately omits `upgrade-insecure-requests` because Safari applies it to same-origin loopback assets and breaks the supported local HTTP workflow. The proxy runs for every request (prefetch-shaped requests included), strips any inbound policy header, and overwrites the internal `x-specistry-pathname` header so a client cannot spoof it. Fixed headers (`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `X-Content-Type-Options`) come from `next.config.ts` and also cover static assets.
- Canonical strings are rendered as text. Paired backticks become inline `<code>`; no Markdown, HTML, or link is interpreted, so `<script>`, event handlers, and `javascript:` URLs display literally.
- Search results are plain text from the validated artifact: matches are highlighted by splitting the title into text segments, never by building HTML or regular expressions from the query; the query is bounded to 200 characters and 12 terms; destinations come from the artifact, never from the query. The reader serves the artifact only after checking its digest, size, and document count against the manifest, and only under its content-addressed name.
- Authored content arrives as a validated JSON content model, never as HTML or code: the renderer maps each node kind to a React element, spreads no authored attribute, and link targets and asset names were validated at build time. Assets are served only when the manifest lists them, from the fixed artifact directory, with `Cache-Control: immutable`, `nosniff`, and `default-src 'none'; sandbox`, so an SVG logo opened directly cannot run scripts. The consumer accent is a validated six-digit colour emitted in a nonce `<style>`; the proxy leaves the asset route's own policy in place and applies the page policy everywhere else.
- Route segments must match the slug grammar before lookup; anything else is a 404.
- Versions (SPEC-010) are resolved from the catalog exactly as written (no case folding, no fallback to current); each release's components are verified against its manifest digests before parsing, so a component copied from another release is refused; redirects come from the release's validated table and are always single-slash internal paths; historical API pages keep `connect-src 'self'` and only the current release's approved origins reach the policy; the private `.specistry/candidates` directory and changelog sources are never read by the reader.
- Code examples are generated on the server from the digest-checked snippets artifact and rendered as text tokens; the `env`, `body`, and `auth` query values are matched against strict grammars and never echoed, and the only environments offered are those the build validated. No request is made from the Code rail. The playground (SPEC-009) adds `connect-src` entries for the exact approved origins on API routes only, taken from the digest-checked `playground.json`; every other page keeps `connect-src 'self'`. Requests leave the browser directly with `credentials: "omit"`, `redirect: "error"`, and the destination assertion described in the [playground reference](playground.md); the server has no route that relays them and never imports the client executor or the credential vault.
- The theme handler accepts `POST` only, rejects cross-site submissions (`Sec-Fetch-Site`, then `Origin` against the host) with 403, follows only printable-ASCII absolute same-origin paths, and sets an `HttpOnly`, `SameSite=Lax` cookie that is `Secure` behind HTTPS (direct or via `X-Forwarded-Proto`).
- `SPECISTRY_SITE_URL` must be a bare origin; values with credentials, a path, a query, or a fragment are ignored.
- Fonts are self-hosted from `node_modules` (OFL variable fonts) and served under `font-src 'self'`.

## Deployment notes

The default deployment is the Node server (`next start`), which is required for the nonce policy. A static export cannot carry per-request nonces; hosts that need static output must keep the SPEC-000 header policy (with `'unsafe-inline'`) at the host level and accept the weaker script policy. Serve `/_next/static` with long-lived caching; documentation routes are cheap to render because the artifact is validated once per process. Documentation HTML carries no `Cache-Control` of its own because each response embeds a fresh nonce and the theme cookie; a CDN in front of the reader must either bypass caching for HTML or key on the `specistry-mode` cookie and accept that cached pages share a nonce, which weakens the policy to the cache lifetime.

## Budgets

Measured on the TestInbox fixture (25 operations) and enforced in CI:

| Measure                                      | Baseline        | Budget                           |
| -------------------------------------------- | --------------- | -------------------------------- |
| Operation page client JavaScript (gzip)      | 137.1 KB        | 150 KiB (`pnpm check:bundle`)    |
| Route-specific chunks beyond the framework   | 6.5 KB          | 40 KiB                           |
| Operation page HTML                          | ~180 KB         | 200 KiB (browser test)           |
| Generator code in client chunks              | none            | forbidden (`pnpm check:bundle`)  |
| Navigation with 600 operations (server HTML) | static          | no client nodes per item         |
| Navigation above 150 operations              | compact         | one expanded group per page      |
| Schema block, 200 properties (server HTML)   | ~69 KB          | 400 view nodes per block         |
| Complex operation page HTML (edge fixture)   | ~456 KB         | 512 KiB (browser test)           |
| Authored page client JavaScript (gzip)       | 136.1 KB        | 150 KiB (`pnpm check:bundle`)    |
| Authored route chunks (tabs island)          | 5.5 KB          | 40 KiB                           |
| Authored guide HTML (quickstart)             | ~60 KB          | 200 KiB (browser test)           |
| 1,000-page site build / peak RSS             | ~6 s / ~690 MiB | 120 s / 2 GiB (performance test) |
| 1,000-page site largest page HTML            | ~13 KB          | 200 KiB                          |
| Search trigger on every page (gzip)          | ~0.6 KB         | inside the page budget           |
| Search chunk, lazy (engine + palette, gzip)  | 9.8 KB          | 40 KiB (`pnpm check:bundle`)     |
| Search artifact, TestInbox (gzip)            | 12 KB           | 64 KiB (performance test)        |
| Search artifact, 1,000 pages + 10,000 ops    | ~1.0 MB gzip    | 8 MiB gzip (performance test)    |

The framework bootstrap (React 19 and the Next runtime, about 130 KB gzip) dominates; the reader's own client code is the two islands.
