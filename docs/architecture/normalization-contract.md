# Canonical normalization contract

This is the executable normalization contract frozen by SPEC-001. The canonical
concepts and public API are detailed in the [model v1 reference](canonical-model.md).

## Semantic stance

The canonical artifact is a documentation projection: it preserves semantics needed to explain and invoke APIs, but it is not a validation engine or a lossless copy of every source vocabulary. An adapter emits `{ model, diagnostics }`. Any unsupported or approximated source behavior creates a stable capability diagnostic linked by ID from an explicit unknown/projection node. Silent narrowing is forbidden.

Keyword-only schemas use the explicit `type-less` node. Its constraint groups apply
only to compatible JSON instance types and never imply a type. Mixed vocabularies are
evaluated by adapters before projection: represented semantics become canonical
fields, while partial, ignored-annotation, unsupported, and invalid dispositions use
the stable [capability diagnostic catalog](model-diagnostics.md). Specra does not claim
JSON Schema validation-engine equivalence.

## Identity

- Normalize identifier comparisons to Unicode NFC without changing displayed author text.
- Project, documentation version, service, operation, parameter, schema, server,
  security-scheme, page, example, and diagnostic IDs are branded concepts. Serialized
  IDs are non-empty URL-safe values of at most 128 characters.
- Prefer a unique `operationId`. Missing IDs receive the deterministic candidate `METHOD <normalized-path>` and a quality diagnostic; collisions are build errors, never suffix-by-encounter-order.
- The globally addressable operation key is `(versionId, serviceId, operationId)`. `operationId` uniqueness is required only within a versioned service so retained API versions can reuse it.
- Schema IDs derive from canonical source identity plus escaped resolved JSON Pointer,
  not parser object identity. Renames/moves are breaking links and surfaced by diffing.
- Diagnostic IDs hash stable code plus canonical source/model location; messages and unsafe values do not affect identity.

## Ordering

- Versions and navigation preserve explicit configuration order.
- Services preserve explicit configuration order.
- Operations sort by normalized path, fixed HTTP method rank, then operation ID unless navigation overrides their presentation.
- Tags used as sets sort by NFC/case-folded key with original spelling retained; configured tag order is a separate presentation input.
- Version, service, page, parameter, server, example, schema composition variant,
  tuple item, enum value, required-property, and explicit property-display arrays
  preserve order where it conveys author intent or output behavior.
- Map-like registry, variable, scope, mapping, property, and extension keys serialize
  in Unicode code-point order. Schema property display order is captured explicitly
  before canonical object-key sorting.
- Diagnostics sort by severity rank, code, canonical source pointer, canonical model pointer, then diagnostic ID.

## Values and defaults

- Only JSON data crosses the artifact boundary: enumerable plain objects, dense arrays,
  strings, booleans, null, and finite numbers.
- Reject `NaN`, infinities, negative zero, `bigint`, functions, symbols, `undefined`,
  sparse arrays, accessors, non-enumerable/symbol properties, non-plain objects, and
  inline object cycles.
- Normalize equivalent URL/method/media/status forms once. Defaults that influence rendering or request behavior are materialized; presentation-only omissions stay omitted.
- Source extensions remain JSON data under their exact names but never alter core behavior without a registered adapter capability.

## Canonical serialization

The artifact declares `modelVersion: 1`. Its canonical serializer emits compact JSON,
deterministically escaped strings, portable numbers, semantic array order as above,
and recursively sorted object keys. A parse/serialize round trip is deeply equivalent,
deeply frozen, and byte-identical. Permutation tests reorder semantically unordered
maps/sets and expect identical bytes while preserving explicitly ordered arrays.

## Diagnostics safety

Codes and catalog messages are stable and value-free. Canonical pointers are RFC 6901
escaped, bounded, control-free, and never include credentials or source excerpts.
Adapters correlate source-specific locations outside the artifact. Author labels are
never interpolated into diagnostic identity or messages and must be escaped separately
at log/CI presentation boundaries.

## Compatibility

Model v1 is frozen by SPEC-001. Additive optional fields may be compatible;
removed/renamed fields, identity/ordering changes, closed-union changes, or semantic
changes require a new model version and deterministic migration or rebuild. Readers
reject unknown future model versions with a stable diagnostic.

## Boolean, composition, and registry semantics

- `any`, explicit `true`, and explicit `false` remain distinguishable nodes.
- `allOf`, `anyOf`, `oneOf`, and `not` preserve composition intent and variant order;
  `allOf` is never flattened by the canonical layer.
- Discriminators express a property plus value-to-schema mapping, independent of a
  source object's syntax.
- Direct, indirect, array-contained, and composed recursion uses service-owned
  registry IDs. Inline cycles and unresolved registry links are invalid.

## Budgets

`DEFAULT_MODEL_LIMITS` centralizes positive safe-integer ceilings for traversal depth
(128), total nodes/values (500,000), entries in one collection (100,000), and string
length (1,000,000 JavaScript code units). These limits protect canonical validation
and serialization; adapter parse/process/acquisition limits remain separate.
