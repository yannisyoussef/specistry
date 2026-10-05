# Browser-direct playground

The playground lets a reader send one request at a time from their own
browser to an API environment the project explicitly approved, with the
credential they typed, and shows the bounded response. Specra never sees,
stores, forwards, or logs the request: there is no proxy, no relay route,
and no server-side execution. This page is the consumer-facing reference;
[ADR-015](adr/015-browser-direct-playground.md) records the decision and the
[threat model](security/threat-model.md) the controls.

## Enabling it

Execution is disabled by default and is a separate decision from listing an
environment for code examples. An environment configured under
`environments` appears in the Code rail's Environment selector; only the
environments named under `playground.environments` may receive a request.

```ts
export default defineConfig({
  environments: {
    production: { label: "Production", baseUrl: "https://api.example.com/v1" },
    sandbox: { label: "Sandbox", baseUrl: "https://sandbox.example.com/v1" },
    local: { label: "Local", baseUrl: "http://127.0.0.1:8080/v1" },
  },
  playground: {
    mode: "browser",
    environments: ["sandbox", "local"],
    responseLimitBytes: 1_048_576,
    timeoutMs: 30_000,
  },
});
```

| Field                           | Default    | Rules                                                                                                                                                                                                                   |
| ------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playground.mode`               | `disabled` | `browser` enables execution from the reader's browser; nothing else exists                                                                                                                                              |
| `playground.environments`       | `[]`       | Ids from `environments` approved for execution; each must be an exact HTTPS origin (plain HTTP only on `127.0.0.1`, `localhost`, `[::1]`) without credentials, query, fragment, or wildcard; requires `mode: "browser"` |
| `playground.responseLimitBytes` | 1 MiB      | 1 byte to 4 MiB; the body read stops here and the page says the response is partial                                                                                                                                     |
| `playground.timeoutMs`          | 30 000     | 1 ms to 120 000 ms; the request is aborted at the limit                                                                                                                                                                 |

`specra validate` and `specra build` reject an unknown environment id
(`PLAYGROUND_ENVIRONMENT_NOT_FOUND`), a base URL that is not an exact
allowed origin (`PLAYGROUND_ENVIRONMENT_ORIGIN_INVALID`), and environments
without `mode: "browser"` (`CONFIG_INVALID`). Operations the browser cannot
execute are reported as `PLAYGROUND_OPERATION_UNSUPPORTED` warnings and
still render, with an explanation instead of a form.

## What the build produces

`specra build` writes `playground.json`, a policy derived only from the
canonical artifact and the code-sample projection:

- the approved environments as exact origins (`scheme://host[:port]`) with
  their validated base URL and a loopback flag;
- the effective limits, clamped to the hard maximums (4 MiB request body,
  file, and response; 32 request headers of at most 4096 characters; 2048
  characters per parameter; 64 response headers of at most 2048 characters;
  120 s timeout; 8192-character URL);
- for every operation, a bounded form: typed parameter fields with the same
  initial values the code examples show (credential-shaped names blank),
  one editor per request media type, the security alternatives with a
  browser verdict per scheme, and the operation's capability state.

The manifest records the file, its digest and byte size, and the counts.
The reader refuses to serve a policy whose digest, size, or counts differ
from the manifest, and its strict parser rejects any origin that is not
exact, any wildcard, any limit above the hard bound, and any scheme marked
executable that the browser cannot produce. A tampered artifact therefore
cannot widen a destination or a budget.

## What the browser can execute

| Scheme or input                                                               | Browser | Behaviour                                                                                      |
| ----------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| HTTP bearer, OAuth 2.0 access token, OpenID Connect token                     | yes     | `Authorization: Bearer <token>`; the token is typed, never obtained through a flow             |
| API key in a header                                                           | yes     | Sent in the declared header, unless the header is one browsers forbid scripts to set           |
| HTTP basic                                                                    | yes     | Username and password, UTF-8, base64                                                           |
| API key in a query parameter                                                  | no      | Credentials never enter URLs                                                                   |
| API key in a cookie                                                           | no      | Browser JavaScript cannot set `Cookie`; ambient cookies are never sent (`credentials: "omit"`) |
| Mutual TLS                                                                    | no      | Certificates are not managed                                                                   |
| Other HTTP schemes (Digest, custom)                                           | no      | Cannot be produced in the browser                                                              |
| Cookie parameters                                                             | no      | Not sent; a required one makes the operation unsupported                                       |
| Forbidden request headers (`Host`, `Origin`, `Cookie`, `Sec-*`, `Proxy-*`, …) | no      | Not sent; a required one makes the operation unsupported                                       |

