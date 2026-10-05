# SPEC-006 review record

Date: 2026-09-05

The Principal Engineer self-reviewed authored content and navigation against the §137
checklist, then ran the eight review passes the slice requires (Content / Markdown /
MDX, Product / DX, Frontend architecture, Security, Accessibility, Performance, QA,
SEO) as read-only inspections of `feature/SPEC-006-authored-content-navigation`,
followed by the design review against the approved Glass reference. Reviewers
inspected commits `622c1e1` (declared tags), `7e17d44` (content compiler), `6498bc1`
(build and reader routes), and the hardening commit; every disposition below was
applied on the branch before the final gates.

## Principal Engineer self-review

| Question                                       | Answer and evidence                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can authored docs execute JavaScript?          | No. Sources are parsed to an mdast tree without a JavaScript parser (expressions cannot even be tokenized), ESM and expressions are diagnostics, the artifact is JSON, and the reader has no `dangerouslySetInnerHTML`. `compile.test.ts`, `content.test.ts`, browser suite. |
| Can raw HTML execute?                          | No. `html` nodes and lowercase JSX tags are `CONTENT_HTML_FORBIDDEN`; entities decode to text and render as text. Troubleshooting fixture asserts `<script>` literal, zero `script`/`img`/`b` elements.                                                                      |
| Can unsafe links escape validation?            | No. `resolveLink` accepts relative, `/docs`, `/api`, `#anchor`, `https`, `http`, `mailto` only; targets are checked against pages and API routes; `Card href` goes through the same function.                                                                                |
| Can assets escape the project root?            | No. Docs-root confinement through `resolveExistingProjectPath` (realpath) for sources and assets; `..`/absolute paths rejected lexically first; symlink escapes tested for a source and an asset.                                                                            |
| Are artifacts deterministic?                   | Yes. Two builds from differently named temporary parents are byte-identical and contain neither path; sources and assets are sorted; no timestamps.                                                                                                                          |
| Did parser types leak?                         | No. `@specra/content` exports only its own model, diagnostics, and helpers; `apps/web` imports types and artifact parsers, never mdast or Shiki. Architecture gate passes.                                                                                                   |
| Did React leak into content core?              | No. `packages/content` depends on `@specra/model`, mdast utilities, yaml, and Shiki only.                                                                                                                                                                                    |
| Does navigation scale?                         | Measured: 1,001 entries render to 123 KB of sidebar HTML in ~32 ms with no client state; API groups still collapse above 150 operations. Per-page tree pruning is a tracked P3.                                                                                              |
| Are authored + API routes coherent?            | Yes. Authored routes live under `/docs` or at `/`; `/api` is untouched; `/docs` redirects; unknown routes in both trees are proxy-rewritten 404s.                                                                                                                            |
| Are breadcrumbs and prev/next from one source? | Yes. Both derive from `flattenNavigation` (with the homepage prepended when unlisted); the sitemap uses the same order.                                                                                                                                                      |
| Is the page H1 unique?                         | Yes. Body `#` headings are errors; the title is the only `<h1>`; step and static tab headings continue the outline (axe `heading-order` passes on every fixture page).                                                                                                       |
| Are duplicate heading IDs safe?                | Yes. `-2`, `-3` suffixes in document order; reader landmark ids are reserved.                                                                                                                                                                                                |
| Does no-JS work?                               | Yes. Every tab panel renders under a heading; navigation, outline, pager, and copy-free code work as plain HTML (desktop and mobile no-script cases).                                                                                                                        |
| Is Tabs keyboard behaviour complete?           | Yes. Arrow Left/Right/Up/Down, Home, End, roving tabindex, `aria-selected`, `aria-controls`, focus follows selection; browser test.                                                                                                                                          |
| Does branding preserve contrast?               | Yes. Only `--brand` is consumer-set; text colours derive through `color-mix` with black (light) or white (dark) at fixed ratios, so ink contrast does not depend on the accent. Verified with the fixture accent in both modes.                                              |
| Did bundle size grow unnecessarily?            | No. Authored page 136,120 B gzip versus 135,586 B for an operation page: the tabs island is ~0.5 KB; the highlighter never ships.                                                                                                                                            |
| Did we implement SPEC-007/008/009/010/011?     | No. No search index, snippets, playground, versions, or quality gates; `documentation.json` only lists page identities for later indexing.                                                                                                                                   |
| Is the Glass design still recognizable?        | Yes. Authored pages reuse the document column, panels, type scale, and code surface; 35 Linux baselines regenerated with the composed sidebar and reviewed.                                                                                                                  |

