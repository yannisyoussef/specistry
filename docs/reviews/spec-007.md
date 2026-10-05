# SPEC-007 review record

Date: 2026-09-06

The Principal Engineer self-reviewed search against the §148 checklist, then ran
the nine review passes the slice requires (Search / Information Retrieval,
Product / DX, Frontend architecture, Accessibility, Security, Performance, QA,
Architecture, and the final design re-review) as read-only inspections of
`feature/SPEC-007-search`. Every disposition below was applied on the branch
before the final gates; the golden corpus, the browser suites, and the
performance suite were rerun after each fix.

## Principal Engineer self-review

| Question                                            | Answer and evidence                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is search actually build-time?                      | Yes. `specra build` projects and indexes from the exact `documentation.json`, `content.json`, and `navigation.json` it is about to write; the browser only hydrates the serialized index. `packages/cli/src/search.ts`, `tests/cli/content.test.ts`.                     |
| Does the browser load `content.json` unnecessarily? | No. The palette fetches `/search/index.<digest>.json` only (52 KB for TestInbox, 1.0 MB gzip at 17,000 documents); `content.json` stays server-side. Browser test asserts a single index fetch and no fetch before first open.                                           |
| Did parser types leak?                              | No. `@specra/search` depends on `@specra/model`, `@specra/content` (types, navigation flattening, route identity), and MiniSearch; the architecture gate passes with the new edges and forbids anything else.                                                            |
| Is search self-hosted?                              | Yes. No account, service, network call, or configuration; the clean-room test installs the packed CLI offline, builds a project, and asserts `search.json` and the bundled engine.                                                                                       |
| Do queries leave the browser?                       | No. The only network request is the same-origin artifact fetch; no telemetry, recents, or analytics exist. Documented in `docs/search.md` and ADR-013.                                                                                                                   |
| Are ranking results useful?                         | Yes, guarded. 37 golden queries in `tests/search/relevance.json` (exact endpoints, method+path, prefixes, typos, sections, identifiers, guides) pass against the committed artifact; ambiguous queries assert prefixes or top-N sets rather than brittle orders.         |
| Does exact API search work?                         | Yes. `create inbox`, `POST /inboxes`, `POST /v1/inboxes` (a version prefix the contract lacks), `GET /inboxes/{inboxId}`, and `createInbox` all rank the endpoint first; method boost 8 makes the method decisive.                                                       |
| Are Unicode/API tokens handled?                     | Yes. NFKC + lower case + mark stripping for matching only; camel/snake/kebab/path splitting with joined forms; non-Latin scripts preserved; `création`/`creation` and full-width text tested.                                                                            |
| Can a malicious query freeze the UI?                | No. 200 characters, 12 unique terms, results 12; fuzzy only as a fallback and only for terms ≥ 4 characters with ≤ 2 edits; 300 seeded fuzz rounds and hostile patterns finish under 200 ms each.                                                                        |
| Can malicious indexed text execute?                 | No. Results are text segments (`<mark>` around matched words split by a fixed word regex, never a query-built one); the troubleshooting page's `<script>` renders literally in jsdom and Chromium; routes come from the artifact and are validated by the strict parser. |
| Is initial page JS still within budget?             | Yes. Authored page 136,753 B gzip (was 136,150 B): the trigger adds ~0.6 KB; the 150 KiB budget holds and the gate now fails if the search chunk is ever referenced by a page route.                                                                                     |
| Is search lazy-loaded?                              | Yes. `React.lazy` import on first open; 9,780 B gzip chunk (engine + palette) measured and budgeted at 40 KiB.                                                                                                                                                           |
| Is index size reasonable?                           | Yes. TestInbox 12 KB gzip; 1,000 pages 0.47 MB; 10,000 operations 0.53 MB; combined 1.01 MB, hydrated in ~66 ms. Ceilings in the performance suite.                                                                                                                      |
| Does mobile work?                                   | Yes. Full-screen sheet at 375 and 320 px with Cancel, 44 px trigger and rows, no horizontal overflow; Playwright Pixel 5 case taps through open, search, select, close.                                                                                                  |
| Does keyboard behaviour work?                       | Yes. ⌘K/Ctrl K toggle, Arrow/Home/End selection through `aria-activedescendant`, Enter opens, Escape closes; jsdom and Chromium assertions.                                                                                                                              |
| Does focus return correctly?                        | Yes. Focus returns to the trigger after the dialog unmounts (the first attempt focused while the modal was still open and inert; fixed with a post-unmount effect).                                                                                                      |
| Did the header/homepage drift visually?             | Only by the approved search control. Every page baseline changed by that control alone; the homepage, guide, endpoint, schema, and drawer screens were compared before and after.                                                                                        |
| Did any existing approved screen regress?           | No. See the design re-review below.                                                                                                                                                                                                                                      |
| Did we accidentally implement SPEC-008/009/010/011? | No. No SDK or snippet results, no playground action (`⌘⏎ try in playground` from the reference is omitted), no version filter, no changelog indexing, no quality ranking.                                                                                                |