Security alternatives keep their OR-of-AND meaning: an alternative is
offered only when every scheme it requires is supported, and the reader
explains each alternative it cannot use. An operation is **executable**,
**partial** (some alternative or optional input is unusable), or
**unsupported** (a required input or every alternative is unusable); the
last renders the reasons in place of the form.

## In the reader

The endpoint rail gains a `Code | Try it` control when the build approved
at least one environment; otherwise it is the plain Code rail. Try it loads
its script on first activation (or from a `#try-it` link, which the mobile
bar uses) and shows the environment selector, the credential inputs for the
chosen alternative, the path, query, and header fields, the body editor, a
redacted preview of the request, and one `Send` control. Sending is always
an explicit action: nothing runs on load, on change, or on retry. `Cancel`
aborts the request; the page cannot undo a request the API already
received, and it says so.

The response card shows the status, duration, byte count, the headers the
API exposes to browsers, and the body as text (JSON pretty-printed when it
parsed completely). HTML is shown as text, never rendered; binary bodies
show their type and size only; a body cut at the limit is labelled
`partial`. Set-Cookie and other headers browsers hide from scripts do not
appear.

## Credentials

Credentials live in the page's memory, keyed by environment and scheme,
for as long as the operation page is open. They are never written to the
URL, `localStorage`, `sessionStorage`, cookies, IndexedDB, the server, an
artifact, the console, or analytics (Specra has none). Switching
environments switches to that environment's credentials, so a sandbox
token is never sent to production; `Clear credentials` empties the vault;
a reload discards it. Credential headers are masked in the preview and in
response header lists. Inputs are `type="password"` with autocomplete off
and a `Show` toggle. The only value the page remembers between reloads is
the selected environment id.

## Destinations and CORS

Every request URL is composed from the approved environment's base URL,
the path template, and the serialized parameters through the same
serializer the code examples use, then re-parsed and checked: protocol,
hostname, port, and origin must equal the approved origin; there must be no
username, password, or fragment; the normalized path must stay under the
base path (so `..` cannot climb out of `/v1`); and the URL must fit the
length budget. A parameter value that would change the destination is
rejected with a message naming it. The page's Content Security Policy
allows `connect-src` for `'self'` and the approved exact origins only, on
API routes only; guides and the home page keep `connect-src 'self'`.

Requests are sent with `mode: "cors"`, `credentials: "omit"`,
`redirect: "error"`, `cache: "no-store"`, and `referrerPolicy:
"no-referrer"`. The API must therefore answer CORS preflights for the
documentation origin: `Access-Control-Allow-Origin` (the exact docs
origin, or `*` since no cookies are sent), `Access-Control-Allow-Methods`,
`Access-Control-Allow-Headers` naming `authorization`, `content-type`, and
any API-key or custom header, and `Access-Control-Expose-Headers` for
headers the response card should list. A refusal shows as a network
failure with this guidance; there is no fallback path. Redirects are refused
at the browser network layer and are reported as a request failure because
Fetch does not distinguish that refusal from CORS or other network errors.

## Limits and failure states

| State            | Cause                                                       | What the reader shows                                     |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Validation error | Missing required value, wrong kind, oversize, unsafe header | Field-level messages; nothing is sent                     |
| Timed out        | No response within `timeoutMs`                              | "Timed out"; the request was aborted                      |
| Cancelled        | The reader pressed Cancel                                   | "Cancelled"; the API may still have processed it          |
| Request failed   | CORS refusal, blocked redirect, DNS, TLS, or network policy | "Request failed" with credential-free possible causes     |
| Partial response | Body longer than `responseLimitBytes`                       | The prefix as text, labelled partial, with the limit note |

## Browser support

Chromium is exercised by the automated suites (desktop and phone
profiles). The island uses standard `fetch`, `AbortController`,
`ReadableStream`, `FormData`, and `TextDecoder`; Firefox and Safari ship
all of them, and the manual evaluation in the [SPEC-009 review](reviews/spec-009.md)
records their behaviour for redirects, CORS refusals, and stream
cancellation. Without JavaScript there is no Try it control at all: the
Code rail and the code examples remain.

## Non-goals

No server proxy or CORS fallback, no arbitrary destination input, no OAuth
authorization flows, no cookie injection, no query-parameter API keys, no
certificate upload, no request or response history, no service worker, and
no analytics. A dedicated proxy, if ever justified, is a separately
deployed component with its own threat model
([roadmap](roadmap.md#deferred-dedicated-proxy)).