## Measured evidence

| Measure                                   | Value                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Client JavaScript, authored page          | 136,120 B gzip (operation page 135,586 B); route chunks 5,535 B                           |
| Quickstart guide HTML                     | ~60 KB (budget 200 KiB)                                                                   |
| 1,000-page build (fresh process)          | ~6 s wall, ~690 MiB peak RSS, `content.json` 38.6 MiB, zero diagnostics                   |
| Largest synthetic page / composed sidebar | 13.5 KB in ~10 ms / 123 KB in ~32 ms                                                      |
| Unit, rendering, CLI, clean-room tests    | 397 in 30 files; coverage 84.5 / 78.9 / 93.1 / 86.2 (statements/branches/functions/lines) |
| Browser tests                             | 40 (desktop 33 including 8 authored cases, mobile 7 including 1)                          |
| Visual baselines                          | 35 (12 new `docs-*` states), Linux amd64                                                  |
| Performance tests                         | 1 new (1,000 pages) plus the existing ingestion and schema cases                          |
| Clean-room packed CLI                     | validates and builds an authored project offline (two pages, one image, navigation)       |

## Severity summary

| Review                   | P0  | P1  | P2  | P3  | Disposition                                      |
| ------------------------ | --- | --- | --- | --- | ------------------------------------------------ |
| Content / Markdown / MDX | 0   | 1   | 2   | 2   | P1 fixed; P2 fixed; P3 one fixed, one tracked    |
| Product / DX             | 0   | 2   | 3   | 2   | P1 fixed; P2 fixed; P3 tracked                   |
| Frontend                 | 0   | 1   | 2   | 2   | P1 fixed; P2 fixed; P3 one fixed, one tracked    |
| Security                 | 0   | 1   | 3   | 2   | P1 fixed; P2 fixed; P3 one accepted, one tracked |
| Accessibility            | 0   | 2   | 3   | 2   | P1 fixed; P2 fixed; P3 tracked                   |
| Performance              | 0   | 0   | 3   | 2   | P2 fixed; P3 tracked                             |
| QA                       | 0   | 2   | 2   | 1   | P1 fixed; P2 fixed; P3 fixed                     |
| SEO                      | 0   | 1   | 1   | 1   | P1 fixed; P2 fixed; P3 tracked                   |

P0 open: 0. P1 unresolved: 0.

## Findings and dispositions

### Content / Markdown / MDX

- **P1 — Inline HTML-like tags were reported as unknown components.** `<em onmouseover>` in a sentence produced `CONTENT_COMPONENT_UNKNOWN`, which misleads authors into thinking a component exists. Fixed: lowercase names (inline or block) are `CONTENT_HTML_FORBIDDEN`; capitalised unknown names stay `CONTENT_COMPONENT_UNKNOWN`. Compiler and CLI tests updated.
- **P2 — Link and asset diagnostics were invisible on pages with parse errors.** Pages that fail structurally are excluded from the link pass, so a migration saw only the first class of errors. Disposition: documented as deliberate (links resolve against the final page set) and the edge fixture gained a separate `links.md` so every asset and link code is exercised and asserted.
- **P2 — Fixture pages were being reformatted by Prettier**, which mangled code groups and shifted the line/column numbers the tests assert. Fixed: `.prettierignore` and markdownlint exclude fixture docs; the committed fixture artifacts are byte-compared against a fresh build.
- **P3 — `title="…"` is the only fence attribute.** Line highlighting and `showLineNumbers` are common requests. Tracked for a later content pass (owner: content; condition: author demand), the grammar rejects anything else today so adding attributes is additive.
- **P3 — Reference-style links are unsupported.** Fixed in documentation (stated explicitly with the diagnostic).

### Product / DX

- **P1 — The homepage was missing from the reading order** when the navigation did not list it, so "Introduction" had no "Previous" and the homepage no "Next". Fixed: the homepage opens the flattened order when unlisted; sitemap deduplicated.
- **P2 — No guide answered "where do my docs go / how do I validate".** Fixed: `docs/content-authoring.md` opens with files and routes, frontmatter, and ends with diagnostics; README links it.
- **P2 — The API reference block in a composed sidebar had no title.** Fixed: the `api` node renders its configured label (default "API reference") as a linked eyebrow above the groups, separated by a hairline.
- **P2 — Navigation diagnostics pointed at the config without a page name.** Disposition: the path `config#/navigation/0/items/0` is the stable contract (values never appear in diagnostics); the human report gains nothing safe to add. Accepted.
- **P3 — `sidebarTitle` is not used in breadcrumbs.** Tracked (owner: Product/DX; condition: author feedback); breadcrumbs use the full title deliberately.
- **P3 — `/docs` redirects rather than listing pages.** Tracked; a docs index page is an authoring choice (`docs/index.*`).