## Measured evidence

| Measure                                 | Value                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Initial page JavaScript (authored page) | 136,753 B gzip (before SPEC-007 136,150 B)                                                         |
| Lazy search chunk                       | 9,780 B gzip (28,957 B raw), one chunk, budget 40 KiB                                              |
| TestInbox search artifact               | 63 documents, 621 terms, 52 KB (12 KB gzip); index 5 ms, hydrate 1 ms, query max 1 ms              |
| 1,000 pages                             | 7,002 documents, 3.8 MB (0.47 MB gzip); index 137 ms, hydrate 19 ms, query max 8 ms                |
| 10,000 operations                       | 10,057 documents, 4.3 MB (0.53 MB gzip); index 161 ms, hydrate 40 ms, query max 20 ms              |
| Combined                                | 17,050 documents, 8.3 MB (1.01 MB gzip); index 274 ms, hydrate 66 ms, query max 24 ms; RSS 779 MiB |
| Unit, rendering, CLI, clean-room tests  | 458 in 33 files (new: search core 15, relevance 37, search rendering 7)                            |
| Browser tests                           | 48 (desktop 40 including 7 search cases, mobile 8 including 1)                                     |
| Visual baselines                        | 44 (9 new `search-*` states; every page baseline regenerated for the header control)               |
| Performance tests                       | +4 search cases alongside content, schema, and ingestion                                           |

## Severity summary

| Review                         | P0  | P1  | P2  | P3  | Disposition                                   |
| ------------------------------ | --- | --- | --- | --- | --------------------------------------------- |
| Search / Information Retrieval | 0   | 2   | 3   | 2   | P1 fixed; P2 fixed; P3 tracked                |
| Product / DX                   | 0   | 1   | 2   | 2   | P1 fixed; P2 fixed; P3 tracked                |
| Frontend architecture          | 0   | 1   | 2   | 1   | P1 fixed; P2 fixed; P3 accepted               |
| Accessibility                  | 0   | 1   | 3   | 2   | P1 fixed; P2 fixed; P3 tracked (manual AT)    |
| Security                       | 0   | 1   | 2   | 2   | P1 fixed; P2 fixed; P3 accepted with evidence |
| Performance                    | 0   | 0   | 2   | 2   | P2 fixed; P3 tracked                          |
| QA                             | 0   | 1   | 2   | 1   | P1 fixed; P2 fixed; P3 fixed                  |
| Architecture                   | 0   | 0   | 2   | 1   | P2 fixed; P3 accepted                         |

P0 open: 0. P1 unresolved: 0.

## Findings and dispositions

### Search / Information Retrieval

