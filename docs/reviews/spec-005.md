# SPEC-005 review record

Date: 2026-09-05

The Principal Engineer self-reviewed the schema renderer against the §92 checklist,
then ran the seven independent review passes the slice requires (OpenAPI / JSON
Schema, frontend architecture, accessibility, performance, security, QA, Product /
DX) as read-only inspections of the branch, followed by the design re-review against
the approved Glass reference (handoff screen D, `06c`). Reviewers inspected commits
`71a2e8c` (additive model name), `7d615d6` (projection and renderer), and the
hardening commit on `feature/SPEC-005-schema-renderer`; the dispositions below were
applied in the same branch before the final gates.

## Principal Engineer self-review

| Question                                       | Answer and evidence                                                                                                                                                                                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Did we preserve canonical semantics?           | Yes. The projection reads `SchemaNode` kinds only; `allOf` stays parts, `oneOf`/`anyOf` stay variants, `not` is exclusion, type-less never becomes a type, `true`/`false`/`any` stay distinct. Asserted in `tests/reader/schema-view.test.ts`. |
| Did we change model v1 unnecessarily?          | No. One additive optional field, `SchemaMetadata.name`, governed by ADR-011; older artifacts stay valid; version stays 1. The alternative (reusing `title`) was rejected because titles are absent in every fixture and most contracts.        |
| Do references display meaningful names?        | Yes. `User`, `array of Address`, `Payment`, `↻ Node · recursive`; names come from the adapter's definition key, never from an ID. Leaf definitions read by their semantic phrase with the name alongside.                                      |
| Does recursion always terminate?               | Yes. Ancestry of registry IDs marks a cycle at the first repetition; fuzzing over 60 seeded graphs with arbitrary cycles, a fully connected cycle of every kind, and a 10,000-deep inline chain all terminate within budget.                   |
| Are expansions bounded?                        | Yes. Depth 6, 400 nodes, 30 open / 200 total properties, 20 variants, 8 / 200 enum values; every cut-off says so and links to the focused view.                                                                                                |
| Can a large schema explode the DOM?            | No. Worst case at the node budget is ~5,100 elements / ~190 KB per block; the 250-property fixture renders 30 rows open, 170 behind a disclosure, and 50 through the focused view; the complex page stays under 512 KiB.                       |
| Are oneOf and anyOf visibly distinct?          | Yes. "Exactly one of the following:" versus "One or more of the following (any combination):", `variant` versus `option`.                                                                                                                      |
| Is allOf still composition?                    | Yes. Each part is an open disclosure labelled by its name; nothing is merged and no conflict is hidden.                                                                                                                                        |
| Do request and response contexts differ?       | Yes. `Profile` omits `id`/`createdAt` in the request and `password`/`recoveryEmail` in the response, saying so in words; the browser suite asserts both on the same page.                                                                      |
| Are boolean/type-less schemas accurate?        | Yes. `any value` / `no value` with an "Explicit true/false schema" note; `unspecified type` with the applicability note; bare `const`/`enum` read as `constant`/`enum`.                                                                        |
| Is screen-reader output tolerable?             | Reviewed. Disclosure names are counts plus the property name; rows carry name, phrase, and required word; omissions are one sentence. Manual AT rows added to the accessibility matrix; verbosity of very long objects remains a manual check. |
| Does 320 px work?                              | Yes. Pixel 5 and 320 × 640 runs show no horizontal overflow with 250 properties, 25 variants, and a 2,000-character name; the deepest guide keeps ≥ 180 px of content.                                                                         |
| Is client JS still small?                      | Yes. 135,562 B gzip before and after: the renderer ships no client script.                                                                                                                                                                     |
| Is CSP unchanged?                              | Yes. `proxy.ts` is untouched; the focused view is a server route with a validated query.                                                                                                                                                       |
| Are hostile strings inert?                     | Yes. jsdom and browser assertions on `<img onerror>`, `<script>`, prototype names, bidi/zero-width characters, a 2,000-character name, and a hostile pattern; no `dangerouslySetInnerHTML` exists in the reader.                               |
| Did we accidentally implement 006/007/008/009? | No. No authored content, no search or filter, no generated code or SDK mapping, no forms; the focused view is a documentation route, not a schema browser.                                                                                     |

