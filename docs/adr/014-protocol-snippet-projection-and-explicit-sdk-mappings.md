# ADR-014: Protocol snippet projection and explicit SDK mappings

## Status

Accepted (SPEC-008).

## Context

The roadmap requires cURL, HTTP, JavaScript, TypeScript, Java, and Python
examples on every operation and explicitly authored SDK examples, with
environment selection, correct serialization, safe placeholders, hardened
escaping, and no request execution. Six generators over a 10,000-operation
contract with several environments, media types, and security alternatives
could multiply into hundreds of thousands of pre-rendered strings, and a
generator that reinterprets the canonical model six times would drift. SDK
examples are a separate risk: a heuristic that turns `operationId` into
`client.inboxes.create()` would document an API nobody shipped.

## Decision

1. **One pure request projection.** `@specra/snippets` depends on
   `@specra/model` only and projects each canonical operation once into a
   `RequestProjection`: serialized path and query pairs, sanitized headers
   and cookies, one bounded body example per media type, the OR-of-AND
   security alternatives, and the contract servers that pass the environment
   URL policy. Selection (environment, body, alternative) resolves it into a
   `ResolvedRequest` with deterministic header composition, and the six
   generators render that. Generation is pure and deterministic; the
   same input always yields the same text.
2. **Projections in the artifact, text on the server.** `snippets.json`
   stores projections (linear in operations, independent of environments),
   and the reader generates the six languages when an operation page renders,
   memoized per artifact digest. Language switching is a client toggle over
   server-rendered panels; environment, body, and alternative are URL query
   state validated on the server. No generator ships to the browser, and a
   bundle gate enforces it.
3. **Explicit SDK mappings only.** `sdks` in `specra.config.ts` declares
   each SDK (id, label, language, optional package, coverage) and its
   examples, inline or in project files, targeting a contract `operationId`
   or `{ method, path, service }`. The build resolves targets to canonical
   identity (`<service id>~<operation id>`), highlights the code, and
   carries it through as data; unknown, ambiguous, duplicate, empty, and
   oversized mappings fail the build, and complete SDKs warn per unmapped
   operation. Specra never infers an SDK call.
4. **Sanitize, then escape, then quote.** Every canonical string that can
   reach code loses control, line-separator, and bidirectional characters
   at projection; credential-shaped names and values become placeholders;
   each generator escapes for its own lexer; the authority of every URL is
   the validated environment. This is verified by goldens, syntax
   validation with the real toolchains, a cross-language equivalence
   matrix, and a hostile corpus with a fake shell `curl`.

## Consequences

- Six languages mean the same request by construction: one serializer, six
  renderers, and an equivalence test that parses each output back.
- Artifact size stays flat as environments and alternatives grow; the
  reader spends microseconds per operation render and caches it.
- SDK coverage is a consumer responsibility expressed as data; the reader
  never shows an SDK panel it was not given. Standalone SDK documentation
  pages and search results are deferred until they have a destination.
- The projection is the reuse point for the browser-direct playground
  (SPEC-009), which must not reinvent serialization.
- Java targets 17 (text blocks) and Python assumes `requests`; both are
  stated in the examples. TypeScript stays intentionally close to
  JavaScript: explicit types, no invented interfaces.