- **P1 — AND-combined queries dropped exact endpoints.** With every term required, `POST /v1/inboxes` returned nothing (the contract has no `v1` segment) and, with fuzziness on, a home page that happened to contain all three terms outranked the endpoint. Fixed: terms combine with OR (documents matching more terms still score higher under BM25), fuzziness is only tried when exact and prefix matching find nothing, and the method field boost is 8 so a method in the query is decisive. Golden queries cover both forms.
- **P1 — Commands were not searchable.** The code policy excluded every fenced body, so `npm install` found nothing although developers search for it. Fixed: one-line fences (≤ 160 characters) and Install commands are indexed; multi-line bodies stay excluded. Documented.
- **P2 — Prefix queries flooded one API group.** `webh` and `inbo` returned only operations of one group. Disposition: the per-group cap (3) already applies; the corpus asserts prefix-of-group expectations rather than a specific operation, which the ranking cannot pick meaningfully among siblings. Accepted with the cap.
- **P2 — Fuzzy matching applied to four-character terms produced `post` → `port/most` noise.** Fixed by making fuzziness a fallback only.
- **P2 — Accented content was unreachable from unaccented queries.** Fixed in the tokenizer (marks stripped for matching, display untouched); tested with `création`, `réponse`, `authentification`.
- **P3 — No stemming means `inboxes` and `inbox` are separate terms.** Accepted: prefix matching covers the common direction (`inbox` → `inboxes`), stemming would be English-only; tracked as a candidate multilingual improvement.
- **P3 — `github actions` ranks a card excerpt above the CI guide.** Accepted: both are correct destinations; the corpus accepts either first and requires the guide within three.

### Product / DX

- **P1 — The `SDKs` and `Schemas` groups of the reference would have been fake.** Fixed by design: the kind set has no SDK or schema kinds; the deviations table records why and when they return (SPEC-008; a global schema route).
- **P2 — Result context was missing for guide sections.** Fixed: sections show `Guides › section › page` as the subtitle, operations show `METHOD /path`.
- **P2 — The footer showed "0 results · 0 ms".** Fixed: the elapsed time is floored to 1 ms and the count reads naturally ("1 result").
- **P3 — No empty-state entry points.** Accepted: the reference shows none; the empty state is one instruction sentence, privacy-simple (SPEC §81).
- **P3 — Shortcut key cap renders after hydration only.** Accepted: avoids showing the wrong platform glyph; the label and accessible name are server-rendered.

### Frontend architecture

- **P1 — The index promise was cached without a key.** A failed load for one path could be served for another, and the failure state was unreachable. Fixed: cache keyed by artifact path, cleared on failure; jsdom test covers the failure state.
- **P2 — `setState` inside effects** (status announcement, shortcut toggle) tripped the React compiler rules and could cascade. Fixed: debounced status set from a timer, shortcut effect keyed on `open`, no render-time ref access.
- **P2 — Escape closed the native dialog without closing React state.** Fixed with `onCancel` (prevent default, close through the same path) plus focus restoration after unmount.
- **P3 — Navigation uses `window.location.assign` rather than the router.** Accepted: every reader route is a full server render (there is no client router state to preserve), and assigning a validated path is the simplest correct behaviour.

### Accessibility

- **P1 — Focus was stranded on close.** The trigger focused itself while the modal was still in the DOM (inert outside the dialog). Fixed: restore runs in an effect after the palette unmounts; Playwright asserts focus after Escape and after the shortcut.
- **P2 — Result kinds were colour-only for operations.** Fixed: every option starts with a visually hidden kind word ("API," / "Guide," …) and the method is text in the tag column.
- **P2 — Status announced on every keystroke.** Fixed: one polite announcement 400 ms after typing pauses, cleared when the query is empty.
- **P2 — Tabs and rows under 44 px on mobile.** Fixed: 44 px trigger, rows, and Cancel below 768 px.
- **P3 — Manual AT verification** (VoiceOver, NVDA, TalkBack) for the palette is recorded in the matrix and remains due before stable `1.0.0` with the prior carry-over rows. The owner accepts missing VoiceOver/NVDA qualification for pre-1.0 RCs under P2 A11Y-R01.
- **P3 — Group headings are `aria-hidden` visual eyebrows with `role="group"` labels.** Accepted: avoids double announcement.

### Security

- **P1 — Status text and highlighting could have carried markup.** Reviewed: status is a template string in a text node; highlighting splits titles with a fixed `[\p{L}\p{N}]+` regex (never built from the query) into text segments. Confirmed by jsdom and Chromium tests with `<script>` and `<img onerror>` content. No change needed beyond the tests; closed.
- **P2 — The artifact route could have served any file.** Fixed by construction: the route accepts only `index.<16 hex>.json`, compares it to the digest-derived path the server computed, and streams the validated bytes; traversal and other names are 404 (browser test).
- **P2 — A tampered or stale artifact.** Fixed: the reader checks SHA-256, byte size, and document count against the manifest before serving; the CLI test proves the manifest record and the clean-room proves the file.
- **P3 — MiniSearch supply chain.** Accepted: pinned exact version, MIT, zero dependencies, no dynamic code; the threat model records the re-review condition for upgrades.
- **P3 — Prototype-like terms.** Tested as index content and queries (`__proto__`, `constructor`, `prototype`) and as an own key in a hostile artifact (rejected as an unknown key); MiniSearch stores terms in maps, not plain objects.

