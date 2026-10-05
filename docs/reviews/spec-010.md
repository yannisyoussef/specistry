# SPEC-010 review record — Versioning, redirects, and changelog

Reviews were run on the `feature/SPEC-010-versioning-redirects-changelog`
branch against develop `a502cfa`. Each specialist pass lists findings by
severity (P0 security/correctness/release blocker, P1 major, P2 important,
P3 minor) with their disposition. Completion requires no open P0 and no
unresolved P1.

## Principal Engineer self-review

Questions from the slice definition, each answered against the code:

| Question                                            | Answer                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Can a release be overwritten?                       | No. `specra release` promotes with `rename` into a path that must not exist; an existing directory is compared by aggregate digest: identical bytes are a no-op (`unchanged: true`), different bytes fail `VERSION_ALREADY_EXISTS` before any write. No command edits or removes a release directory. `tests/cli/release.test.ts` proves both paths and the concurrent case. |
| Can a half-written release be served?               | No. Files are staged under `.specra/releases/.staging-<version>-<hex>`, fsynced, re-read and verified against the manifest, then renamed once; the catalog is written only after the rename. The reader lists nothing from staging names, and the leftover test proves a crashed stage is ignored.                                                                           |
| Can components from two releases mix?               | No. Every component is read from the release directory and its bytes verified against `release.json` before parsing; a component copied from another release fails `RELEASE_MANIFEST_INVALID` even though it parses. Parsed releases are cached by `${version}${digest}`; every href, search index, snippet, SDK example, asset name, and policy comes from that object.     |
| Is `current` ever inferred?                         | No. `catalog.json` carries an explicit `current`; a catalog whose current is missing from the store fails closed. Ordering is creation order; the first release becomes current, later ones only with `--current` or `specra current`. Nothing sorts by SemVer or file time.                                                                                                 |
| Do unknown versions fall back?                      | No. `resolveVersionRoute` serves an explicit version only when the catalog has it exactly (`V2`, `v2.`, `v3` are 404) and only routes in that release's route table; legacy unversioned routes redirect (307) only when the current release has the identity.                                                                                                                |
| Are aliases non-permanent and absent from sitemaps? | Yes: `/`, `/docs`, `/api`, and legacy routes answer 307; frozen author redirects answer 308 inside their release; `/sitemap.xml` is an index of `/sitemaps/<version>[-part].xml` built from the route tables' indexable entries, which never contain aliases (e2e and unit).                                                                                                 |
| Can a redirect leave the site?                      | No. `validateRedirects` accepts only `/`, `/docs/<slugs>`, `/api/<slugs>` (+ anchor on destinations) with the slug grammar, rejects schemes, hosts, `//`, `\`, `%`, query, control and bidi characters, duplicates, shadowing, missing destinations, and cycles, flattens chains, and freezes the table per release. The e2e hostile-path case checks the live `Location`.   |
| Is the changelog generated?                         | No. `changelog/<version>.json` is the author's plain text; `validateChangelog` requires every diff candidate to be dispositioned and publishes only `title`, `summary`, `from`, dated entries, and `reviewed.omitted` ids. The page renders text nodes only.                                                                                                                 |
| Are candidates isolated?                            | Yes. `.specra/candidates/diff.json` is written by `build`, never listed in any manifest, and `tests/security/versioning.test.ts` fails if any reader module mentions the directory or the changelog source directory; the fixture's released files are checked for candidate ids and the `diffFormat` marker.                                                                |
| Does the diff guess renames or score changes?       | No. An operation whose canonical id changed is `operation-removed` plus `operation-added`; `operation-changed` lists aspects only; schemas report digest changes; there is no severity, breaking flag, or percentage (SPEC-011).                                                                                                                                             |
| Is memory bounded?                                  | Yes. Catalog first (3.5 KB for 20 releases), metadata cache of 32, parsed release LRU of 4; touching 20 releases leaves 4 resident and 35 MB heap (`versioning-measurements.json`).                                                                                                                                                                                          |
| Does the playground cross versions?                 | No. The Try it island is rendered only on the current release's API routes; historical operation pages render the Code rail with a note and a link to the current counterpart; the CSP builder receives the current release's origins on its API routes and `[]` elsewhere, so historical pages carry `connect-src 'self'` (e2e asserts both headers).                       |
| Candidate mode unchanged?                           | Yes. Without a catalog the loader, routes, sitemap, and CSP behave as before; the TestInbox and edge suites (unit, e2e, visual) pass unchanged, and `SPECRA_SERVE=candidate` forces that mode for previews.                                                                                                                                                                  |
| No client JavaScript added?                         | Correct. The version menu and banner are server-rendered `details`/`summary` and `aside` markup; `pnpm check:bundle` reports the operation page at 137,778 B gzip and the docs page at 136,741 B, the SPEC-009 figures.                                                                                                                                                      |

Defects fixed during the self-review before specialists: the flattened API
navigation entry kept `/api` on versioned pages (scoped to the release's
API root); `parseRouteTable` could receive `undefined` when a release lacked
`routes.json` (explicit contract error); raw control and bidi characters in
regex and string literals were replaced with escapes (the linter and `file`
treated the sources as binary); the diff truncation test hit model limits
(the diff accepts a `maxCandidates` option); the changelog pointer escaped
`~` as `~0` inside identities (only `/` is escaped now); the performance
harness double-encoded the generated contract.

## Security reviewer

- **P1 (fixed):** Next.js normalizes `//evil.example` and `\evil.example`
  to `/evil.example` with its own 308 before the proxy runs. The result is
  internal, but the e2e assertion only allowed the reader's own locations;
  it now asserts the invariant that matters for every 3xx (single-slash
  internal path, no scheme, no `//`, no backslash, no raw line break) and a
  200 or 404 otherwise.
