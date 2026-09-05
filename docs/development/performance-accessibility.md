# Performance and accessibility objectives

## Measurable performance objectives

Targets are budgets to validate, not claims of current product performance.

| Concern                           | Initial target                                                                          | Measurement point                 |
| --------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- |
| OpenAPI parse + normalize         | 10 MiB / 10,000 operations in under 5 seconds and under 1 GiB peak RSS on reference CI  | Dedicated large fixture benchmark |
| Phase 0 ingestion smoke           | 1,000-operation JSON document in under 2 seconds                                        | Vitest smoke gate                 |
| Incremental local content rebuild | p95 under 500 ms for one authored-page change                                           | CLI/dev benchmark                 |
| Full example build                | under 60 seconds on reference CI                                                        | CI timing artifact                |
| Initial route HTML                | under 200 KiB uncompressed                                                              | Build manifest check              |
| Initial route JavaScript          | under 150 KiB gzip, excluding lazy search/playground/highlighter chunks                 | Bundle budget                     |
| Search index                      | under 5 MiB gzip for 10,000 indexed records; first query under 100 ms after worker load | Search corpus benchmark           |
| Large schema interaction          | expansion response under 100 ms with depth/child virtualization safeguards              | Browser trace                     |
| Reader experience                 | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 at p75 on representative mobile                    | Lab then consumer RUM opt-in      |

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

Visual regression will use deterministic local fonts/assets and a small browser matrix. Baselines cover home, guide, endpoint, large schema, light/dark, mobile navigation, search, playground, code, errors, and empty states. Masks and thresholds require documented reasons; semantic assertions remain primary.
