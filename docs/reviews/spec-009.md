# SPEC-009 review record — Browser-direct playground

Reviews were run on the `feature/SPEC-009-browser-direct-playground` branch
against develop `309e3aa`. Each specialist pass lists findings by severity
(P0 security/correctness/release blocker, P1 major, P2 important, P3 minor)
with their disposition. Completion requires no open P0 and no unresolved P1.

## Principal Engineer self-review

Questions from the slice definition, each answered against the code:

| Question                                            | Answer                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any server proxy, relay, or forwarding route?       | No. `apps/web/app` has three route handlers (theme, search, assets), none fetches; `tests/security/playground.test.ts` walks the tree and fails on any other handler or any `fetch(` in one. The architecture gate allows exactly one module to call `fetch`: `packages/playground/src/client/execute.ts`.                 |
| Can a reader choose a destination?                  | No input exists. Destinations are the environments in `playground.json`, which the reader accepts only when the manifest digest, size, and counts match and the strict parser admits it (exact origin, no wildcard, limits under the hard bound).                                                                          |
| Is configuring an environment the same as approval? | No. `environments` feeds the examples; `playground.environments` (with `mode: "browser"`) approves execution; the default is disabled; the config refine rejects unknown ids, non-exact origins, and environments without the mode.                                                                                        |
| Exact-origin enforcement before every fetch?        | Yes: `composeDestination` re-parses the composed URL and requires equal protocol, hostname, port, and origin, empty userinfo, no fragment, the normalized path under the base path, and the length budget. Destination fuzz covers `//evil.example`, `@evil.example`, `#`, `%2f%2f`, `..`, `%2e%2e`, Cyrillic look-alikes. |
| Credentials persisted anywhere?                     | No. Memory-only vault keyed by environment and scheme; the island never touches `localStorage`, `document.cookie`, or `indexedDB` (source assertion); the only `sessionStorage` write is the environment id; jsdom and browser canaries check storage, URL, cookies, console, and the server HTML.                         |
| Credentials in URLs?                                | Impossible by construction: query and cookie API keys are unsupported at build time and the builder places credentials in headers only.                                                                                                                                                                                    |
| Redirects, retries, timeouts, cancellation?         | `redirect: "error"` refuses the redirect target at the browser network layer; Fetch exposes that refusal as a generic network error, so the UI lists a blocked redirect among the possible causes. No retry path exists; one `AbortController` serves the timeout (fixture 5 s) and Cancel.                                |
| Bounded request and response?                       | Hard limits (4 MiB body/file/response, 32 × 4096 headers, 2048 per parameter, 8192 URL, 120 s) clamp the config; the executor streams and stops at the limit (`truncated`), bounds headers to 64 × 2048 with control/bidi stripping, and never decodes binary.                                                             |
| CSP exact origins only?                             | `connect-src 'self' <sorted exact origins>` on `/api` routes only; the builder's regex admits HTTPS anywhere and plain HTTP on loopback; hostile entries (wildcard, path, userinfo, `;`, query, fragment) are dropped in the security test; guides and home keep `'self'`.                                                 |
| Response HTML executed?                             | Never: bodies are text nodes in `pre > code`; the browser test serves `<script>`/`<img onerror>` HTML and asserts no such nodes, no `window.__pwned`, and an unchanged title. `img-src 'self'` stays.                                                                                                                      |
| One serializer for examples and execution?          | Yes: `@specra/snippets/protocol` re-exports the SPEC-008 serializer (`serialize.ts`, extracted with byte-identical goldens); the request builder and `composeUrl` use it. A path template with `?`, `#`, and spaces composes to the encoded URL under `/v1`.                                                               |
| OR-of-AND preserved?                                | An alternative is usable only if every AND-joined scheme is supported; `createWebhook` (API key AND mTLS, OR OAuth) offers OAuth and explains the mTLS alternative; the compound form test and the fixture assert it.                                                                                                      |
| Race safety?                                        | Requests carry an id; a result is applied only while the phase is `sending` with that id; Cancel and environment switch move the phase first; a late resolution of a superseded request is discarded (jsdom test).                                                                                                         |
| Code rail unchanged without a policy?               | The bar renders the plain `Code` heading and no `rail-modes` role; the edge and multi fixtures (policy disabled) render as before; SPEC-008 browser tests pass with the page-scoped canary.                                                                                                                                |
| Initial JS within budget? Lazy island?              | Operation page 137.7 KiB gzip (budget 150 KiB; +0.6 KiB for the tab control); the Try it island is one lazy chunk, 10.6 KiB gzip under a 24 KiB budget, referenced by no page route; server-only markers (policy parser, diagnostic codes) are absent from client chunks.                                                  |
| No-JS shape honest?                                 | No tablist, no password input, no Try it tab in server HTML; the mobile bar link is hidden by the layout's `noscript` rule; the no-JS browser test asserts all three.                                                                                                                                                      |
| Determinism and scale?                              | `playground.json` is sorted and newline-terminated; the 10,000-operation policy projects in 10 ms, parses in 12 ms, 203 B per operation, 60 KB gzip, and is within 1 KiB whether one or three environments are approved.                                                                                                   |