- **P1 (accepted with evidence):** a percent-encoded dot segment
  (`/docs/v2/%2e%2e/v1`) is normalized by Next to `/docs/v1` and served as
  v1 with the v1 canonical. That is truthful (no cross-version content):
  the resolution fuzz admits only an internal versioned redirect, a served
  route, or a 404 for such inputs, and the browser case accepts only 200,
  404, or a single-slash internal `Location`.
- **P2 (fixed):** the security walk originally allowed the word
  `candidates` in reader sources; it now also rejects `CANDIDATES_DIRECTORY`,
  `diff.json`, and `CHANGELOG_SOURCE_DIRECTORY`, and the released fixture
  files are scanned for candidate ids and the `diffFormat` marker.
- **P2 (accepted):** releases are verified by digest but not signed. An
  operator with write access to the store can rewrite a manifest, its
  components, and the catalog consistently. Recorded in the threat model;
  provenance signing belongs to the deployment slice (SPEC-012).
- **P3 (accepted):** the catalog lock is a `wx` file with a 60 s stale
  window; a process killed mid-update is recovered after that window.

## SEO reviewer

- **P1 (fixed):** the sitemap index and per-release sitemaps must never
  list `/`, `/docs`, `/api`, or legacy unversioned routes; the sitemap
  unit test asserts every partition lists versioned URLs only and no alias
  appears, and the e2e reads `/sitemap.xml` and every partition.
- **P2 (fixed):** the changelog page and the release home each carry a
  self-canonical `<link>`; the deprecated release keeps `index,follow`
  (historical pages are still the truth for their version) and the banner
  links to the current counterpart, so crawlers find both.
- **P2 (accepted):** old unversioned URLs stay indexed until crawlers
  follow the 307. A 308 would be wrong: the destination changes when
  current changes. Documented in the threat model residual risks.
- **P3 (accepted):** sitemaps partition at 45,000 URLs (under the 50,000
  limit) and carry no `lastmod`, because releases are immutable and the
  catalog `date` is an author label, not a modification time.

## OpenAPI / diff reviewer

- **P1 (fixed):** parameter identity is `location:name`, so moving a
  parameter from query to header reports `parameter-removed` plus
  `parameter-added` rather than a silent change; the golden covers it.
- **P2 (fixed):** schema identities use canonical ids, which are hashed for
  inline schemas; the goldens use the fixture's real ids and the test
  mutates the first schema's description instead of a guessed name.
- **P2 (accepted):** `operation-changed` reports `request-schema` and
  `response-schema` as digest changes without the property path. The
  candidate stays value-free by design; SPEC-011 may add finer aspects.
- **P3 (accepted):** examples are not diffed at all (they are values).

## Frontend architecture reviewer

- **P1 (fixed):** `createReaderContent` scoped pages and navigation but the
  API entry of a flattened navigation kept `/api`; every href now passes
  through `scopeHref` with the release roots exactly once at load time.
- **P2 (fixed):** the search palette received unscoped result routes; the
  trigger passes the roots and `scopeResultRoute` maps them, so a v1 search
  result never links into v2.
- **P2 (accepted):** `apps/web/app/sitemap.ts` (the Next metadata route)
  was replaced by explicit route handlers for the index and partitions;
  the metadata API cannot express an index.
- **P3 (accepted):** `ReaderArtifact.roots` is threaded through props
  rather than a context; the reader has no client context and the number
  of consumers is small.