## Measured evidence

| Measure                                        | Value                                                                        |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| Client JavaScript, operation page              | 135,562 B gzip (unchanged; renderer adds 0 B)                                |
| 20-property object                             | 21 view nodes, 199 elements, 7.1 KB, projection 0.4 ms, render 6 ms          |
| 200-property object                            | 201 view nodes, 1,942 elements, 69 KB, render 27 ms                          |
| Worst case at the node budget (300 × 3 nested) | 467 view nodes, 5,071 elements, 188 KB, 134 disclosures, render 29 ms        |
| Edge fixture largest response                  | 300 view nodes, 3,013 elements, 114 KB, 47 disclosures                       |
| Complex operation page HTML (edge)             | ~456 KB uncompressed (gate 512 KiB); TestInbox operation pages under 200 KiB |
| Focused view, 250-property object              | under 6,000 DOM elements                                                     |
| Unit / rendering / fuzz / CLI tests            | 363 (27 files) under coverage 86.87 / 81.46 / 95.86 / 88.44                  |
| Browser tests                                  | 31 (desktop 27 including 7 schema cases, mobile 4 including 1)               |
| Visual baselines                               | 21 (14 reader states, 7 schema states), Linux amd64                          |

## Severity summary

| Review                | P0  | P1  | P2  | P3  | Disposition                                     |
| --------------------- | --- | --- | --- | --- | ----------------------------------------------- |
| OpenAPI / JSON Schema | 0   | 1   | 3   | 3   | P1 fixed; P2 fixed; P3 fixed except one tracked |
| Frontend              | 0   | 0   | 3   | 4   | P2 fixed; P3 fixed except one tracked           |
| Accessibility         | 0   | 1   | 3   | 3   | P1 fixed; P2 fixed; P3 fixed except two tracked |
| Performance           | 0   | 1   | 2   | 2   | P1 fixed; P2 fixed; P3 tracked                  |
| Security              | 0   | 0   | 2   | 3   | P2 fixed; P3 fixed except one accepted          |
| QA                    | 0   | 2   | 3   | 3   | P1 fixed; P2 fixed; P3 fixed                    |
| Product / DX          | 0   | 1   | 4   | 4   | P1 fixed; P2 fixed; P3 fixed except one tracked |

No P0 was found. Every P1 is fixed in code with a test.

## Findings and dispositions

### OpenAPI / JSON Schema

