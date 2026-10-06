# Code samples and SDK mappings

Specistry shows two kinds of code on every operation page (SPEC-008):

- **Protocol examples**: cURL, raw HTTP, JavaScript, TypeScript, Java, and
  Python requests generated from the canonical operation. They are
  projections of the contract, never of an SDK.
- **SDK examples**: code the project author wrote for a declared SDK and
  mapped to an operation explicitly. Specistry renders it verbatim and never
  infers, generates, or executes SDK calls.

The two share the Code rail and the code surface; they never share semantic
authority. This document is the reference for both.

## Architecture

```text
canonical operation (documentation.json)
  → request projection (@specistry/snippets, at build time)
      path · query · headers · cookies · bodies · auth alternatives · usable servers
  → snippets.json (+ manifest record with digest)
  → reader (server render): environment/body/auth selection → six generators
  → Code rail: one panel per language, selected in the browser

specistry.config.ts `sdks` + example files
  → validated, resolved to canonical operation identity, highlighted (build)
  → snippets.json `sdkExamples`
  → Code rail SDK panels
```

`@specistry/snippets` depends on `@specistry/model` only. The generators are pure:
the same projection, environment, and selection always produce the same
text; nothing reads the clock, the environment, or the network. Generation
runs on the server when an operation page renders and is memoized per
artifact digest; no generator code ships to the browser (the bundle gate
fails if one does).

## Guarantees

| Language   | What it uses                                      | Guarantee                                                                                                                                     |
| ---------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| cURL       | `curl` with long options                          | Every argument is single-quoted (`'` becomes `'\''`); options in a fixed order; passes `bash -n`; hostile values cannot run commands          |
| HTTP       | HTTP/1.1 request as documentation                 | One request line, `Host`, headers, blank line, body; no `Content-Length` or framing claims; header values never contain CR/LF                 |
| JavaScript | platform `fetch`                                  | No third-party dependency; literal URL; passes `node --check` as an ES module                                                                 |
| TypeScript | `fetch` with `RequestInit`, `Response`, `unknown` | Same request as JavaScript plus explicit types; `declare const file: Blob` for uploads; type-checks against `lib.dom`; no invented interfaces |
| Java       | `java.net.http.HttpClient` (Java 17 text blocks)  | JDK only; multipart assembled from byte arrays; compiles with `javac` inside a method                                                         |
| Python     | `requests` (comment notes `pip install requests`) | One call; the serialized URL is passed literally; parses with `ast`                                                                           |

Every example is a **request example**: it shows how to send the request
with placeholders, not a copy-paste production client. The reader says so
under the rail and never labels anything "live".

## Environments

The base URL comes from, in order:

1. `environments` in `specistry.config.ts` (author order; the first is the
   default). Names are identifiers (`[A-Za-z0-9][A-Za-z0-9._~-]*`).
2. Otherwise the contract servers the operation applies to, with server
   variables replaced by their defaults, when the URL passes the same policy
   as configured environments (absolute `https`, or `http` on loopback; no
   credentials, query, or fragment). Unusable servers produce the
   `SNIPPET_SERVER_UNUSABLE` warning.
3. Otherwise the explicit placeholder `<BASE_URL>`.

The rail's Environment selector offers exactly these; there is no free-text
destination and selecting one sends no request.

## Parameters

Parameters are ordered path, query, header, cookie, each in declaration
order. Deprecated optional parameters are omitted. Serialization follows
the canonical style, explode, and allowReserved semantics:

| Location | Styles                                          | Notes                                                                                                                                |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| path     | simple, label, matrix (explode or not)          | values percent-encoded to unreserved characters; placeholders stay `<INBOX_ID>`                                                      |
| query    | form, spaceDelimited, pipeDelimited, deepObject | form encoding; `allowReserved` keeps `:/?@!$'()*,;=[]` but always encodes `&`, `#`, `+`, `%`, and space so a value cannot add a pair |
| header   | simple (explode or not)                         | names must be HTTP tokens (`SNIPPET_HEADER_SKIPPED` otherwise); values are single lines                                              |
| cookie   | form                                            | rendered as one `Cookie` header (`--cookie` in cURL, `cookies=` in Python)                                                           |

Header composition is deterministic: parameter headers, then the security
scheme, then the body's `Content-Type`; a later header replaces an earlier
one with the same case-insensitive name.

## Example values and placeholders

Values are chosen in this order: an explicit example → the schema default
→ `const` → the first enum member → a schema-shaped placeholder (strings
by format: `user@example.com`, `2024-01-01T00:00:00Z`, `https://example.com/resource`,
a zero UUID; otherwise `string`, `0`, `false`). Path and query strings
without a better source become named placeholders (`<STATUS>`).

