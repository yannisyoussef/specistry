# Canonical documentation model v1

`@specra/model` is Specra's source-independent documentation projection. It is the
stable boundary between untrusted source adapters and consumers such as readers,
search indexers, snippet generators, and quality rules. It is not an OpenAPI object
model, a JSON Schema execution engine, or UI state.

## Artifact and ownership

A serialized `DocumentationArtifact` contains:

- `model`, whose `modelVersion` is exactly `1`;
- stable, value-free capability diagnostics linked from affected schema nodes.

The hierarchy is project → ordered documentation versions → ordered services.
Services own contract-declared servers, security schemes, operations, and a schema
registry. Authored pages carry route metadata only; content compilation belongs to a
later slice.

Adapters own parsing, dialect evaluation, reference resolution, and conversion into
this model. They must materialize defaults that affect documentation or protocol
behavior and emit a capability diagnostic for semantics that cannot be represented
fully. Renderers and other consumers may derive view/index/request projections, but
must not add source semantics back into the canonical model.

## Identity

All canonical IDs are NFC-normalized, URL-safe, non-empty strings of at most 128
characters. Branded TypeScript types prevent accidental mixing of project, version,
service, operation, parameter, schema, server, security-scheme, page, example, and
diagnostic identities.

Uniqueness scopes are:

| Entity          | Scope                                    |
| --------------- | ---------------------------------------- |
| Project         | Artifact                                 |
| Version         | Project                                  |
| Service         | Version                                  |
| Operation       | Versioned service                        |
| Parameter       | Operation                                |
| Schema          | Service registry                         |
| Server          | Service                                  |
| Security scheme | Service registry                         |
| Page            | Version                                  |
| Example         | Containing example list                  |
| Diagnostic      | Artifact, from code + canonical location |

An adapter preserves a valid explicit operation ID. If none exists,
`createOperationId` hashes the normalized HTTP method/path semantic key. Schema IDs
come from the canonical source identity plus escaped resolved pointer through
`createSchemaId`; they never depend on parser object identity or encounter order.
The non-cryptographic stable hash is an identity mechanism, not a security primitive.
Any duplicate after normalization or hash collision is a build error; suffixing by
encounter order is forbidden.

Reordering source maps cannot change identities. Renaming an explicit entity or
moving a schema to a different canonical pointer intentionally changes identity.

## Operations and transport

Operations retain method, path, title/description, deprecation, tags, parameters,
request body, responses, security requirements, and server references.

Parameters keep `path`, `query`, `header`, and `cookie` locations distinct. A path
parameter must be required and must correspond exactly to a path-template variable.
A parameter uses either a schema plus serialization rules or one media content entry;
those alternatives are never collapsed.

Request and response content is a media-type collection. JSON, multipart, form,
text, binary, and future media types remain distinguishable without prescribing a
renderer. Responses use a structured exact status code, status-class range, or
default status. A body-less response has `bodies: []`; the adapter must not invent a
schema. Response headers preserve their own schema/content and examples.

Servers describe contract URL templates, labels, descriptions, and variables. They
are not configured playground environments and contain no selected environment,
credentials, execution state, or latency.

## Authentication

Security schemes document API keys, HTTP schemes (including basic and bearer),
OAuth 2 flows, OpenID Connect, and mutual TLS. The model does not execute OAuth or
store credentials.

The `security` array is an OR list. Scheme uses inside one requirement are ANDed. An
empty requirement is an explicit anonymous alternative. The validator rejects
missing or duplicate scheme references, so `API key AND mTLS` cannot accidentally
become `API key OR mTLS`.

## Schema projection

Schema nodes deliberately cover documentation semantics rather than copying a source
vocabulary wholesale:

- `any` is an authored/free-form schema accepting any JSON instance;
- `boolean-schema` preserves explicit `true` and `false` forms;
- `scalar` covers null, boolean, integer, number, and string plus relevant constraints,
  enum, const, format, defaults, examples, and read/write/deprecation annotations;
- `object`, `array`, and `tuple` preserve properties/items, additional values,
  containment, cardinality, required properties, and display order;
- `composition` preserves `allOf`, `anyOf`, `oneOf`, and `not` without flattening;
- `ref` points to a service registry ID;
- `type-less` preserves compatible constraint groups without asserting an instance
  type;
- `unknown` represents semantics that cannot be projected faithfully and must link
  at least one diagnostic.

Every schema can link diagnostics and retain bounded JSON annotations/extensions.
An extension is inert data: it cannot change model behavior unless a future accepted
canonical capability defines that behavior.

### Type-less schemas

JSON Schema keywords do not imply a type. A source schema such as `{ minimum: 0 }`
therefore becomes a `type-less` node with numeric constraints and applicable types
`integer` and `number`. It still accepts non-numeric instances according to JSON
Schema keyword applicability; Specra does not narrow it to a number schema.

