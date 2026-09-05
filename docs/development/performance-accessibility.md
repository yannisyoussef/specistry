# Performance and accessibility objectives

## Measurable performance objectives

Targets are budgets to validate, not claims of current product performance.

| Concern                           | Initial target                                                                                                                                      | Measurement point                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| OpenAPI parse + normalize         | 10 MiB / 10,000 operations in under 5 seconds and under 1 GiB peak RSS on reference CI                                                              | Dedicated large fixture benchmark |
| Phase 0 ingestion smoke           | 1,000-operation JSON document in under 2 seconds                                                                                                    | Vitest smoke gate                 |
| Incremental local content rebuild | p95 under 500 ms for one authored-page change                                                                                                       | CLI/dev benchmark                 |
| Full example build                | under 60 seconds on reference CI                                                                                                                    | CI timing artifact                |
| Initial route HTML                | under 200 KiB uncompressed (measured 77 KiB for a 25-operation project's operation page)                                                            | Browser test on the fixture       |
| Initial route JavaScript          | under 150 KiB gzip, excluding lazy search/playground/highlighter chunks (measured 135.6 KiB: 130.6 KiB framework bootstrap, 5.0 KiB reader islands) | `pnpm check:bundle` on the build  |
| Search index                      | under 5 MiB gzip for 10,000 indexed records; first query under 100 ms after worker load                                                             | Search corpus benchmark           |
| Large schema interaction          | expansion response under 100 ms with depth/child virtualization safeguards                                                                          | Browser trace                     |
| Reader experience                 | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 on representative mobile                                                                                | Lab then consumer RUM opt-in      |

Budgets are reviewed with real TestInbox and pathological fixtures. A change may revise a target only with measured evidence and an ADR or work-item note, never by quietly loosening CI.

## Scalability safeguards

Parsing and reference traversal use byte, depth, node, string, and example budgets. Normalization is iterative where recursion is attacker-controlled. Canonical artifacts are partitioned by service/version and reader routes load only needed data. Syntax highlighting and indexing are build-time jobs. Schema trees avoid rendering an entire graph and represent cycles as links.

## Accessibility target

Specra targets WCAG 2.2 AA where applicable. Every slice must cover semantic landmarks and headings, keyboard operation, visible focus, focus restoration, screen-reader names and state, contrast, reduced motion, zoom/reflow, touch targets, form errors, and non-color cues.

Automated gates use axe for stable representative states and browser tests as interactive components arrive. Automation cannot verify reading order quality, useful alternative text, announcements, keyboard efficiency, zoom behavior, or comprehension. Release testing therefore includes manual keyboard-only, VoiceOver and NVDA spot checks, 200%/400% zoom, high contrast, reduced motion, mobile screen-reader, and touch-target review.

### Manual accessibility matrix

| Check                                                   | Desktop                            | Mobile                                | Required evidence                                    |
| ------------------------------------------------------- | ---------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| Keyboard-only flow, focus order/restoration, skip links | Chrome + Firefox                   | External keyboard where supported     | Short release note with failures or pass             |
| Screen reader landmarks, names, state, reading order    | VoiceOver + Safari; NVDA + Firefox | VoiceOver + Safari; TalkBack + Chrome | Scenario checklist, with browser/AT versions         |
| Reflow and text zoom                                    | 200% and 400%                      | 320 CSS px portrait                   | No loss of content/function or two-axis reading      |
| High contrast and non-color cues                        | Forced Colors                      | Platform high-contrast setting        | Controls, focus, errors, and diagrams remain legible |
| Reduced motion                                          | OS preference enabled              | OS preference enabled                 | No required information depends on animation         |
| Touch targets and gestures                              | Responsive emulation               | Physical device spot check            | Alternatives exist for complex gestures              |

Every UI slice records applicable rows. “Not applicable” requires a reason; automated axe results do not replace this matrix.

### SPEC-004 reader evidence

| Check                        | Automated evidence                                                                                                                                                                                                                                        | Manual expectation before release                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Keyboard flow and skip link  | Playwright: Tab reaches the skip link first, Enter focuses `main`, the next Tab reaches the primary tab, the copy control shows a 3 px solid outline, copies, and announces via a status region                                                           | Chrome and Firefox: traverse sidebar → main → sections → footer theme buttons with no trap                                  |
| Screen reader semantics      | jest-axe and browser axe on operation, index, 404, and open drawer; landmarks `banner`, `navigation`, `complementary`, `main`, `contentinfo`; headings h1 → h2 sections → h3 groups                                                                       | VoiceOver + Safari, NVDA + Firefox: announce method and path, required/optional words, OR/AND joiners, response status text |
| Mobile drawer                | Playwright (Pixel 5 profile): `dialog` opens from a 44 px control, focus moves inside, `Escape` closes and restores focus, links navigate and close; without JavaScript the control is a link that reveals the sidebar                                    | TalkBack + Chrome: drawer announced as a dialog named "Navigation"                                                          |
| Reflow and zoom              | Playwright at 320 CSS px: no horizontal overflow on operation, reference, and long-path pages                                                                                                                                                             | 200 % and 400 % zoom on the operation page: single-column reading, no clipped code or method labels                         |
| Contrast and non-colour cues | Tokens follow the design's 4.5:1 rule (muted text `#6c6c73` light / `#9a9aa1` dark, amber `#8a5a00` light); small labels use muted text; methods and statuses are words plus colour; deprecated items carry visually-hidden text in the sidebar and title | Forced Colors: Playwright asserts a solid focus outline and solid panel borders; manual check of badges and callouts        |
| Reduced motion               | `prefers-reduced-motion` zeroes durations; the drawer slide is the only animation                                                                                                                                                                         | OS preference enabled: no motion on open or close                                                                           |
| Touch targets                | Menu control 44 px; footer theme buttons ≥ 32 px on desktop and asserted ≥ 44 px on mobile                                                                                                                                                                | Physical device spot check of drawer links and the copy control                                                             |

Visual regression will use deterministic local fonts/assets and a small browser matrix. Baselines cover home, guide, endpoint, large schema, light/dark, mobile navigation, search, playground, code, errors, and empty states. Masks and thresholds require documented reasons; semantic assertions remain primary.
