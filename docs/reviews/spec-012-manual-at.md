# SPEC-012 manual assistive-technology matrix

Status: **BLOCKED — OWNER EXECUTION REQUIRED BEFORE PUBLIC RELEASE**

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

Release sign-off requires all rows to be `PASS`, or a separately reviewed and
explicitly accepted residual-risk decision from the accessibility and product
owners.
