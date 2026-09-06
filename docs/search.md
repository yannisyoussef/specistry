# Search

Specra generates search at build time and answers queries in the reader's browser. There is nothing to configure, no account, and no service: `specra build` writes a search artifact next to the other artifacts, the reader serves it, and the ⌘K palette queries it locally. **Search queries remain in the user's browser.** They are never sent to Specra, to the documentation host, or to any third party, and the reader records no search telemetry, history, or analytics.

## What is searchable

| Source                                                                                                                                        | Result kind   | Destination                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------- |
| Authored page (title, sidebar title, description, headings, prose, inline code, one-line commands)                                            | Guide         | `/docs/<slug>` or `/`       |
| Authored `##` and `###` section (heading, the text below it until the next heading)                                                           | Guide section | `/docs/<slug>#<heading-id>` |
| API operation (title, method, path, contract operation id, parameter names, top-level request and response property names, description, tags) | API           | `/api/<group>/<operation>`  |
| API group (tag name, declared description)                                                                                                    | API group     | `/api/<group>`              |
| API service (multi-service projects only)                                                                                                     | API service   | `/api/<service>`            |

Not indexed, by policy: multi-line code blocks (a one-line fence such as `npm install …` is indexed), examples, enum values, patterns, asset names, hashes, diagnostics, internal identifiers, and syntax-highlighting classes. Orphan pages are indexed because they stay URL-reachable and indexable. Internal routes (`/theme`, `/not-found`, `/assets/*`, `/search/*`) never appear. Schemas have no standalone result because the reader has no global schema route; their property names make the operations that use them findable. SDK results appear only once SDK documentation exists (SPEC-008).

## How matching works

Queries and documents are normalized the same way, independent of the machine's locale: Unicode compatibility folding, lower case, and accent removal for matching only (results always display the original text, so `création` matches `creation` and is shown as written). Text splits on anything that is not a letter or digit and on camel-case boundaries, keeping both the parts and the joined identifier: `POST /v1/inboxes/{inboxId}` yields `post`, `v1`, `inboxes`, `inbox`, `id`, and `inboxid`, so `inboxId`, `inbox_id`, `inbox-id`, and `inbox id` all find the same operation. There is no stemming and no stop-word list, so non-English content is treated the same as English.

Ranking is explainable and deterministic. Exact matches in an operation's method and path and in titles weigh most, then headings and identifiers, then context and body. Every term may match (a document matching more of the query ranks higher); prefix matching applies to terms of two or more characters, so `auth` finds Authentication; bounded typo tolerance (`authentcation`) applies only when exact and prefix matching find nothing. Equal scores are broken by kind (operation, page, section, group, service) and then reading order, so the same index and query always return the same order. The palette shows at most 12 results with at most three from the same page or API group, so one page with many headings cannot crowd out other sources. Queries are limited to 200 characters and 12 terms.

The relevance policy is guarded by a committed golden corpus (`tests/search/relevance.json`) so ranking changes are deliberate and reviewed.

## Using search

- Press **⌘K** (macOS) or **Ctrl K**, or use the Search control in the header.
- Type to search; results update as you type. **↑ / ↓** move the selection, **Home / End** jump, **Enter** opens the selected result, **Esc** closes and returns focus to where you were.
- On phones the control opens a full-screen search sheet with a Cancel button; every control is at least 44 px tall.
- Screen readers hear the field as "Search documentation" with instructions, each result as its kind, method or context, and title, and a polite result count once typing pauses.
- Without JavaScript the control is hidden; navigation, the outline, and every page work unchanged.

## The artifact and deployment

`specra build` writes `.specra/artifacts/search.json` (`searchVersion: 1`) and records it in `manifest.json` with its byte size and SHA-256 digest. The bytes are deterministic: the same sources produce the same artifact on any machine. The reader validates the file against the manifest at start-up (digest, size, document count, strict shape, every route a reader route) and refuses to start on a mismatch, so a stale index can never pair with fresh content. It serves the validated bytes under a content-addressed path, `/search/index.<digest prefix>.json`, with `Cache-Control: immutable`; a rebuild changes the path, so browsers never keep an old index. The palette and engine load on first open only; ordinary pages ship no search code beyond the header control.

Index size scales with the corpus. Measured on the TestInbox fixture: 63 documents, 52 KB (12 KB gzip). Measured on synthetic corpora: 1,000 pages produce about 7,000 documents and 0.5 MB gzip; 10,000 operations produce about 10,000 documents and 0.5 MB gzip; both together produce 17,000 documents and 1.0 MB gzip, hydrated in about 70 ms with queries under 25 ms (`tests/performance/search-measurements.json`). Standard HTTP compression on the host applies; no proprietary compression is used.

## Diagnostics

Search adds no validation rules to authoring. `specra validate` reports how many search documents the project produces; `specra build` reports the same and fails with `SEARCH_BUILD_FAILED` (an internal failure that removes stale artifacts) only if indexing itself fails.