Redaction is deliberate and conservative: a parameter or property whose
name contains a credential word (`apiKey`, `token`, `password`, `secret`,
`session`, `authorization`, …) becomes `<YOUR_…>` regardless of the contract
example, and so does any value shaped like a known credential (`sk_live_…`,
`AKIA…`, a JWT, a PEM block, a long opaque token). Every string is
sanitized: control characters, line separators, and bidirectional
formatting characters are removed before generation.

## Request bodies

| Media type                          | Representation                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `application/json` and `+json`      | The first non-empty contract example, otherwise a bounded example projected from the schema in request context |
| `multipart/form-data`               | Fields in schema order; binary fields and `encoding` content types become file parts with `/path/to/file`      |
| `application/x-www-form-urlencoded` | Percent-encoded `name=value` pairs                                                                             |
| `text/*`                            | The example text                                                                                               |
| `application/octet-stream`, images… | A file placeholder (`--data-binary '@/path/to/file'`, `BodyPublishers.ofFile`, `open(..., "rb")`)              |
| anything else (XML, YAML, …)        | The example as given, else `<REQUEST_BODY>`                                                                    |

Schema examples never emit `readOnly` properties, list required properties
first, close recursion (`"children": []`, `"parent": {}`), pick the first
`oneOf`/`anyOf` variant and set its discriminator value, merge `allOf`
objects, and stop at 120 nodes and 6 levels (`SNIPPET_BODY_TRUNCATED`
warning). Arrays show one item.

When an operation accepts several media types the rail offers a Body
format selector; the first media type in canonical order is the default.

## Authentication

The operation's security requirement is OR-of-AND. The rail generates one
alternative at a time (the first, in canonical order, by default) and offers
an Authentication selector when there are several; schemes joined with AND
are all applied. Representation per scheme:

| Scheme                         | Representation                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| bearer, OAuth 2.0, OpenID      | `Authorization: Bearer <YOUR_ACCESS_TOKEN>` (scopes appear as a comment)                                                              |
| basic                          | `--user '<USERNAME>:<PASSWORD>'`, `btoa("<USERNAME>:<PASSWORD>")`, `Base64…`, `auth=(…)`; raw HTTP shows `Basic <BASE64_CREDENTIALS>` |
| other `http` schemes           | `Authorization: <Scheme> <CREDENTIALS>`                                                                                               |
| API key in header/query/cookie | `<YOUR_API_KEY>` in the declared place                                                                                                |
| mutual TLS                     | `--cert`/`--key` placeholders in cURL, `cert=(…)` in Python, a comment elsewhere                                                      |
| empty alternative              | no authentication                                                                                                                     |

No credential is ever acquired, stored, or read from the environment.

## Escaping

Escaping is a security boundary and is tested with a hostile corpus in
every input position (shell metacharacters, quotes, `${…}`, CRLF, `</script>`,
bidi controls, path traversal, credential shapes):

- shell: single quotes, never interpolated; a fake `curl` proves the
  generated command runs nothing else;
- JavaScript/TypeScript: JSON string literals with ` `, ` `, and
  `</` escaped;
