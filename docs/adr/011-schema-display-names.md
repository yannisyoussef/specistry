# ADR-011: Schema display names in canonical model v1

Date: 2026-09-05

Status: Accepted

## Context

Schema registry identities (`SchemaId`) are deterministic hashes of the source document
and pointer (ADR-002), which keeps them stable and source-independent but opaque. The
SPEC-004 reader could therefore only describe a referenced schema by its shape
("object", "array of object") unless the author had written a `title`, which the
fixtures and most real contracts do not. SPEC-005 needs `User`, `Address`, and
`Payment` at every reference, variant, discriminator mapping, and recursion marker,
and it must not reach into OpenAPI vocabulary (`components.schemas.User`) to get them.

Three options were weighed:

1. Derive names in the reader from the ID. Impossible: the ID is a hash.
2. Reuse `title`. Wrong semantics: `title` is author prose and is optional; a reader
   would still fall back to shapes for most references.
3. Add an optional, presentation-only `name` to schema metadata, set by adapters on
   registry entries from the source's own definition key.

## Decision

Option 3. `SchemaMetadata.name?: string` is an additive optional field in model v1.
Adapters populate it for registry nodes only: the OpenAPI adapter uses the
`components.schemas` key, a `$defs`/`definitions` key, the top-level key of a
definitions-only document, or the file stem of a whole-document reference. Sub-schemas
reached through deeper pointers stay unnamed. The value is data, not identity: it does
not participate in `SchemaId`, ordering, or collision detection, and two registry
entries may share a name. The validator accepts only non-empty strings.

## Consequences

- Artifacts built before this change remain valid. Artifacts built after it are
  rejected by validators that predate it, so `@specra/model` is upgraded before the
  CLI in any consumer that pins both.
- The reader presents references, variants, and recursion by name, falling back to
  `title` and then to the shape when a name is absent, and never displays a raw ID.
- Names that collide inside one registry are shown as they are; the reader relies on
  IDs for navigation and does not invent suffixes.
- Model version stays 1. A future breaking change to naming would follow the model
  versioning policy in the canonical model reference.
