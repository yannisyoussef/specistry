# SPEC-008 review record — Code samples and SDK mappings

Reviews were run on the `feature/SPEC-008-code-samples-sdk-mappings` branch
against develop `864defa`. Each specialist pass lists findings by severity
(P0 security/correctness/release blocker, P1 major, P2 important, P3 minor)
with their disposition. Completion requires no open P0 and no unresolved P1.

## Principal Engineer self-review

Questions from the slice definition, each answered against the code:

| Question                                             | Answer                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Protocol snippets from canonical data only?          | Yes: `@specra/snippets` imports `@specra/model` types only; the architecture gate allows no other edge and the CLI feeds it the serialized `documentation.json`.                           |
| Any OpenAPI parser type leaked?                      | No: the package never sees `@specra/openapi`; the goldens use hand-built model nodes.                                                                                                      |
| Invented SDK methods?                                | No code path derives SDK text; the only SDK source is `config.sdks[].examples`, and an operation without a mapping gets no SDK option.                                                     |
| Java/JavaScript protocol examples distinct from SDK? | Protocol options sit under the `Protocol` group with language labels; SDK options under `SDK` with the consumer's label and package. The rail eyebrow says `Protocol` or `Protocol · SDK`. |
| All six languages?                                   | cURL, HTTP, JavaScript, TypeScript, Java, Python, each with goldens for 20 fixture cases, syntax validation, and the equivalence matrix.                                                   |
| Serialization rules correct?                         | Path simple/label/matrix, query form/space/pipe/deepObject with explode and allowReserved, header simple, cookie form; unit tests assert each pair.                                        |
| Media types correct?                                 | JSON (+json), multipart (file parts and part content types), form, text, binary, opaque; per language.                                                                                     |
| Auth placeholders safe? OR-of-AND faithful?          | Placeholders only; alternatives generated one at a time with AND schemes all applied; the compound fixture (`apiKey AND mTLS`, `OIDC`, anonymous) is a golden.                             |
| Shell injection? CRLF? Host-language syntax?         | Single-quoted shell with a fake `curl` test; CRLF removed at projection; every golden passes `bash -n`, `node --check`, `tsc`, `ast.parse`, `javac`.                                       |
| Deterministic?                                       | Goldens are exact text; artifacts are byte-identical across directories and processes (CLI test).                                                                                          |
| Cartesian explosion?                                 | No: projections in the artifact (188–694 B per operation), text generated on render (0.02–0.13 ms per operation).                                                                          |
| Rail at 1366? Mobile?                                | 1366: rail 340 px, document 706 px; mobile: inline section plus a sticky bar; browser tests at 375 and 320 px.                                                                             |
| Initial JS within budget?                            | Operation page 137,059 B gzip (budget 153,600); docs page unchanged; no generator in client chunks (gate).                                                                                 |
| Search relevance preserved?                          | 37 original queries green; 3 SDK queries added; SDK labels indexed in the body field after package names were shown to regress "wait for email".                                           |
| Try it absent? CSP unchanged?                        | No Try it control or copy; `proxy.ts` untouched; the CSP test asserts zero violations with the rail.                                                                                       |
| Existing design drift?                               | Homepage, guides, search, sidebar, drawer, schema renderer untouched; endpoint baselines change by the rail alone.                                                                         |

Defects fixed during the self-review before specialists: the cURL first
option landed on its own line; the HTTP request line re-encoded
placeholders; `tokenCount` was documented as non-sensitive while the
conservative word match redacts it (documentation corrected); the Java text
block added a trailing newline the source lacked (line continuation added);
Python imports were out of order; `Object.keys().sort()` in example
sanitization is fine because canonical JSON keys are already sorted.

## OpenAPI / protocol reviewer

- **P1 (fixed):** contract operation ids are unique per service only; the
  `multi` fixture's two `listUsers` collapsed into one projection and made
  a `{ method, path, service }` target unresolvable. Artifact keys are now
  `<service id>~<operation id>` everywhere (projection, SDK examples,
  search terms, reader lookup).