### Frontend architecture

- **P1 — Hidden tab panels stayed visible.** `.tabs-block__panel { display: flex }` overrode the `hidden` attribute, so every panel rendered after hydration and `getByRole("tabpanel")` matched three elements. Fixed with `[hidden] { display: none }`; browser and jsdom tests assert one panel.
- **P2 — `useEffect` + `setState` for hydration detection** triggered a cascading render and the `react-hooks/set-state-in-effect` rule. Fixed with `useSyncExternalStore` (server snapshot `false`, client `true`).
- **P2 — Heading levels inside components were fixed (`h3`/`h4`).** Fixed: `ContentBlocks` tracks the nearest heading depth and passes it to steps and static tab headings.
- **P3 — `generateMetadata` and the page both resolve the route.** Accepted: the artifact is memoized per process and lookup is a map read.
- **P3 — The sidebar re-renders every authored link on every route.** Tracked with the performance P3 below.

### Security

- **P1 — The asset route's own `Content-Security-Policy` was overwritten by the proxy**, so an SVG logo opened directly received the page policy (nonce script-src) instead of `default-src 'none'; sandbox`. Fixed: the proxy leaves `/assets/*` responses to the route handler, which now sets the sandbox policy for every asset type; browser test asserts the header.
- **P2 — SVG acceptance was regex-based.** Reviewed: the check covers `<script`, `on*=` handlers, `javascript:`, `<foreignObject`, and external `<use href>` over the whole file (not only the head), the logo is only ever an `<img>` source, and the asset route sandboxes direct opens. Accepted with the residual noted; rasterizing SVG stays a future option.
- **P2 — A symlinked source or asset escaping the docs directory was untested.** Fixed: CLI tests prove `CONTENT_SOURCE_OUTSIDE_ROOT` and `CONTENT_ASSET_OUTSIDE_ROOT`; symlinked directories are ignored (documented).
- **P2 — Example key in the authentication fixture tripped the secret scanner.** Fixed: shortened; the scanner stays strict.
- **P3 — Shiki grammars run on author text without a timeout.** Accepted: the input is bounded (20,000 characters per block, 200 KB highlighted per page), runs in the author's own build, and Shiki's JavaScript engine has no known catastrophic patterns for the bundled grammars; tracked as a residual risk in the threat model.
- **P3 — `mailto:` links accept any address text.** Accepted: the href is validated as a URL and rendered as text; no auto-linking of raw emails occurs outside the GFM literal autolink, which is also validated.

### Accessibility

- **P1 — Scrollable code blocks were not keyboard reachable** (axe `scrollable-region-focusable`, serious, on every guide). Fixed: `<pre>` and the table scroller are focusable groups with a visible ring and an accessible name.
- **P1 — Heading order was broken on guides** whose first content is `<Steps>` (`h1` → `h3`). Fixed by outline-aware heading levels (above).
- **P2 — Each callout was an `<aside>`**, creating many `complementary` landmarks inside `main`. Fixed: callouts are `role="note"` with a label of kind and title.
- **P2 — Named regions for every code block collided** (`landmark-unique`). Fixed: `role="group"` instead of `region`.
- **P2 — Tabs were 36 px tall on mobile.** Fixed: 44 px minimum below 768 px; mobile test asserts the box.
- **P3 — Manual AT verification for tabs, callouts, and the drawer with sections** is due before stable `1.0.0`; the matrix rows in `performance-accessibility.md` record the expectation. The owner accepts the SPEC-005 and SPEC-006 qualification carry-overs for pre-1.0 RCs under P2 A11Y-R01.
- **P3 — Comment token contrast** in dark mode was raised from `#6c6c73` to `#9a9aa1` on the code surface (light mode uses `#6c6c73` on white); recorded with the token consolidation.

### Performance

