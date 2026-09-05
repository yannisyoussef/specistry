# ADR-009: OpenAPI ingestion, acquisition policy, and parser isolation

## Status

ACCEPTED — 2026-09-05

## Context

SPEC-003 turns attacker-controlled or malformed OpenAPI material into trusted canonical artifacts. ADR-002 fixed the pipeline shape and deferred the production resolver/validator choice, the single acquisition boundary, and the containment of parser allocation to this slice. The candidates were evaluated against the corpus, OpenAPI 3.1 semantics, remote-reference controls, maintenance, licensing, and parser-model leakage.

## Problem

Which resolver/validator architecture, source-acquisition boundary, and process model let Specra normalize OpenAPI 3.0 and 3.1 faithfully, deterministically, and safely without a hidden network or filesystem path?

## Constraints

- Canonical model v1 is frozen; adapters must fit OpenAPI into it or capability-diagnose.
- Schema identity derives from source path plus JSON pointer, not parser object identity.
- Remote references stay disabled unless every hardened policy test passes.
- Untrusted parsing needs operational containment that an in-process timeout cannot give.
- Diagnostics must be value-free, located, deterministic, and free of machine paths.

## Considered options

1. **`@apidevtools/json-schema-ref-parser` (15.5.1, MIT):** resolvers can be disabled and customized, but it dereferences into cyclic object graphs, loses pointer identity, and amplifies memory; ADR-002 already rejected the dereferenced-tree shape.
2. **`@scalar/openapi-parser` (MIT):** validate/dereference plus a lossy 3.0→3.1 upgrade path; plugin-based file/URL loaders form a second acquisition path; ajv-based with a larger transitive footprint.
3. **`@readme/openapi-parser` / `@apidevtools/swagger-parser`:** the former's repository was archived in February 2025 and folded into another monorepo; the latter validates 3.0 only. Both dereference.
4. **`ajv` 8 with the official OAS meta-schemas:** structural validation only, code generation through `new Function`, a second error grammar to map, and redundant with the typed extraction normalization must perform anyway.
5. **`@hyperjump/json-schema` (1.17.5, MIT):** the strongest 2020-12/OAS validator, but it retrieves unknown `$ref` URIs itself unless every document is pre-registered, which is precisely the hidden loader §13 forbids; heavier transitive graph.
6. **Adapter-private resolver and typed-extraction normalizer over `yaml`:** more code to own, but pointer identity, dialect fidelity, one acquisition port, value-free diagnostics, no code generation, and a minimal supply chain.

## Decision

Keep `yaml` 2.9.0 (aliases disabled, tags rejected, duplicate keys detected in one linear pass rather than through the parser's quadratic option, strict, byte/depth/node/string bounded, nesting pre-checked before composition) and implement the resolver, source validation, and normalization inside `@specra/openapi` (option 6). The adapter has no filesystem or network access: every byte arrives through one `SourceAcquisition` port keyed by a project-relative POSIX document id that the adapter first confines lexically. The CLI implements that port on top of the SPEC-002 path policy (canonical root, real-path ancestry, file type, byte ceilings before and after reading) and is the only package allowed to import filesystem, network, or process-boundary modules; the architecture gate enforces this with self-tests.

Ingestion runs in a bounded child process using the generalized SPEC-002 host protocol: fresh detached process and group, V8 memory/stack hints (2 GiB heap, 4 MiB stack, matched to the measured evidence ceiling), captured and capped stdout/stderr, one bounded fd3 frame, hard timeout, cancellation, tree termination, and pipe teardown. The parent revalidates every frame field and re-parses the canonical artifact through the model before trusting it. Remote references are disabled: any `http`/`https` reference is diagnosed and never fetched, and a normal build is reproducible offline. The optional hardened remote mode from ADR-002 is not implemented in this slice.

The build artifact directory contract (`manifest.json` alongside `documentation.json`) lives in `@specra/model` as an additive export so the reader slice can consume artifacts without depending on the CLI. Normalization projects both dialects into model v1 without a lowest-common-denominator path, links a capability diagnostic to every unrepresentable construct, and uses a collision ledger so canonical identities never depend on encounter order. Diagnostics use one grammar, `scope[#pointer]`, and carry error or warning severity; warning-only results succeed.

## Rationale

Every library option either materialized dereferenced trees, upgraded dialects lossily, or performed its own URI retrieval. Since model v1 requires pointer-identity registries and per-construct capability decisions, the adapter must inspect every construct regardless; owning that code removes the library's shape and loader from the trust boundary instead of fighting them. Process separation is the only portable way to contain synchronous parser allocation and hangs from Node.

## Consequences

- Positive: no hidden loader, deterministic identities and bytes, explicit support surface, value-free located diagnostics, and containment that also covers native blocking work.
- Negative: structural validation is scoped to the documented support matrix rather than the complete OAS meta-schema; unsupported constructs diagnose instead of failing conformance checks. A validator such as `@hyperjump/json-schema` may later serve as a development-only conformance oracle over the fixture corpus.
- Negative: the child process is operational isolation, not a sandbox; Node cannot impose a strict OS memory ceiling portably, so V8 hints plus measured termination are the containment.
- Negative: any parseable file under the project root can be referenced by a spec; confinement is to the root, not to the entry document's subtree, and the threat model records the resulting publication risk. A `JSON.parse` fast path for JSON sources was measured (roughly five times less parser heap) but not adopted, to keep one parser path and one duplicate-key policy for both syntaxes.
- Neutral: `specra dev` remains reserved until the reader integration gives it something to serve.

## Security implications

Path confinement is re-checked at read time, so a file replaced between validation and read still fails closed. Byte ceilings apply before parsing, and depth/node/string/document/reference/operation/example/diagnostic budgets bound the rest. Diagnostics never carry source values, absolute paths, or exception text. Residual risks are recorded in the threat model: a host blocked in synchronous work when its parent is force-killed survives until that work returns, and a trusted config remains trusted build code.