- **P2 (fixed):** `allowReserved` must not let `&`, `#`, or `+` through;
  the encoder keeps the RFC 3986 reserved set minus those.
- **P2 (accepted):** query arrays from placeholders show one item, so
  `explode` is visible only when an example carries several values. Shown
  in the fixture with `tags=a&tags=b%20c`; documented.
- **P3 (accepted):** dot segments in a contract path template are encoded
  but not normalized; `URL` clients resolve them. Documented in the
  security test.

## SDK owner reviewer

- **P1 (fixed):** package names indexed for search put `email` into the
  `email.testinbox:sdk` fixture and outranked the guide for "wait for
  email". Only SDK labels are indexed, in the body field.
- **P2 (fixed):** an example could target `listUsers` in a two-service
  project and silently pick one; the target now fails as
  `SDK_EXAMPLE_TARGET_AMBIGUOUS` until `service` (title or canonical id) is
  given.
- **P2 (accepted):** one example per SDK per operation; variants (async vs
  sync) need a second SDK declaration. Recorded as a follow-up condition.
- **P3 (tracked):** an inline one-line SDK example under the title (design
  5d) needs an authored short form; deferred until evidence.
- Ergonomics reviewed on the TestInbox fixture: inline records, a JSON
  examples file, and per-example code files all resolve; diagnostics point
  at `config#/sdks/<i>/examples/<j>` or `source/<file>#/examples/<j>`.

## Security reviewer

- **P1 (fixed):** the language control's chevron was a `data:` image,
  which the reader's `img-src 'self'` policy blocked (three CSP violations
  in the browser test). The chevron is now border-drawn.
- **P1 (fixed):** credential-shaped example values (`sk_live_…`, JWTs,
  AWS keys, PEM, long opaque tokens) were emitted when their parameter name
  was innocuous; value-shape redaction added and tested.