- **P2 — Unmatched emphasis delimiters parsed quadratically.** Ten thousand asterisks on one page took ~5 s (longer under coverage instrumentation, which made the unit test's wall-clock assertion flake in CI), so a hostile or accidental page could stall the author's build. Fixed: a linear pre-parse budget of 8,000 `*`/`_` characters per page rejects the page with `CONTENT_BUDGET_EXCEEDED`; the unit test asserts the rejection is fast and that a 3,000-delimiter page still compiles.
- **P2 — Navigation HTML at scale was unmeasured.** Fixed: the 1,000-page performance case renders the composed shell (123 KB, ~32 ms) and asserts the 200 KiB ceiling and a single current sidebar item.
- **P2 — The bundle gate only measured the operation route.** Fixed: `check:bundle` measures `/docs/[[...slug]]` too under the same budgets.
- **P3 — `content.json` is loaded whole into server memory** (38.6 MiB for 1,000 dense pages). Tracked (owner: reader; condition: sites above ~500 pages or memory pressure reports): partition per route or lazy-load bodies. Recorded in ADR-012.
- **P3 — The sidebar lists every authored page.** Tracked with the same condition: prune sections that do not contain the current page above a threshold, mirroring the API-group collapse.

### QA

- **P1 — The clean-room test built an API-only project**, so the packed CLI was never proven to compile docs offline. Fixed: the clean-room project has two authored pages, an image, and a navigation; the test asserts the artifact list, page routes, and the bundled parser/highlighter closure.
- **P1 — The fixture drift guard did not cover `content.json`/`navigation.json`.** Disposition: the guard compares `documentation.json` and `manifest.json`, and the manifest carries the content file names, page count, asset hashes, and source hashes, so drift in content sources or assets fails the guard; `content.json` bytes are additionally covered by the determinism test. Accepted.
- **P2 — The edge fixture asserted only codes.** Fixed: exact `severity code path:line:column` list plus a fixed-message check that no authored fragment leaks.
- **P2 — Stale artifact removal on a content failure was untested.** Fixed: build, break a page, build (fails, directory gone), repair, build (five files back).
- **P3 — The trailing-slash 404 case was a false positive** (Next normalizes `/docs/quickstart/` with a redirect). Fixed by removing it from the 404 list.

### SEO

- **P1 — The sitemap listed `/` twice** once the homepage joined the reading order. Fixed and asserted (41 entries for the fixture).
- **P2 — Authored descriptions fell back to nothing** when frontmatter had none. Fixed: the first sentence of the page text, then the title.
- **P3 — No Open Graph tags.** Tracked (owner: SEO/frontend; condition: social previews requested); titles, descriptions, and canonicals are complete.

## Design review

**Second pass (post-PR review by the product owner).** The first pass over-reported the homepage row as done: the authored home was a generic page (cards, vertical steps, a code group) rather than the approved composition of screens 6a/8c, and the primary tab read "Docs" instead of "Guides". Disposition: P1, fixed on the branch. The content model gained `Hero` (title and lede from frontmatter, up to three actions, optional media), `Media` (poster asset, decorative chrome, caption with a written alternative), `Install` (chips over a command line and a sample), `StartHere` rows, and `Steps variant="strip"`; the reader renders the widened home column, the 8c two-column hero, the Install/Start-here row, and the workflow strip; the tab and breadcrumb root read "Guides"; the fixture homepage, unit, browser, and visual coverage were rebuilt against the screens. The endpoint context rail (screen 5e: Code / Try it) stays deferred because its content is SPEC-008 (snippets, SDK mapping) and SPEC-009 (playground); the deviations table records this explicitly, and the rail is expected to land with SPEC-008's Code mode.

The authored page, guide, tabs, cards, table, image, drawer, and 404 states were reviewed against the Glass reference: the document column, panel surfaces, type scale, code surface, eyebrows, and method chips are unchanged; authored components use the same tokens and radii. New rules (frame, rhythm, components, composed sidebar, branding) are recorded in `docs/design/reader-v1.md` under "Authored pages", and the deviations table marks logo/brand colour and the homepage hero as done.

## Tracked follow-ups

| Item                                                                       | Severity | Owner          | Condition                                        |
| -------------------------------------------------------------------------- | -------- | -------------- | ------------------------------------------------ |
| Fence attributes for line highlighting / numbers                           | P3       | Content        | Author demand                                    |
| `sidebarTitle` in breadcrumbs                                              | P3       | Product / DX   | Author feedback                                  |
| Partition or lazy-load `content.json` bodies                               | P3       | Reader         | Sites above ~500 pages or memory reports         |
| Prune the composed sidebar per page above a threshold                      | P3       | Reader         | Same as above                                    |
| Manual AT pass (tabs, callouts, drawer with sections; SPEC-005 carry-over) | P3       | Accessibility  | Before stable `1.0.0`; A11Y-R01 accepted for RCs |
| Open Graph metadata                                                        | P3       | SEO / frontend | Social previews requested                        |
| Highlighter time bound                                                     | P3       | Security       | If a grammar regression is reported              |
