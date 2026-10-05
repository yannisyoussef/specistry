# SPEC-004 review record

Date: 2026-09-05

The Principal Engineer self-reviewed the minimal API reference against the §90
checklist before independent review. Independent reviews covered Product/DX,
frontend architecture, accessibility, security, performance, and QA, followed by a
design re-review against the approved Claude Design reference. Reviewers inspected
commits `dca7537` (artifacts and routes), `d6a8e54` (design system), `c362d90`
(tests), and `80f9c6d` (docs) on `feature/SPEC-004-minimal-api-reference`; the fixes
below landed in the follow-up review commit on the same branch.

## Principal Engineer self-review

| Question                                      | Answer and evidence                                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the reader using only canonical artifacts? | Yes. `apps/web/lib/reader/artifact.ts` reads `.specra/artifacts` and validates both files through `@specra/model`; no source, config execution, or ingestion runs in the reader.                                                 |
| Did parser types leak?                        | No. `apps/web` depends on `@specra/model` (and may depend on `@specra/config`) only; the architecture gate enforces the edge and no `openapi`/`yaml` import exists in the app.                                                   |
| Did we fake future features from the design?  | No. Search, version selector, Guides/SDKs/Changelog tabs, the code/Try-it rail, SDK example line, and the mobile action bar are omitted and recorded as deferred in `docs/design/reader-v1.md`.                                  |
| Is the approved design recognizable?          | Yes. Screenshots at 1440/1366/1024/390/320 in light and dark match the 05d/05e/06n/03f references: glass panels on the brand gradient, sidebar eyebrows with right-aligned methods, 34 px title, mono method+path, 160/1fr rows. |
| Does it work at 1366 px?                      | Yes. Sidebar 248 px and a 680 px reading column with no horizontal overflow (Playwright measurement).                                                                                                                            |
| Does it work at 320 px?                       | Yes. `tests/e2e/reader.spec.ts` asserts zero horizontal overflow on operation, reference, and long-path pages at 320 CSS px.                                                                                                     |
| Does keyboard navigation work?                | Yes. Skip link first, `main` focus, sidebar and copy control reachable, native `dialog` drawer with focus restore (`tests/e2e/reader.spec.ts`).                                                                                  |
| Are headings/landmarks semantic?              | Yes. `banner`, `navigation` (Primary, API reference, Breadcrumb), `complementary`, `main`, `contentinfo`; h1 → h2 sections → h3 groups; jest-axe and browser axe pass on every page type.                                        |
| Is there too much client JS?                  | No. 135.6 KB gzip of which 130.6 KB is the React/Next bootstrap; the reader's islands are 5.0 KB. `pnpm check:bundle` enforces 150 KiB.                                                                                          |
| Are hostile strings safe?                     | Yes. Every canonical string renders as text (paired backticks → `<code>` only); the edge fixture's `<script>`, `<img onerror>`, `javascript:` and RTL-override strings are asserted inert in jsdom and in the browser.           |
| Are URLs stable?                              | Yes. Slugs derive from `operationId` (or method+path), tags, and canonical order with deterministic collision suffixes (ADR-010); the projection is byte-identical across runs.                                                  |
| Is metadata unique?                           | Yes. Titles are `<page>`, a bar, `<project> API` per route; uniqueness is asserted across the fixture.                                                                                                                           |
| Does navigation scale?                        | Yes. The sidebar is static HTML rendered once (the drawer clones it); above 150 operations only the current group expands, and a 2,000-operation index projects in well under a second.                                          |
| Did we accidentally implement SPEC-005?       | No. Schema output is a type phrase, a constraints line, and one level of properties; nested structure is announced as not expanded.                                                                                              |
| Did we hard-code TestInbox?                   | No. No product name or branch exists in `apps/web`; the fixtures are data only.                                                                                                                                                  |

## Measured evidence