## Product / DX reviewer

- **P1 (fixed):** `specra release` on a project with candidates but no
  changelog file failed with a generic error; it now reports
  `CHANGELOG_CANDIDATE_UNREVIEWED` at `source/changelog/<version>.json`
  with a message naming the candidates file and the file to write.
- **P2 (fixed):** human output of `release` prints the digest, component
  count, bytes, whether the release is current, and the candidate count and
  base; `current` and `deprecate` print the catalog table.
- **P2 (accepted):** there is no `specra releases` listing command;
  `specra current <version> --json` returns the catalog and the reader's
  version menu shows it. Tracked for SPEC-011's CLI surface.
- **P3 (accepted):** `--label` is limited to 40 printable characters and
  `--date` to `YYYY-MM-DD`; richer metadata waits for evidence.

## Accessibility reviewer

- **P1 (fixed):** the version menu's summary had no accessible name beyond
  the label; it now reads "Documentation version: 2.0, current. Change
  version" and the list is labelled "Documentation versions".
- **P2 (fixed):** the banner is an `aside` landmark with an `aria-label`
  rather than a live region, so it appears in the landmark list and never
  interrupts reading; the link text names the target.
- **P2 (fixed):** changelog kind labels are text (`ADDED`, `REMOVED`)
  with colour as a secondary cue; operation references are links with the
  method and path as text.
- **P3 (accepted):** the historical Try it note replaces the form rather
  than disabling it, so no disabled control is announced.
- Evidence: jsdom `jest-axe` on the menu (open and closed), banner,
  changelog, and historical operation page; Playwright axe with the menu
  open on desktop and Pixel 5; no-script switch test; the manual matrix
  rows are recorded in `docs/development/performance-accessibility.md`.

## Performance reviewer

- **P2 (fixed):** the reader memoized the catalog for the life of the
  process, so `specra current` needed a restart; the catalog is now keyed
  by the file's size and modification time (one `stat` per request) and
  re-read on change, and a removed catalog returns the reader to candidate
  mode; a rollback test proves it.
- **P2 (accepted):** assets are copied per release (content-addressed, a
  few KB) rather than deduplicated in a shared store; 20 releases of the
  200-operation project take 5.3 MB. A shared asset store is a SPEC-012
  storage decision.
- Evidence (`tests/performance/versioning-measurements.json`): catalog
  0.6 ms / 3.5 KB; first release 20 ms, cached 5 µs; 4 releases resident
  after touching 20; 35 MB heap; 10,000-operation diff in 22 ms with 4,000
  candidates and 1.05 MB output; 100,000-URL sitemap in 74 ms; bundle
  unchanged.

## QA reviewer

- **P1 (fixed):** the drift guard for the versioned fixture failed after
  `pnpm format` reformatted the fixture's config and contract (source
  digests changed); the store was regenerated from the formatted sources
  and the guard proves the committed bytes again.
- **P2 (fixed):** the mobile e2e located the primary navigation by role
  while the tabs are visually collapsed on phones; the assertion now uses
  the DOM link, which is what a phone user reaches through the drawer.
- Coverage: unit (release package 27, CLI 9, reader loader 14, rendering 9,
  drift 1, security 6 with 11 fuzz rows, config and argument surfaces),
  e2e 11 cases on desktop and mobile, performance 3, visual 3 (6 images),
  and the clean-room workflow (build → release v1 → change → build with
  candidates → refused without review → changelog → release v2 → idempotent
  re-release → current v2 → v1 bytes unchanged → reader resolves both).

## Design reviewer

Screens reviewed against the approved Glass design and the prior accepted
baselines (all 69 previous images byte-identical except four timing-text
drifts that were restored): the version menu is a compact header control
next to search, listing releases with label, state text, and a pill; the
deprecated banner sits above the article inside the content surface with
the accent rule; the changelog uses the two-column dated layout with kind
eyebrows and mono targets; the historical operation page keeps the full
Code rail with a one-line note. New images:
`versioning-menu-desktop-light`, `versioning-deprecated-desktop-dark`,
`versioning-changelog-desktop-light`,
`versioning-historical-operation-desktop-light`,
`versioning-deprecated-mobile-light`, `versioning-changelog-mobile-dark`.

- **P3 (accepted):** the release-history list under the changelog renders
  only when more than one release publishes notes, so the fixture does not
  show it; the component and its styles are covered in jsdom.

## Disposition

No open P0. All P1 findings fixed on the branch with tests. P2 items are
fixed or accepted with rationale above; P3 items are tracked in the
roadmap's non-goals and the SPEC-011/SPEC-012 lists.