| ID   | Severity | Finding                                                                               | Disposition                                                                                                  |
| ---- | -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| P1-1 | P1       | Reference targets had no display identity; the reader could only say "object"         | Fixed: additive `SchemaMetadata.name` (ADR-011) set by the adapter from the definition key; fixtures rebuilt |
| P2-1 | P2       | A bare `const` or `enum` without `type` read as "unspecified type", burying the value | Fixed: labels `constant` / `enum`; the applicability note is suppressed for them                             |
| P2-2 | P2       | `additionalProperties: true` (OpenAPI's default) was announced on every object        | Fixed: only closed objects and property-less open objects carry a note                                       |
| P2-3 | P2       | Nullable compositions must not read as two variants                                   | Fixed: `X or null` collapses onto the concrete schema with a `nullable` flag; locators keep the variant step |
| P3-1 | P3       | `contains`/`minContains` not surfaced                                                 | Fixed: `contains` row and "contains at least/most" constraints                                               |
| P3-2 | P3       | Discriminator values mapped to schemas outside the composition                        | Fixed: shown by name without a link                                                                          |
| P3-3 | P3       | `allOf` conflicts are not detected                                                    | Tracked: the renderer explains parts; conflict analysis belongs to SPEC-011 quality gates                    |

### Frontend architecture

| ID   | Severity | Finding                                                                              | Disposition                                                                             |
| ---- | -------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| P2-1 | P2       | The operation view (and every schema block) was projected twice on focused requests  | Fixed: `React.cache` around `createOperationView` per resolved target                   |
| P2-2 | P2       | Expansion state must not depend on object identity                                   | Fixed: structural locators; determinism asserted across fresh registries and in fuzzing |
| P2-3 | P2       | Client-state architecture for schemas                                                | Fixed by design: none; native `<details>` and a validated server query hold all state   |
| P3-1 | P3       | `SchemaBlockRef.node` keeps canonical nodes on the server view object                | Accepted and documented: server-only, never serialized to the client                    |
| P3-2 | P3       | Renderer helper `hasChildren` recurses one level into array items per row            | Accepted: O(rows), measured under 35 ms for the worst block                             |
| P3-3 | P3       | Component split: block, disclosure, focus page in one directory                      | Fixed: `components/reader/schema/`                                                      |
| P3-4 | P3       | Tuple remainder and dictionary rows reuse `Row` with a role label rather than a name | Tracked: fine for v1; a dedicated role style may come with SPEC-006 authored components |

### Accessibility

| ID   | Severity | Finding                                                       | Disposition                                                                                    |
| ---- | -------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| P1-1 | P1       | Disclosure summaries must have concise, distinguishable names | Fixed: "3 properties", "items", "3 variants" plus a visually hidden " of <name>"               |
| P2-1 | P2       | No ARIA tree; keyboard obligations                            | Fixed by design: native `<details>`; Enter/Space and focus retention asserted in the browser   |
| P2-2 | P2       | Forced colours: nesting shown by tint only                    | Fixed: guide `CanvasText`, chips and variant cards keep borders, links `LinkText`              |
| P2-3 | P2       | Touch targets for summaries on mobile                         | Fixed: `min-height: var(--touch-target)` below 768 px; asserted ≥ 44 px                        |
| P3-1 | P3       | Several identical "Open Node ↗" link names on one page        | Tracked: add the parent property to the hidden text when manual AT review confirms it helps    |
| P3-2 | P3       | Very long objects still read row by row                       | Tracked: manual AT verbosity review row added; batching beyond 30 rows is already a disclosure |
| P3-3 | P3       | `aria-current="location"` on the trail segment                | Fixed                                                                                          |

### Performance

| ID   | Severity | Finding                                                                                      | Disposition                                                                                         |
| ---- | -------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| P1-1 | P1       | At a 600-node budget the worst block rendered 233 KB / 6,400 elements, above the page budget | Fixed: budget 400 nodes (188 KB / 5,071 elements); complex-page gate 512 KiB; measurements recorded |
| P2-1 | P2       | No DOM/HTML evidence for representative shapes                                               | Fixed: `tests/performance/schema-render.test.ts` writes `schema-measurements.json`, uploaded by CI  |
| P2-2 | P2       | Large enums could render hundreds of chips inline                                            | Fixed: 8 previewed, 192 behind a disclosure, the rest a count                                       |
| P3-1 | P3       | Memory of repeated expand/collapse                                                           | Tracked as not applicable: native disclosures hold no script state; nothing is retained             |
| P3-2 | P3       | Focused view re-projects from the canonical node on each request                             | Accepted: sub-millisecond projection; artifact is memoized per process                              |

### Security

| ID   | Severity | Finding                                                        | Disposition                                                                                                    |
| ---- | -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| P2-1 | P2       | `?schema=`/`?at=` must never be interpreted as paths or echoed | Fixed: strict grammars, lookup by anchor only, redirect otherwise; browser cases for traversal and script text |
| P2-2 | P2       | Prototype-named properties through projection                  | Fixed: `propertyOrder` iteration, `defineProperty` fixtures, pollution asserted absent after fuzzing           |
| P3-1 | P3       | A 2,000-character key broke the repository formatter           | Fixed: explicit YAML key; the hostile fixture is excluded from Prettier                                        |
| P3-2 | P3       | Focused-view URLs are enumerable                               | Accepted: public documentation; `noindex` keeps them out of indexes                                            |
| P3-3 | P3       | Pattern strings could force layout                             | Fixed: `overflow-wrap: anywhere` inside the row; page overflow asserted zero                                   |

### QA

| ID   | Severity | Finding                                                                     | Disposition                                                          |
| ---- | -------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| P1-1 | P1       | No end-to-end proof of request/response difference on one referenced schema | Fixed: edge `PUT /profiles` and a browser case                       |
| P1-2 | P1       | Enum count assertion counted hidden DOM, passing for the wrong reason       | Fixed: `:visible` counts before and after opening the disclosure     |
| P2-1 | P2       | No fuzz coverage of arbitrary cycles                                        | Fixed: 60 seeded graphs plus targeted cycle and depth cases          |
| P2-2 | P2       | Focus page had no rendering test                                            | Fixed: jsdom + axe case on the TestInbox `content` locator           |
| P2-3 | P2       | Visual baselines for schema states                                          | Fixed: seven states added and generated on linux/amd64               |
| P3-1 | P3       | Depth cut-off asserted before opening the chain                             | Fixed: the browser case opens every disclosure and asserts the count |
| P3-2 | P3       | Hostile-name assertion matched escaped text                                 | Fixed: asserts the attack never appears inside a tag                 |
| P3-3 | P3       | `schema-measurements.json` could be committed by accident                   | Fixed: ignored and uploaded as CI evidence                           |

### Product / DX

| ID   | Severity | Finding                                                     | Disposition                                                                                   |
| ---- | -------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P1-1 | P1       | "3 propertys"                                               | Fixed                                                                                         |
| P2-1 | P2       | Root block offered "Open X ↗" to a view identical to itself | Fixed: no root link                                                                           |
| P2-2 | P2       | Notes with backticks rendered literally                     | Fixed: `<code>` elements                                                                      |
| P2-3 | P2       | Variants needed comparison without opening each             | Fixed: summary shows name, shape, and discriminator values                                    |
| P2-4 | P2       | Omission sentence must be visible before rows               | Fixed: rendered in the root line and in each object's value column                            |
| P3-1 | P3       | Dictionary wording                                          | Fixed: `map of X` and an "additional properties" row                                          |
| P3-2 | P3       | Type-less arrays                                            | Fixed: note "keywords apply only when the value is an array"                                  |
| P3-3 | P3       | Segmented variant control from the reference                | Tracked: disclosure list chosen for accessibility and scale; revisit with SPEC-006 components |
| P3-4 | P3       | Focused view could show the operation description           | Fixed: method and path only, to keep the trail in view                                        |

## Design re-review

| Aspect                                     | Verdict  | Note                                                                                    |
| ------------------------------------------ | -------- | --------------------------------------------------------------------------------------- |
| Property rows 160/1fr, nested 130/110      | faithful | Same grid and type scale as the endpoint page                                           |
| Nested tint and hairline guide             | faithful | Open summary tinted, `--border-strong` guide, bounded indentation on mobile             |
| "array of X", recursion never inline       | faithful | `↻ Node · recursive` with an "Open" link                                                |
| Drill-in breadcrumb trail                  | faithful | Focused view trail `Response body · application/json › content › HtmlContent`           |
| Variant segmented control                  | adapted  | Disclosure list with chips: works without script, scales past four, keeps comparison    |
| "Collapse all"                             | deferred | Needs client script; native disclosures and bounded initial state make it non-essential |
| Light/dark, forced colours, reduced motion | faithful | Tokens only; guides and chips survive forced colours; chevron transition removed        |

The renderer reads as part of the Glass reader, not as a separate schema application.

## Tracked and accepted

| Item                                              | Owner / when                                |
| ------------------------------------------------- | ------------------------------------------- |
| `allOf` conflict detection                        | SPEC-011 quality gates                      |
| Parent property in "Open …" link names            | After manual AT review                      |
| Verbosity of very long objects for screen readers | Manual AT matrix row; SPEC-006 pass         |
| Segmented variant control / "Collapse all" island | SPEC-006 component pass, only with evidence |
| Dedicated role style for tuple/dictionary rows    | SPEC-006                                    |
| Schema-level `examples`                           | SPEC-008 snippets                           |
| Duplicate definition names inside one registry    | Shown as-is; diff CLI (SPEC-011) may warn   |

## Principal Engineer decision

Approved for merge into `develop`. P0 = 0, every P1 fixed with a test, every P2 fixed,
every P3 fixed or tracked with an owner. Model v1 is preserved with one governed additive
field, canonical semantics survive rendering, recursion and expansion are bounded with
evidence, the Glass design is extended rather than replaced, and the full gate set
(format, lint, types, unit, rendering, fuzz, security, architecture, accessibility,
browser desktop and mobile, visual, bundle, performance, dependency, license, secrets,
coverage, builds, frozen install, audit) passes. SPEC-006 has not started.