- **P2 (fixed):** the mobile action bar was `position: fixed` inside a
  panel with a backdrop filter and paint containment, so it rendered off
  screen; it is now sticky at the end of the article. (Correctness, listed
  here because the fix touched the panel's containment reasoning.)
- **P2 (accepted):** a customized selection is a shareable URL by design;
  values are validated against strict grammars and never echoed, and the
  page is `noindex`.
- **P3 (accepted):** the `Idempotency-Key` header is redacted to
  `<YOUR_IDEMPOTENCY_KEY>` by the conservative word match; harmless.
- Verified: zero requests to the fake target API across every control;
  CSP unchanged; artifact tampering rejected (environments, kinds, tokens,
  prototype keys); SDK code rendered as text with no `script`/`img` nodes;
  no generator marker in any client chunk.

## Product / DX reviewer

- **P1 (fixed):** the first operation page render showed six stacked
  examples before hydration only briefly, but without JavaScript all six
  stayed visible; the no-JS shape now shows cURL and a native disclosure
  for the rest.
- **P2 (fixed):** the rail's REST/SDK segmented control from the design
  would be a fake control with one option in projects without SDKs; a
  grouped select with a `Protocol · SDK` eyebrow keeps the distinction
  visible without dead controls.
- **P2 (accepted):** environment, body, and auth changes are a soft
  navigation (server render) rather than instant client toggles; measured
  under 100 ms locally, focus and scroll preserved. The design's instant
  cross-fade applies to the language switch, which is client-side.
- **P3 (tracked):** environment choice is per page; carrying it across
  operations belongs with SPEC-009's environment state.

## Frontend architecture reviewer

- **P1 (fixed):** `useRouter` inside the options island made the rail
  unrenderable outside Next (jsdom tests); the router dependency is
  isolated in `navigation.ts` and stubbed in tests.
- **P2 (fixed):** the operation page rendered the rail inside the document
  column, which cannot become a sibling panel with CSS alone; the page is
  now header, rail, body siblings, and the document panel is painted by a
  pseudo-element from 1280 px. The forced-colors browser test reads that
  border.
- **P2 (accepted):** the six panels are server-rendered (about 23 KB of
  the 180 KB operation HTML) instead of lazily fetched; this keeps the
  no-JS path and avoids a second network round trip. Budget 200 KiB holds.
- Verified: client islands import no build-only package (gate with
  self-test); the reader memoizes generation per artifact digest with a
  bounded cache.

## Accessibility reviewer

- **P1 (fixed):** the language select had no accessible name beyond its
  value; it is now labelled "Language" and grouped.
- **P2 (fixed):** hidden panels were still reachable by testing-library's
  default queries only because they were `hidden`; the browser test
  asserts one visible panel and the copy control focus order.
- **P2 (accepted):** the copy control comes before the code region in
  reading order (header row, then code), consistent with authored code
  blocks.
- Verified: axe clean (jsdom and Chromium) on the rail; keyboard
  type-ahead on the select; focus stays on selects after changes; 44 px
  controls on mobile; forced-colors borders; no animation. Manual AT rows
  added to the matrix.

## Performance reviewer

- **P2 (accepted):** generation runs per request for uncached selections;
  0.02–0.13 ms per operation for six languages, memoized (500 entries).
- **P3 (accepted):** the operation HTML grew from ~77 KB to ~180 KB with
  six examples, two SDK examples, and the response example; within the
  200 KiB budget. A lazy panel fetch is the mitigation if a project's SDK
  examples push it further.
- Evidence recorded in `tests/performance/snippets-measurements.json`:
  1,000 rich operations 333 KB (10 KB gzip), 10,000 lean operations
  1.88 MB (89 KB gzip), builds 1.0 s and 2.5 s.

## QA reviewer

- **P1 (fixed):** the cross-language equivalence extractors initially
  missed Python bodies (trailing-comma regex) and HTTP JSON bodies for
  `+json` media types; both fixed and the matrix now covers the 20 golden
  cases and every TestInbox operation under every environment, body, and
  auth selection.
- **P2 (fixed):** the security corpus placed secret canaries in the path
  template and the scheme name (names, not values); the corpus now tests
  names and values in their own positions.
- **P2 (accepted):** Java compilation and Python parsing skip when the
  toolchain is absent locally; CI's image has both, so the gate is real
  there.
- Verified: goldens exact, determinism, clean-room offline build with an
  SDK mapping, fixture drift guard, browser desktop 46 and mobile 17
  green, visual baselines regenerated and reviewed.

## Design reviewer

Compared against Claude Design 5d/5e (endpoint rail), 3f (tablet), 6n
(mobile):

| Element                                                    | Status   | Note                                                                                  |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| Rail as a third glass panel, sticky                        | faithful | Widths 340/380/480 by breakpoint; document column ≥ 620 px at 1280, 706 px at 1366    |
| Code / Try it segmented                                    | adapted  | `Code` heading styled as the selected segment; no Try it                              |
| REST / SDK segmented + language dropdown                   | adapted  | One grouped native select; eyebrow `Protocol · SDK`                                   |
| Following · section eyebrow                                | deferred | Needs line-to-section mapping data; not faked                                         |
| Request block with header and Copy                         | faithful | Code surface, mono 12.5 / 1.7, header with label and Copy                             |
| Response · 201 block                                       | faithful | The contract's first success example                                                  |
| Try this request button, Next link                         | omitted  | SPEC-009 and later                                                                    |
| Tablet inline disclosure (3f)                              | adapted  | One inline bordered Code section after the header rather than per-section disclosures |
| Mobile bottom bar (6n)                                     | adapted  | One `Code` action, sticky glass bar                                                   |
| Homepage, guides, search, sidebar, drawer, schema renderer | faithful | Unchanged; baselines differ only where the endpoint page gained the rail              |

No unresolved regression.

## Totals

P0: 0. P1: 8 found, 8 fixed. P2: 14 found, 9 fixed, 5 accepted with
evidence. P3: 6 found, 2 tracked, 4 accepted.

## Tracked follow-ups

- Inline one-line SDK example under the title (needs an authored short
  form; SDK owner).
- Per-page environment choice to carry across operations (SPEC-009).
- Lazy panel fetch if operation HTML approaches the 200 KiB budget
  (performance).
- Manual assistive-technology pass for the rail (accessibility, before
  release, with the SPEC-006/007 carry-overs).