- Java: escaped string literals and text blocks with `\` and `"""` escaped
  and a trailing line continuation;
- Python: escaped double-quoted literals;
- URLs: the authority always comes from the validated environment; path
  literals and values are percent-encoded so nothing can add a query,
  fragment, or userinfo.

## The Code rail

On operation pages the rail shows a Code heading, a Protocol or Protocol ·
SDK eyebrow, the selectors, one language control (a native select with
Protocol and SDK groups), the selected example with its copy control, the
contract's first success-response example when it has one, and the
placeholder note. The language choice is remembered for the browser session
(sessionStorage, nothing sent anywhere); environment, body, and auth are URL
query state (`?env=…&body=…&auth=…`), validated on the server, with the
canonical URL unchanged and non-default selections marked `noindex`.

Layout: from 1280 px the rail is a glass panel beside the document (340 px,
380 px from 1440 px, 480 px from 1600 px; the document column never drops
below 600 px); below that it is an inline bordered section after the page
header; below 768 px a fixed bottom bar with a single Code link jumps to it.
Without JavaScript the cURL example is visible, the other languages sit
behind a native disclosure, and the selectors submit with an Apply control.
There is no Try it control: execution is SPEC-009.

Copy controls copy the example text only, are named `Copy <label> example`,
and announce politely; code regions are labelled scrollable groups.

## SDK mappings

Declare each SDK and its examples in `specistry.config.ts`:

```ts
export default defineConfig({
  // …
  sdks: [
    {
      id: "typescript",
      label: "TypeScript SDK",
      language: "typescript",
      package: "@example/sdk",
      coverage: "partial",
      examples: "./sdk/typescript.json",
    },
    {
      id: "java",
      label: "Java SDK",
      language: "java",
      coverage: "complete",
      examples: [
        {
          operation: "createInbox",
          title: "Create an inbox",
          file: "./sdk/java/CreateInbox.java",
        },
        {
          operation: { method: "POST", path: "/inboxes/{inboxId}/wait" },
          code: "client.inboxes().waitForMessage(id);",
        },
      ],
    },
  ],
});
```

| Field                             | Meaning                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                              | kebab-case identity; unique (`SDK_ID_DUPLICATE`)                                                                                                       |
| `label`                           | shown in the language control and panel header                                                                                                         |
| `language`                        | one of `csharp`, `go`, `java`, `javascript`, `kotlin`, `php`, `python`, `ruby`, `rust`, `swift`, `typescript`, `text`; drives highlighting             |
| `package`                         | optional package or artifact name shown beside the example                                                                                             |
| `coverage`                        | `partial` (default) or `complete`: complete SDKs warn for every unmapped operation (`SDK_EXAMPLE_MISSING`)                                             |
| `examples`                        | inline records, or a project-relative JSON file `{ "examples": [...] }`                                                                                |
| `examples[].operation`            | a contract `operationId`, or `{ method, path, service? }`; `service` (the document title or canonical service id) disambiguates multi-service projects |
| `examples[].code` / `file`        | exactly one: inline code, or a project-relative file (≤ 16 KiB, UTF-8)                                                                                 |
| `examples[].title`, `description` | optional text shown with the example                                                                                                                   |

Resolution happens at build time against canonical identity. Diagnostics
(all project-relative and value-free): `SDK_EXAMPLE_TARGET_NOT_FOUND`,
`SDK_EXAMPLE_TARGET_AMBIGUOUS` (add `service`), `SDK_EXAMPLE_DUPLICATE` (one
example per SDK per operation), `SDK_EXAMPLE_CODE_EMPTY`,
`SDK_EXAMPLE_CODE_TOO_LARGE`, `SDK_EXAMPLE_FILE_INVALID` (missing, outside the
project, not a file, or not the expected shape). Errors fail `specistry
validate` and `specistry build`; missing examples of a complete SDK are
warnings. There are no scores or percentages (SPEC-011 owns quality gates).

Behaviour in the reader: SDK panels appear only for operations that have a
mapping; an operation without one shows protocol examples only, with no
empty SDK group and no "not available" filler. SDK code is highlighted at
build time and rendered as text; it is never compiled, executed, or
verified, and the documentation must not claim otherwise.

Search: the labels of the SDKs that carry an example for an operation are
indexed with that operation, so "typescript sdk create inbox" finds it.
There is no standalone SDK result kind (the destination is the operation's
Code rail); package names are not indexed because their tokens would outrank
real matches.

## Artifact

`.specistry/artifacts/snippets.json` (`snippetsVersion` 1): configured
`environments`, per-operation `operations` keyed by `<service id>~<operation id>`,
`sdks`, and `sdkExamples` (highlighted token lines and code). The manifest
records `files.snippets` and `snippets { version, bytes, sha256, operations,
sdkExamples }`; the reader refuses an artifact whose digest, size, or counts
disagree. Serialization is deterministic (sorted keys) and part of the
atomic build: a mapping error removes stale artifacts.

The artifact stores projections, not generated text, so its size is linear
in operations and independent of environments, media types, and
alternatives: about 0.7 KB per TestInbox operation and about 1 KB per
synthetic rich operation (see `tests/performance/snippets-measurements.json`).

## Non-execution guarantee

Nothing in this slice sends a request, acquires or stores a credential,
adds a network origin to the Content Security Policy, or accepts a
destination the build did not validate. The browser suite runs a fake target
API on the fixture's local environment and asserts it receives zero requests
while every control is exercised. Execution is the browser-direct playground
([SPEC-009](playground.md)), which reuses the request projection rather than a second
serializer.

## Extension boundary

- Protocol languages are a closed set; adding one means a generator with
  goldens, syntax validation, equivalence extraction, and security tests.
- Consumers extend SDK coverage through data (`sdks`), never through code
  or callbacks.
- The projection contract (`RequestProjection`, `ResolvedRequest`) is the
  reuse point for the playground.
