# ADR-013: Build-time, self-hosted search

Date: 2026-09-06

Status: Accepted

## Context

ADR-003 decided that indexing happens at build time and that search is a port over versioned `SearchDocument` records with a local index first. SPEC-007 implements that port for the reader. Open questions were the engine, where the projection lives, the artifact shape and its integrity contract, how the browser loads and runs queries, and the privacy posture.

Engines were evaluated against determinism of serialization, browser and Node 24 support, ESM, Unicode handling, field weighting, prefix and fuzzy search, index size, query speed, dependency footprint, security posture (no `eval`), maintenance, and licence:

| Candidate        | Outcome                                                                                                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MiniSearch 7.2.0 | Chosen. MIT, zero dependencies, ESM, ~9 KB gzip in the browser, `toJSON`/`loadJS` serialize a prebuilt index deterministically for a fixed insertion order, custom tokenizer and per-field boosts, bounded prefix and fuzzy matching, BM25+ scoring, no dynamic code. |
| FlexSearch 0.8   | Rejected. Much larger surface (2.3 MB unpacked), opinionated tokenizers with language presets, asynchronous export/import that is awkward to make byte-deterministic.                                                                                                 |
| Lunr 2.3         | Rejected. English stemming and stop words by default, no incremental prefix search without wildcards, slow maintenance.                                                                                                                                               |
| Custom engine    | Rejected. An inverted index with BM25-like scoring, a prefix trie, and edit-distance matching is not clearly simpler than the chosen dependency and would carry its own ranking bugs.                                                                                 |

## Decision

- **Package.** `@specra/search` owns the search document contract, tokenization, projection, indexing, artifact serialization and parsing, and the browser query engine. It depends on `@specra/model` and `@specra/content` (types, navigation flattening, API route identity) and on MiniSearch; never on a Markdown or OpenAPI parser. The `.` entry is build-time; `./client` is browser-safe and depends on the engine only. The architecture gate enforces the edges.
- **Projection.** Documents are derived from the canonical artifact, `content.json`, and `navigation.json` in reading order: authored pages, their h2/h3 sections (route plus heading anchor), API services (multi-service only), groups, and operations. Index fields are title, headings, path, method, identifiers (contract operation id, parameter names, top-level request/response property names, bounded), context, and body (prose, inline code, titles, one-line commands; multi-line code bodies excluded). Examples, enum values, patterns, hashes, and internal ids are never indexed. Schemas have no standalone result kind because they have no global route; property names contribute to the operation record. SDK kinds do not exist until SPEC-008 provides SDK documentation. The kind set is open for later additions (a version field can be added to documents without changing the engine).
- **Tokenization and ranking.** Language-neutral and locale-independent: NFKC, lower case, combining marks removed for matching only; split on non-alphanumerics and camel/Pascal boundaries, keeping both the parts and the joined identifier. No stemming, no stop words. Boosts: title 5, path 4, method 8, headings 3, identifiers 2, context 1.5, body 1. Queries run OR-combined with prefix matching for terms of two or more characters; fuzzy matching (ratio 0.2, at most two edits, terms of four or more characters) is used only when exact and prefix matching finds nothing. Ties break by kind priority (operation, page, section, group, service) then reading order. At most 12 results and at most 3 per page or API group.
- **Artifact.** `search.json` (`searchVersion: 1`, `engine: "minisearch/7"`) carries display documents (id equals position) and the engine's serialized index, with sorted keys. The manifest records `files.search`, the format version, byte size, SHA-256, and document count. Search is generated from the exact artifacts about to be written and is part of the atomic build; a failure removes stale artifacts.
- **Runtime.** The reader validates the artifact at load (digest, size, count, strict parse) and serves it under a content-addressed path (`/search/index.<sha256 prefix>.json`) with immutable caching, so a rebuilt index never collides with a cached one. Every page ships only the header trigger; the palette, engine, and index load on first open. Queries run on the main thread (measured: well under a millisecond for realistic corpora, tens of milliseconds at 1,000 pages plus 10,000 operations); a worker is deferred until evidence requires it. The CSP is unchanged.
- **Privacy.** Queries stay in the browser. Nothing is transmitted, logged, or stored; no telemetry, recents, or analytics exist.

## Consequences

- Search works offline from the deployed site alone and needs no account, service, or configuration.
- Relevance is explainable through fixed boosts and documented policy, and guarded by a committed golden corpus; changing the policy changes the corpus deliberately.
- The artifact grows with the corpus (about 0.5 MB gzip for 1,000 dense pages, more with 10,000 operations); the first open pays a fetch and hydration that is measured in CI. Sharding stays deferred until a corpus proves one index too large.
- Swapping the engine means a new `engine` value and a new artifact version; the projection, document contract, and palette are engine-independent.