| Measure                                   | Value                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------ |
| Operation page HTML (create-inbox)        | ~77 KB                                                                   |
| Client JavaScript, operation page         | 135,562 B gzip (bootstrap 130,585 B; route chunks 4,977 B)               |
| Reader index projection, 2,000 operations | under 2 s asserted; typically tens of milliseconds                       |
| Navigation, 600 operations                | static HTML rendered once; compact groups, 20 items on an operation page |
| Unit/rendering/CLI tests                  | 263 (24 files) under coverage 86.06 / 81.02 / 95.47 / 87.70              |
| Browser tests                             | 23 (desktop and mobile projects) plus 14 visual baselines                |

## Severity summary

| Review        | P0  | P1  | P2  | P3  | Disposition                                            |
| ------------- | --- | --- | --- | --- | ------------------------------------------------------ |
| Product/DX    | 0   | 1   | 5   | 8   | P1 fixed; P2 fixed except two tracked; P3 mostly fixed |
| Frontend      | 0   | 2   | 4   | 10  | P1 fixed; P2 fixed; P3 fixed except two tracked        |
| Accessibility | 0   | 5   | 6   | 7   | P1 fixed; P2 fixed; P3 fixed except one tracked        |
| Security      | 0   | 0   | 2   | 7   | P2 fixed; P3 fixed except three tracked                |
| Performance   | 0   | 2   | 3   | 6   | P1 fixed; P2 fixed; P3 fixed except two tracked        |
| QA            | 1   | 3   | 6   | 8   | P0 fixed; P1 fixed; P2 and P3 fixed except tracked     |

No P0 remains open. Every P1 is fixed in code with a test. The QA P0 was a defect in the
visual test harness (the theme cookie was never applied, so every "dark" baseline was
light), not in the product; it was fixed before any baseline was accepted.

## Findings and dispositions

### Product / DX

| ID   | Severity | Finding                                                                                                                                 | Disposition                                                                                              |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| P1-1 | P1       | Navigation rendered twice (sidebar and closed drawer) doubled HTML                                                                      | Fixed: rendered once; the drawer clones `#api-navigation` on open (`mobile-nav.tsx`)                     |
| P2-1 | P2       | Groups ignore the contract's tag order and descriptions                                                                                 | Tracked: the canonical model records neither; additive model change owed (alphabetical order documented) |
| P2-2 | P2       | AND-joined schemes read as one run-on sentence                                                                                          | Fixed: bordered `.auth-schemes` rows with an explicit "and" joiner                                       |
| P2-3 | P2       | Example count shown but examples not rendered                                                                                           | Fixed: examples render as JSON figures, bounded at 4,000 characters with a truncation notice             |
| P2-4 | P2       | No "current version" distinction when only "Current" exists                                                                             | Fixed: the generic label is hidden (`isGenericVersion`)                                                  |
| P2-5 | P2       | Long paths cannot wrap on narrow viewports                                                                                              | Fixed: `PathText` inserts break opportunities after `/ ? & . =`                                          |
| P3   | P3 ×8    | Wording ("No auth" → sentence), counts, servers layout, drawer sizing, doc padding, `response:target`, index copy, breadcrumb separator | Fixed                                                                                                    |

### Frontend architecture

| ID   | Severity | Finding                                                                                                                                                                                                    | Disposition                                                                                               |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P1-1 | P1       | `notFound()` from a dynamic route rendered a client error shell                                                                                                                                            | Fixed: `proxy.ts` rewrites unknown `/api/*` to a server-rendered `/not-found` with status 404             |
| P1-2 | P1       | A missing artifact only failed at first request                                                                                                                                                            | Fixed: `scripts/check-reader-artifact.mjs` gates `build`; `instrumentation.ts` loads at startup           |
| P2-3 | P2       | Prefetch requests bypassed the proxy and its CSP                                                                                                                                                           | Fixed: no `missing` matcher exemption; asserted in the browser suite                                      |
| P2-4 | P2       | An untagged operation and a tag literally named "Operations" merged                                                                                                                                        | Fixed: groups are discriminated `{ name, untagged }`                                                      |
| P2-5 | P2       | Drawer duplicated React tree                                                                                                                                                                               | Fixed with Product P1-1                                                                                   |
| P3   | P3 ×10   | Case-folded ordering, `React.cache` for metadata/page resolution, canonical only with a site URL, `agentRules`, backdrop-filter prefix duplicates, cookie flags, `x-nonce` header removal, CSS conventions | Fixed except P3-9 (tag order, tracked with Product P2-1) and P3-6 (light/dark token duplication, tracked) |