Defects fixed during the self-review before specialists: the tab panels'
`display: flex` beat the UA `[hidden]` rule (both panels were visible);
the body editor's wrapping `label` folded the textarea's value into its
accessible name (restructured); a missing required form field produced two
errors; `void basic` dead code in the request builder; the unused
`AuthAlternativeForm` import; the fake API in the browser suites is shared
by both projects, so every log assertion filters by a per-test marker and
the page's own request log is the witness.

## Security reviewer

- **P1 (fixed):** a path parameter value of `../../admin` composed to
  `https://api.example.com/v1/inboxes/../../admin`, which the URL parser
  normalizes to `/admin`: still the approved origin, but outside the base
  path. The destination assertion now also requires the normalized path
  to stay under the environment's base path (`base-path` failure), and
  the fuzz covers `..`, `%2e%2e`, and mixed forms.
- **P1 (fixed):** `new URL("https://*.example.com")` parses, so
  `originOf` accepted a wildcard host. The origin derivation, the config
  refine, and the CSP builder now require a DNS-shaped or bracketed IPv6
  hostname; the CSP builder also limits plain HTTP to loopback.
- **P2 (fixed):** the artifact parser rejected any path template with a
  space, `?`, or `#` while the build emitted them for hostile contract
  paths (the edge fixture's `/Inbox rules`), which would have failed the
  reader at start-up. The shared renderer percent-encodes literal
  segments, so the parser now rejects control characters only; a test
  proves `/Inbox rules?/{id}#x` composes to an encoded URL under the base.
- **P2 (accepted):** `Show` reveals a typed credential on request; the
  preview and response headers stay masked. This matches the credential
  policy (the reader typed it) and is keyboard-reachable.
- **P3 (accepted):** browsers report CORS refusals as a generic network
  failure; the page shows the CORS checklist without claiming to know the
  cause. The Strict local fixture proves no credentialed request leaves
  the browser after a refused preflight.
- Verified: credential arrives at the fake target exactly once with no
  cookie or referrer; no request carrying it reaches any other origin; the
  reader server log never contains it; a tampered policy (widened origin,
  wildcard, raised limit, executable cookie scheme, extra `proxy` key) is
  rejected; a hostile HTML response stays text; `Set-Cookie` never
  appears; 80 response headers are cut to 64.

## Frontend architecture reviewer

- **P1 (fixed):** the React compiler lint refused ref reads during render
  for the vault and file map; both are now state-held objects with an
  explicit version counter, which also makes the memoized build honest.
- **P2 (fixed):** `#try-it` from the mobile bar opened the tab but left
  the viewport where it was; on hash navigation the rail scrolls into
  view and the Try it tab receives focus (not on initial load).
- **P2 (accepted):** the Code panel stays server-rendered and is simply
  hidden while Try it is active, so switching back costs nothing and the
  no-JS shape is unchanged.
- Verified: `@specra/playground` depends on model and snippets only; the
  client entry is imported by one island; the server side never imports
  it (gate self-test plus security test); the island is lazy and its
  chunk is not referenced by any route; `RailModes` receives the Code
  panel as children so the rail keeps one markup tree.

## Product / DX reviewer

- **P1 (fixed):** a response from one environment stayed on screen after
  switching to another; switching now clears the result and cancels an
  in-flight request, and the preview shows the new destination.
- **P2 (fixed):** Cancel waited for the fetch to reject before saying
  anything; it now reports "Cancelled" immediately and explains that the
  API may still have processed the request.
- **P2 (accepted):** the environment id is remembered in `sessionStorage`
  (non-secret) so a reader moving between operations keeps their choice;
  credentials are re-typed per page load by design.
- **P3 (tracked):** request/response history, OAuth flows, cookie
  injection, query-key execution, and certificate upload are non-goals;
  the unsupported explanations name the reason in each case.
- Ergonomics reviewed on TestInbox: 21 of 25 operations are executable,
  4 partial (optional cookie parameters, an mTLS alternative), none
  unsupported; the JSON editor starts from the example with credential
  placeholders blanked.

## Accessibility reviewer

- **P1 (fixed):** the body editor's accessible name included its whole
  value (label wrapping a textarea); it is now a sibling label.
- **P2 (fixed):** form and multipart field inputs lacked `aria-invalid`
  and `aria-describedby` for their errors; added.
- **P2 (accepted):** the credential toggle is a `Show`/`Hide` button with
  `aria-pressed`; the input keeps `type="password"` unless revealed.
- Verified: axe clean in jsdom and Chromium with the form and a
  response; tablist with arrow keys and roving tabindex; `Enter` submits
  from a field; polite status announces sending, completion, and cancel;
  44 px controls on the phone profile; forced-colors borders on inputs,
  tabs, and the response card; the sweep animation is off under reduced
  motion.

## QA reviewer

- **P2 (fixed):** the SPEC-008 browser canary bound port 47391 itself,
  which the playground's fake API now owns; the canary reads the page's
  request log instead and still proves zero requests from the Code rail.
- **P2 (fixed):** both browser projects share the fake APIs, so
  log-count assertions raced; assertions filter by per-test markers and
  the page's request log.
- **P3 (accepted):** Firefox and WebKit are not installed on the
  development machine; CI runs Chromium. The island uses `fetch`,
  `AbortController`, `ReadableStream`, `FormData`, and `TextDecoder`,
  all shipped in current Firefox and Safari; the manual evaluation
  below records the expected behaviour and is a release-readiness item
  for SPEC-012.
- Verified: 135 package tests, 12 security tests, 15 jsdom tests, 43
  browser tests (desktop and mobile), 9 new visual baselines, the
  performance evidence, and the full gate set green.

## Cross-browser evaluation

| Behaviour                         | Chromium (automated)    | Firefox (expected)      | Safari (expected)                                            |
| --------------------------------- | ----------------------- | ----------------------- | ------------------------------------------------------------ |
| `redirect: "error"`               | rejected without follow | rejected without follow | rejected without follow                                      |
| CORS refusal                      | TypeError → failure     | TypeError → failure     | TypeError → failure                                          |
| Stream cancel at the limit        | reader.cancel + abort   | same                    | same                                                         |
| `Set-Cookie` visibility           | hidden                  | hidden                  | hidden                                                       |
| Password input autocomplete off   | honoured                | honoured                | may still offer to save; the vault never asks the browser to |
| Private-network access (loopback) | allowed with preflight  | allowed                 | allowed                                                      |

## Disposition

No open P0. All P1 findings fixed on the branch with tests. P2 items are
fixed or accepted with rationale above; P3 items are tracked in the
roadmap's non-goals and the SPEC-012 readiness list.
