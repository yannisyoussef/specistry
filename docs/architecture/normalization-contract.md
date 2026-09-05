# Canonical normalization contract

This is the design contract for SPEC-001. Phase 0 types are intentionally private and may break while this contract is proven.

## Semantic stance

The canonical artifact is a documentation projection: it preserves semantics needed to explain and invoke APIs, but it is not a validation engine or a lossless copy of every source vocabulary. An adapter emits `{ model, diagnostics }`. Any unsupported or approximated source behavior creates a stable capability diagnostic linked by ID from an explicit unknown/projection node. Silent narrowing is forbidden.

SPEC-001 must choose how keyword-only and mixed-vocabulary JSON Schemas are represented. Until golden tests prove the choice, Specra does not claim complete JSON Schema 2020-12 semantic fidelity.

## Identity

- Normalize identifier comparisons to Unicode NFC without changing displayed author text.
- Documentation version and service IDs are explicit, non-empty, URL-safe configuration/source identities.
- Prefer a unique `operationId`. Missing IDs receive the deterministic candidate `METHOD <normalized-path>` and a quality diagnostic; collisions are build errors, never suffix-by-encounter-order.
- The globally addressable operation key is `(versionId, serviceId, operationId)`. `operationId` uniqueness is required only within a versioned service so retained API versions can reuse it.
- Schema IDs derive from resolved canonical source URI plus escaped JSON Pointer, not parser object identity. Renames are breaking links and surfaced by diffing.
- Diagnostic IDs hash stable code plus canonical source/model location; messages and unsafe values do not affect identity.

## Ordering

- Versions and navigation preserve explicit configuration order.
- Services preserve explicit configuration order.
- Operations sort by normalized path, fixed HTTP method rank, then operation ID unless navigation overrides their presentation.
- Tags used as sets sort by NFC/case-folded key with original spelling retained; configured tag order is a separate presentation input.
- Parameter arrays, server lists, examples, schema composition variants, tuple items, enum values, and required-property lists preserve source order where order conveys author intent or output behavior.
- Map-like registry and extension keys serialize in Unicode code-point order. Schema property display order is captured explicitly before canonical object-key sorting.
- Diagnostics sort by severity rank, code, canonical source pointer, canonical model pointer, then diagnostic ID.

## Values and defaults

- Only JSON data crosses the artifact boundary: plain objects, arrays, strings, booleans, null, and finite numbers.
- Reject `NaN`, infinities, negative zero, `bigint`, functions, symbols, `undefined`, non-plain objects, and inline object cycles.
- Normalize equivalent URL/method/media/status forms once. Defaults that influence rendering or request behavior are materialized; presentation-only omissions stay omitted.
- Source extensions remain JSON data under their exact names but never alter core behavior without a registered adapter capability.

## Canonical serialization

The artifact declares `modelVersion`. Its canonical serializer emits UTF-8 JSON, no insignificant whitespace, deterministically escaped strings, finite normalized numbers, array order as above, and recursively sorted object keys. A parse/stringify round trip must be deeply equivalent. SPEC-001 golden tests reorder semantically unordered source maps and expect identical bytes while preserving explicitly ordered arrays.

## Diagnostics safety

Codes and messages are stable and value-free. Source/model pointers are RFC 6901 escaped, bounded, stripped of terminal controls at presentation boundaries, and never include credentials or source excerpts by default. Optional author labels are structured, length-bounded, and sanitized separately from logs/CI annotations.

## Compatibility

Before the first public release, private model drafts may change. After model v1 freezes, additive optional fields are compatible; removed/renamed fields or semantic changes require a new model version and deterministic migration or rebuild. Readers reject unknown future major models with a stable diagnostic.