### Accessibility

| ID   | Severity | Finding                                                                                                                                                                                       | Disposition                                                                                                 |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P1-1 | P1       | Focus ring was a box-shadow, invisible in forced-colors mode                                                                                                                                  | Fixed: 3 px solid `--brand-ink` outline with offset; asserted under `forcedColors: "active"`                |
| P1-2 | P1       | Faint text (eyebrows, flags, joiners, counts) below 4.5:1                                                                                                                                     | Fixed: small labels use muted text; light amber `#8a5a00`                                                   |
| P1-3 | P1       | Copy button renamed itself to "Copied", losing its accessible name                                                                                                                            | Fixed: stable `aria-label="Copy <method> <path>"`; a `role="status"` region announces success/failure       |
| P1-4 | P1       | Inactive primary tab below contrast on light glass                                                                                                                                            | Fixed: `--tab-inactive` token                                                                               |
| P1-5 | P1       | Drawer trigger did nothing without JavaScript                                                                                                                                                 | Fixed: the trigger is a link to `#api-sidebar-region`; `:target` reveals the sidebar                        |
| P2   | P2 ×6    | Deprecated state conveyed by strikethrough only, group-card heading level, forced-colors panel borders, overlay opacity, breadcrumb separator read aloud, theme buttons under 44 px on mobile | Fixed (visually-hidden "(deprecated)", h3 cards, `forced-colors` block, alt text `"/" / ""`, 44 px targets) |
| P3   | P3 ×7    | Drawer current item off-screen, tokens fallback order, reduced transparency, misc wording                                                                                                     | Fixed except P3-5 (screen-reader verbosity of long parameter tables), tracked for the SPEC-005 renderer     |

### Security

| ID   | Severity | Finding                                                      | Disposition                                                                        |
| ---- | -------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| P2-1 | P2       | Client could spoof `x-specra-pathname` / inbound CSP headers | Fixed: the proxy overwrites both on every request; asserted in the browser suite   |
| P2-2 | P2       | Duplicate navigation doubled the untrusted-string surface    | Fixed with Product P1-1                                                            |
| P3-1 | P3       | Theme return path accepted non-ASCII and control characters  | Fixed: printable ASCII only, 2 KiB bound; unit-tested                              |
| P3-2 | P3       | `/theme` accepted cross-site posts                           | Fixed: `Sec-Fetch-Site`, then `Origin` vs host → 403; cookie `Secure` behind HTTPS |
| P3-3 | P3       | `SPECRA_SITE_URL` accepted paths, queries, and credentials   | Fixed: bare origin only                                                            |
| P3-4 | P3       | `img-src data:` unnecessary                                  | Fixed: removed; `frame/worker/manifest/media-src 'none'` added                     |
| P3-5 | P3       | Percent-encoded route aliases                                | Tracked: rejected (404) today; redirect-to-canonical policy owed                   |
| P3-6 | P3       | Documentation HTML with a nonce cannot be shared-cached      | Tracked: documented in the reader reference and threat model                       |
| P3-7 | P3       | Slugged heading ids could collide                            | Tracked: deep-link-only effect                                                     |

### Performance

| ID    | Severity | Finding                                                                                                     | Disposition                                                                                                                        |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1-1a | P1       | Navigation HTML doubled per page                                                                            | Fixed with Product P1-1                                                                                                            |
| P1-1b | P1       | Navigation grows linearly with operations on every page                                                     | Fixed: compact groups above 150 operations (`COLLAPSE_NAVIGATION_ABOVE`)                                                           |
| P1-2  | P1       | The reference index listed every operation of a large contract                                              | Fixed: eight-operation preview per group with "View all"                                                                           |
| P2    | P2 ×3    | `backdrop-filter` on the document panel, property rows unbounded, sidebar re-render on navigation           | Fixed (`contain: paint`, no blur on the document, 200-row cap, scroll island only)                                                 |
| P3    | P3 ×6    | Bundle script ignored low-priority files, font preloads, memory guidance for large artifacts, Cache-Control | Fixed except font preloads (tracked, needs per-route measurement) and memory guidance (documented, tracked for a streaming loader) |