Mixed compatible groups are explicit. For example, numeric and string constraints
produce applicable types `integer`, `number`, and `string`. The validator derives the
expected applicable-type set from the represented groups and rejects inconsistent
claims. A constraint-free source schema becomes `any`, not an empty `type-less` node.

### Boolean and free-form schemas

Explicit `true` and `false` schemas remain `boolean-schema` nodes so provenance and
meaning survive serialization. `true` is semantically permissive but remains distinct
from an authored `any` projection. `false` rejects every instance and must never become
an empty object.

### Composition and polymorphism

Composition variants preserve source order because explanations and discriminator
mapping can depend on author intent. `not` has exactly one variant. `allOf` is never
eagerly flattened, avoiding lost conflicts, annotations, requirements, and provenance.
Discriminators are the source-independent concept of a property plus value-to-schema
mapping and are valid only for polymorphic `oneOf`/`anyOf` projections.

### Recursion and registry

Each service owns a schema registry keyed by `SchemaId`. All recursive edges are
`ref` nodes; inline object cycles are invalid. Direct, indirect, array-contained, and
composed recursion therefore remain finite JSON. References and discriminator
mappings must resolve within the owning service in model v1. Cross-service resolution
must be normalized into a service-owned registry entry or capability-diagnosed by an
adapter.

## Mixed vocabularies and unsupported semantics

Adapters evaluate source dialect and vocabulary before projection. Every source
semantic receives one of these dispositions:

| Disposition           | Model behavior                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------- |
| Represented           | Canonical field/node preserves the documentation semantic                                    |
| Partially represented | Best faithful projection plus `SCHEMA_PARTIALLY_REPRESENTED`                                 |
| Ignored annotation    | Omitted inert annotation plus `SCHEMA_IGNORED_ANNOTATION`                                    |
| Unsupported semantic  | Affected node links `SCHEMA_UNSUPPORTED_SEMANTIC`; use `unknown` if no faithful core remains |
| Invalid               | `SCHEMA_INVALID_SEMANTIC`, normally with an `unknown` node                                   |

Silent narrowing is forbidden. Diagnostic messages never include the unsupported
keyword value or source excerpt. SPEC-003 will map concrete OpenAPI 3.0/3.1 and JSON
Schema vocabulary into these already-frozen dispositions.

## Ordering and serialization

`serializeDocumentationArtifact` validates first, then emits compact JSON with all
object keys sorted by Unicode code point. It also canonicalizes unordered semantic
collections:

- operations by normalized path, fixed method rank, then ID;
- tags by NFC/case-folded spelling;
- schemas, security schemes, variables, scopes, discriminator mappings, extensions,
  and all other maps by key;
- media content and response headers by their case-insensitive identifiers;
- responses by exact code, range, then default;
- security alternatives and scheme uses by stable semantic key;
- diagnostics by severity, code, canonical path, then ID.

Version, service, page, server, parameter, example, tuple, enum, required-property,
composition-variant, and explicit property-display order is presentation- or
author-significant and remains unchanged. Object property keys still sort canonically;
`propertyOrder` records display order separately.

Reordered semantically equivalent input produces byte-identical output. Parsing a
canonical artifact validates it, canonicalizes it again, and returns a deeply frozen
object. Serializing that result produces the same bytes.

## Validation and resource budgets

The model validates its own invariants independently of adapters. It rejects invalid
IDs, references, path parameters, response statuses, schema shapes, discriminator
targets, auth/server links, duplicate identities, contradictory constraint metadata,
and missing capability diagnostics.

Only JSON-compatible data is allowed. Non-finite numbers, negative zero, `undefined`,
BigInt, functions, symbols, sparse arrays, accessors, non-enumerable data, class
instances, symbol properties, and inline cycles fail closed rather than being silently
dropped by `JSON.stringify`.

`DEFAULT_MODEL_LIMITS` centralizes deterministic ceilings:

| Budget                    | Default   |
| ------------------------- | --------- |
| Traversal depth           | 128       |
| Traversed nodes/values    | 500,000   |
| Entries in one collection | 100,000   |
| JavaScript string length  | 1,000,000 |

Callers may supply stricter positive safe-integer limits. These budgets protect model
validation/serialization only; parser isolation and source acquisition limits remain
adapter responsibilities.

## Compatibility and public API

Model version 1 is frozen by SPEC-001. Additive optional fields may remain compatible.
Removing/renaming fields, changing identity/ordering/semantic meaning, or widening a
closed union incompatibly requires a new model version and either deterministic
migration or artifact rebuild. Readers reject unknown future versions.

The package root intentionally exposes canonical types, identity/diagnostic factories,
validation, canonicalization, serialization, parsing, limits, and the model error.
Implementation helpers and comparators are not exported. There are no runtime
dependencies, browser globals, parser libraries, framework imports, or renderer/search/
snippet/playground fields.
