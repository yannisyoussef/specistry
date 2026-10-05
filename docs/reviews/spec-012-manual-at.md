# SPEC-012 manual assistive-technology matrix

Status: **ACCEPTED / DEFERRED TO 1.0.0 — A11Y-R01**

The owner accepts the missing manual qualification for `0.1.0-rc.2` and other
pre-1.0 release candidates. This is a qualification residual, not a known
accessibility defect. Automated gates remain required and unchanged.

| Field                                    | Decision                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ID                                       | A11Y-R01                                                                                           |
| Category                                 | Accessibility qualification                                                                        |
| Severity                                 | P2                                                                                                 |
| Status                                   | ACCEPTED / DEFERRED                                                                                |
| Current evidence                         | Automated accessibility, keyboard, reflow, Chromium, Firefox, WebKit, and no-JavaScript gates pass |
| Missing evidence                         | Manual VoiceOver + Safari; manual NVDA + Firefox/Chrome                                            |
| Known defect                             | None currently established by this gap                                                             |
| `0.1.0-rc.2` blocker                     | No                                                                                                 |
| Pre-1.0 RC blocker                       | No                                                                                                 |
| `1.0.0` stable blocker                   | Yes                                                                                                |
| Formal comprehensive accessibility claim | Not permitted until qualification is completed                                                     |
| Owner                                    | Accessibility / release owner                                                                      |

Specra is continuously tested with automated accessibility rules, keyboard
navigation, responsive layouts, and Chromium, Firefox, and WebKit. Manual
VoiceOver and NVDA qualification is planned before the 1.0 stable release.

Automated axe, keyboard, reflow, no-JavaScript, and cross-browser tests are
necessary evidence but do not complete this matrix. A human operator must run
the built release candidate against both the Specra self-documentation portal
and the Odexa portal. Record the OS, browser, assistive-technology version,
date, tester, result, and a short observation for every row. Do not replace a
failed row with a waiver in this file; open a tracked finding.

| Portal | Assistive technology       | Browser | Flow                                                                   | Expected observation                                                                      | Result  | Evidence |
| ------ | -------------------------- | ------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------- | -------- |
| Specra | VoiceOver on current macOS | Safari  | Navigate landmarks, headings, sidebar, breadcrumb, previous/next       | Order and names are meaningful; no duplicate or skipped primary heading                   | PENDING | —        |
| Specra | VoiceOver on current macOS | Safari  | Open search, enter a query, traverse results, close and restore focus  | Result count is announced; results have useful names; focus returns predictably           | PENDING | —        |
| Specra | NVDA on supported Windows  | Firefox | Navigate landmarks, headings, sidebar, breadcrumb, previous/next       | Same semantic order and names as the visual experience                                    | PENDING | —        |
| Specra | NVDA on supported Windows  | Firefox | Read code samples and activate copy controls                           | Language and control names are announced; code remains readable linearly                  | PENDING | —        |
| Odexa  | VoiceOver on current macOS | Safari  | Find an operation through search and navigate its parameters/responses | Search, operation title, heading hierarchy, tables, and schema regions are understandable | PENDING | —        |
| Odexa  | VoiceOver on current macOS | Safari  | Switch code language and inspect a generated request                   | Selected state is announced and content change is discoverable                            | PENDING | —        |
| Odexa  | NVDA on supported Windows  | Firefox | Fill the local-only Try it form without submitting a real credential   | Labels, required state, validation, environment policy, and submit state are announced    | PENDING | —        |
| Odexa  | NVDA on supported Windows  | Firefox | Navigate authored callouts, steps, tabs, cards, and event guidance     | Roles, labels, order, selected tabs, and static fallback content are coherent             | PENDING | —        |

The owner decision above permits pre-1.0 RC publication with these rows pending.
Stable `1.0.0` sign-off requires completion of this matrix; a failed row must
be tracked and resolved or separately reviewed. A comprehensive screen-reader
or formal WCAG conformance claim remains unavailable until manual qualification
is completed.
