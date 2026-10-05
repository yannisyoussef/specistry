# ADR-015: Browser-direct playground policy and execution boundary

## Status

Accepted (SPEC-009). Implements the model chosen in
[ADR-005](005-playground-networking-and-credentials.md).

## Context

ADR-005 chose browser-direct execution over any proxy. SPEC-009 has to turn
that into code without creating the boundaries the decision refused: no
route that forwards, no destination the reader can type, no credential the
server or an artifact ever holds, and no response the page interprets as
HTML. It also has to reuse SPEC-008's request projection so the request a
reader sends is the request the code examples describe, and it has to keep
the Code rail and every non-API page exactly as they were.

## Decision

1. **Execution is a build-time policy, not a runtime choice.** `specra
build` projects `playground.json` from the canonical artifact and the
   snippets projection: the approved environments as exact origins, clamped
   limits, and one bounded form plus a browser-capability verdict per
   operation. Approval is a separate configuration list
   (`playground.environments`) from the environments used by the examples;
   the default is disabled. The reader trusts the policy only after the
   manifest digest, size, and counts match and a strict parser admits it;
   the parser fails closed on non-exact origins, wildcards, limits above the
   hard maximums, and schemes marked executable that the browser cannot
   produce.
2. **One package, two entries.** `@specra/playground` depends on
   `@specra/model` and `@specra/snippets` only. Its build entry (form
   projection, capability analysis, policy, artifact contract) runs in the
   CLI and the reader server. Its `./client` entry (destination assertion,
   memory-only credential vault, request builder, bounded executor,
   redaction) is the only module allowed to call `fetch` and is imported by
   exactly one client island. The architecture gate and a security test keep
   the server side free of the client entry.
3. **Exact destination, asserted before every fetch.** The URL is composed
   through the shared SPEC-008 serializer from the approved base URL, the
   path template, and the user's values, then re-parsed: protocol,
   hostname, port, and origin must equal the approved origin, userinfo and
   fragment must be empty, the normalized path must stay under the base
   path, and the length must fit the budget. The CSP's `connect-src` names
   `'self'` and the approved exact origins on API routes only.
4. **Hardened, single, explicit request.** `mode: "cors"`, `credentials:
"omit"`, `redirect: "error"`, `cache: "no-store"`, `referrerPolicy:
"no-referrer"`, one `AbortController` shared by the timeout and Cancel,
   no retry, a streaming body read that stops at the limit, and a plain-data
   result: status, bounded sanitized headers with credential headers masked,
   and a body that is text, JSON text, binary metadata, or empty. The page
   renders the body as a text node inside `pre`; images and HTML are never
   rendered.
5. **Capability analysis at build time, never on Send.** Query and cookie
   API keys, mutual TLS, other HTTP schemes, cookie parameters, and forbidden
   request headers are unsupported; bearer, OAuth 2.0 and OpenID Connect
   tokens, header API keys, and basic are supported. An OR alternative is
   usable only if every AND-joined scheme is supported; the reader explains
   the rest and renders reasons instead of a form for an unsupported
   operation.
6. **Memory-only credentials, keyed by environment and scheme.** The vault
   is a `Map` owned by the island; nothing touches storage, cookies, the
   URL, or the server, and the only persisted value is the non-secret
   environment id in `sessionStorage`. Switching environments switches
   credentials; reload discards them.
7. **The Code rail is unchanged without a policy.** The `Code | Try it`
   control exists only when the build approved at least one environment;
   the Try it island loads on first activation; without JavaScript no Try it
   control renders.

## Consequences

- Positive: no SSRF surface, no credential custody, static-compatible,
  auditable destinations (the CSP and the policy artifact list them), one
  serializer for examples and execution, ordinary pages pay nothing.
- Negative: APIs without CORS for the documentation origin cannot execute
  from the page; browsers hide `Set-Cookie` and non-exposed headers; cookie
  and query credentials are excluded by design.
- Neutral: the fake target API used by the browser suites is a test asset,
  not a product component; the config surface is four fields.

## Alternatives rejected

- A CORS fallback through the reader server (an implicit proxy; refused by
  ADR-005 and by the roadmap's dedicated-proxy gate).
- A destination or base-URL input on the page (arbitrary destination).
- Storing credentials in `sessionStorage` for convenience (deferred to a
  clearly labelled future opt-in per the architecture document; not in this
  slice).
- Retrying idempotent requests automatically (surprising network activity
  from a documentation page).