### QA

| ID   | Severity | Finding                                                                                                         | Disposition                                                                                                        |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P0-1 | P0       | Visual harness never applied the theme cookie (dark baselines were light)                                       | Fixed: `addCookies` with `url` only; baselines regenerated on `linux/amd64`                                        |
| P1-1 | P1       | No end-to-end XSS assertion in a real browser                                                                   | Fixed: the edge fixture is served on port 3101 and asserted for title, headings, servers, dialogs, and page errors |
| P1-2 | P1       | No multi-service coverage; service slug derived from the document id                                            | Fixed: slug from `info.title`; `tests/fixtures/reader/multi` with route, sidebar, metadata, and sitemap tests      |
| P1-3 | P1       | `chromium-mobile` never ran the reader                                                                          | Fixed: `reader-mobile.spec.ts` runs under the Pixel 5 profile                                                      |
| P2   | P2 ×6    | No-script coverage, theme endpoint negative tests, prefetch CSP, forced colors, blur assertion, `maxDiffPixels` | Fixed                                                                                                              |
| P3   | P3 ×8    | Theme helper unit tests, fixture drift guard for the new fixture, docs accuracy, baseline platform flag, misc   | Fixed except one (screenshot of the open drawer at 320 px, tracked)                                                |

## Design re-review

The design re-review compared the shipped reader with the approved Claude Design
reference (Reader with a contextual rail, Glass skin, files 05–07) after the review fixes.

| Aspect                                                    | Verdict  | Note                                                                                            |
| --------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| Glass panels, gradient page, 16 px radii                  | faithful | Header, sidebar, drawer blur; the document panel is opaque-on-glass for paint cost (documented) |
| Sidebar eyebrows and right-aligned methods                | faithful | Compact groups above 150 operations are an addition the reference did not need to cover         |
| Endpoint anatomy (title, mono method+path, 160/1fr rows)  | faithful | AND schemes gained a bordered row treatment; examples render as raised code figures             |
| Type scale and spacing                                    | faithful | Endpoint path 15 px; document padding 44/56 px                                                  |
| Colour                                                    | adapted  | Light amber darkened to `#8a5a00`, inactive tab and small labels raised to muted for 4.5:1      |
| Focus                                                     | adapted  | Outline instead of the reference's soft shadow ring, for forced-colors visibility               |
| Mobile drawer                                             | faithful | Native dialog; no-script fallback reveals the sidebar in place                                  |
| Context rail, SDK line, search, version, tabs, action bar | deferred | Unchanged from `docs/design/reader-v1.md`                                                       |

The reader remains recognizably the approved design; every adaptation is a contrast or
robustness change recorded in the design contract.

## Tracked and accepted

| Item                                                               | Owner / when                             |
| ------------------------------------------------------------------ | ---------------------------------------- |
| Tag declaration order and tag descriptions in the canonical model  | Additive model change before SPEC-006    |
| Schema names (`$ref` targets) in the model                         | SPEC-005                                 |
| Light/dark token duplication in `tokens.css`                       | SPEC-006 theming pass                    |
| Font preloads per route                                            | Measure with real consumer traffic       |
| Streaming or partitioned artifact loading for very large artifacts | When a consumer exceeds the model budget |
| Percent-encoded route aliases → redirect to canonical              | SPEC-007 (routing policy)                |
| Slugged heading-id collisions on deep links                        | SPEC-005 renderer                        |
| Documentation HTML caching behind a CDN                            | Deployment guide, documented now         |
| Screen-reader verbosity of long parameter tables                   | SPEC-005 renderer                        |
| Open-drawer screenshot at 320 px                                   | Next visual baseline refresh             |

## Principal Engineer decision

Approved for merge into `develop`. P0 = 0, every P1 fixed with a test, every P2 and P3
either fixed or recorded above with an owner. The reader renders only canonical artifacts,
keeps the approved Glass design, ships no faked future feature, and passes the full gate
set (format, lint, types, unit and rendering tests with coverage, browser suites on desktop
and mobile, Linux visual baselines, bundle budget, frozen install, audit). SPEC-005 has not
started.