### Performance

- **P2 — The lazy chunk was unmeasured.** Fixed: `check:bundle` finds the chunk by its serialized-index marker, reports it, budgets it (40 KiB), and fails if any page route references it.
- **P2 — Large-corpus behaviour was unmeasured.** Fixed: four performance cases with recorded evidence; the combined 17,050-document corpus hydrates in 66 ms and answers in ≤ 24 ms.
- **P3 — A worker would move hydration off the main thread.** Deferred: 66 ms at the combined scale does not justify a worker or a CSP change; tracked with a threshold (hydration above ~300 ms on a real corpus).
- **P3 — Sharding.** Deferred (owner: search; condition: artifact above ~5 MB gzip on a real project).

### QA

- **P1 — The determinism test compared only the artifact from one process.** Fixed: `tests/cli/content.test.ts` builds from two temporary parents and compares every artifact byte-for-byte including `search.json`; the search unit test builds twice and round-trips.
- **P2 — The visual suite waited for options on a no-results query.** Fixed (test bug).
- **P2 — Playwright `getByRole("status")` matched the copy control's status on some pages.** Fixed by scoping to the dialog.
- **P3 — Generated performance sites linked to `/api/health/ping`, which lean contracts lack.** Fixed in the shared generator.

### Architecture

- **P2 — `@specra/search` needed a browser-safe entry.** Fixed: `./client` exports only the parser, the client, and highlight; the build entry is never imported by the reader's client components.
- **P2 — The manifest gained `files.search` and a `search` record without a compatibility rule.** Fixed: both optional (older artifacts parse), the record is mandatory once the file is named, and version, size, digest, and count are validated.
- **P3 — A future `version` field on documents.** Accepted: the document contract is additive; SPEC-010 can add it without changing the engine.

## Design re-review

Compared against the Claude Design references 6e (search, glass light) and 6p (mobile search), `docs/design/reader-v1.md`, and the accepted SPEC-006 baselines:

| Surface                                    | Verdict  | Notes                                                                                                                           |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Header search control                      | faithful | 240 × 32 field-shaped control with glyph, "Search…", and the platform key cap on the right of the header; icon button on mobile |
| Palette geometry and surfaces              | faithful | 640 px at 120 px, overlay glass, radius 18, scrim with 6 px blur, header row with `esc` cap, mono footer                        |
| Result rows                                | faithful | 52 px tag column (method colour or muted kind), 14 px title with brand-underlined match, mono subtitle, `⏎` on the active row   |
| Result groups                              | adapted  | API reference and Guides only; SDKs and Schemas omitted because those results do not exist; group order follows the best hit    |
| Footer hints                               | adapted  | "⌘⏎ try in playground" omitted (SPEC-009); "esc close" added                                                                    |
| Mobile sheet                               | faithful | Full-screen field with Cancel, list panel, 44 px targets                                                                        |
| Homepage, guides, endpoint, schema, drawer | faithful | Unchanged apart from the header control; baselines regenerated and compared                                                     |

No regression remains open.

## Tracked follow-ups

| Item                                                   | Severity | Owner            | Condition                                        |
| ------------------------------------------------------ | -------- | ---------------- | ------------------------------------------------ |
| Manual AT pass for the palette (with prior carry-over) | P3       | Accessibility    | Before stable `1.0.0`; A11Y-R01 accepted for RCs |
| Worker-based hydration                                 | P3       | Search           | Hydration above ~300 ms on a real corpus         |
| Deterministic sharding                                 | P3       | Search           | Artifact above ~5 MB gzip on a real project      |
| Multilingual stemming or synonym layer                 | P3       | Search           | Relevance evidence from a non-English project    |
| SDK and schema result kinds                            | P3       | SPEC-008 / later | SDK documentation exists; a global schema route  |
