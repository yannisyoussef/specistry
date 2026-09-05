# OpenAPI ingestion reference

SPEC-003 turns the configured OpenAPI 3.0.x and 3.1.x sources into Specra's canonical documentation model v1. `specra validate` runs the complete pipeline without writing anything; `specra build` writes the resulting artifact atomically. This page is the support contract: anything not listed as supported is either projected with a warning or rejected with an error, never silently narrowed.

## Pipeline

```text
configured source files
  → acquisition policy (project-root confined, byte ceiling)
  → bounded YAML/JSON parse (no aliases or tags, unique keys, depth/node/string budgets)
  → document reference graph (project-local files only; remote references rejected)
  → source validation and normalization (dialect-aware)
  → canonical model v1 (validated, canonicalized, deterministic bytes)
  → documentation.json + manifest.json
```

The pipeline runs in a bounded child process with a hard timeout (`--source-timeout`, default 30 s), a 2 GiB V8 heap hint, captured output, and process-tree termination. The orchestrator revalidates every result before trusting it.

## Supported versions

| `openapi` field                        | Support                                     |
| -------------------------------------- | ------------------------------------------- |
| `3.0.x`                                | Supported (OpenAPI Schema dialect)          |
| `3.1.x`                                | Supported (JSON Schema 2020-12 dialect)     |
| `swagger: "2.0"`                       | Rejected: `SOURCE_UNSUPPORTED_VERSION`      |
| `4.x`, `2.x`, none                     | Rejected: `SOURCE_UNSUPPORTED_VERSION`      |
| `jsonSchemaDialect` other than 2020-12 | Warning; schemas are interpreted as 2020-12 |

Referenced files inherit the root document's dialect.

## Source files and references

- Each configured `openapi` entry is one service. Paths are project-relative; the project root is canonicalized and every file is resolved through its real path, so symlinks that leave the root fail with `SOURCE_REFERENCE_OUTSIDE_ROOT` (or `CONFIG_PATH_OUTSIDE_ROOT` for the configured entry itself).
- Sources must be UTF-8 (a byte-order mark is accepted) and parse to a JSON/YAML object. YAML aliases, merge keys, duplicate keys (in YAML and JSON), non-scalar keys, and tags that do not produce plain JSON data (`!!binary`, `!!timestamp`, `!!set`, custom tags) are rejected (`SOURCE_PARSE_FAILED`). Duplicate keys are detected in one linear pass, so mapping width never makes parsing quadratic.
- Local fragment references (`#/components/schemas/User`) and project-local file references (`./schemas/user.yaml`, `../common.yaml#/Address`) are supported. File locations are percent-decoded and normalized before confinement, so encoded traversal is rejected like plain traversal. Any parseable file under the project root may be referenced; the threat model records that a spec author can therefore publish in-root YAML/JSON content into the artifact, so keep secrets outside the project root or the build's source set.
- `$ref` is only a reference where the specification allows a Reference Object or Schema Object. Inside `example`, `examples[*].value`, `default`, `const`, `enum`, and `x-*` extensions it is opaque JSON data and never triggers acquisition.
- A file that resolves to a differently spelled real path (for example `OPENAPI.yaml` on a case-insensitive filesystem) is treated as unresolved, so results do not depend on the host filesystem.
- Remote references (`http:`/`https:`) are **disabled**: they produce `SOURCE_REFERENCE_REMOTE_DISABLED` and are never fetched. A normal build is reproducible offline. Other schemes, protocol-relative URLs, backslashes, null bytes, and non-pointer fragments (`#anchor`) produce `SOURCE_REFERENCE_UNSUPPORTED`.
- Missing files or pointers produce `SOURCE_REFERENCE_UNRESOLVED`; Reference Object chains longer than 32 hops or cyclic chains produce `SOURCE_REFERENCE_INVALID`. Schema cycles (direct, indirect, through arrays or compositions) are supported through registry references and always terminate.

## Support matrix

Dispositions follow the canonical model catalog: represented, projected (faithful canonical form), partial (`SOURCE_PARTIALLY_REPRESENTED` warning), unsupported (`SOURCE_UNSUPPORTED_SEMANTIC` warning, core retained), or invalid (`SOURCE_INVALID` error).

### Document and operations

| Construct                                                                                                   | Disposition                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info.title` / `info.description`                                                                           | Represented (service name/description); missing title is invalid                                                                                                                                          |
| `info.version`, `info.summary`, `info.contact`, `info.license`, `info.termsOfService`, root `tags` metadata | Not carried into model v1 and not diagnosed: they are inert metadata that would warn on every document; documentation versioning arrives in SPEC-010                                                      |
| `servers` (root, path, operation)                                                                           | Represented; a server's identity derives from its full content (URL, description, variables), so identical servers share one identity regardless of level or order; variables must match the URL template |
| `paths`, path-level parameters/servers                                                                      | Represented; operation-level entries override by name and location; a duplicate name/location pair within one list is invalid                                                                             |
| Servers when `servers` is absent or `[]`                                                                    | No server is synthesized (the specification's `/` default is a client concern); an explicit empty list overrides inherited servers                                                                        |
| Path item `$ref`                                                                                            | Represented; operations declared beside the `$ref` are invalid, other siblings are partial                                                                                                                |
| 3.1 Reference Object `summary`/`description`                                                                | Represented: the override replaces the target's value for parameters, request bodies, responses, headers, and examples; 3.0 siblings are partial                                                          |
| `operationId`                                                                                               | Retained as `contractId`; duplicates are errors (`SOURCE_DUPLICATE_OPERATION_ID`)                                                                                                                         |
| Missing `operationId`                                                                                       | Canonical id derived from method plus exact path; never fabricated as a contract id                                                                                                                       |
| `summary`, `description`, `tags`, `deprecated`, `x-*`                                                       | Represented; duplicate tags are invalid                                                                                                                                                                   |
| `responses` (codes, `1XX`–`5XX`, `default`)                                                                 | Represented; a response without `description` or an operation without responses is invalid                                                                                                                |
| `requestBody`, media types, examples                                                                        | Represented; invalid or duplicate media types, a body without `content`, and `example` beside `examples` are invalid                                                                                      |
| `encoding` (multipart, form)                                                                                | Represented (content type, headers for multipart, style/explode/allowReserved)                                                                                                                            |
| Response `headers`                                                                                          | Represented (simple style); `Content-Type` headers are ignored with a warning; `required`, `allowEmptyValue`, `allowReserved` are partial                                                                 |
| Parameters: `schema` or single `content`                                                                    | Represented with location-specific serialization defaults; a parameter with neither is invalid                                                                                                            |
| `Accept`, `Content-Type`, `Authorization` header parameters                                                 | Partial: dropped with a warning, as the specification ignores them                                                                                                                                        |
| `allowEmptyValue`, `allowReserved` off query                                                                | Partial                                                                                                                                                                                                   |
| Equivalent path templates (`/p/{id}` and `/p/{pid}`)                                                        | Both accepted with distinct identities (tracked follow-up)                                                                                                                                                |
| `callbacks`, `webhooks`, `links`, `components.pathItems`                                                    | Unsupported (warning)                                                                                                                                                                                     |
| `externalDocs`, `tags` metadata                                                                             | Ignored annotation                                                                                                                                                                                        |

### Security

| Construct                                                            | Disposition                                                       |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apiKey`, `http` (basic, bearer, …), `oauth2` flows, `openIdConnect` | Represented                                                       |
| `mutualTLS`                                                          | Represented in 3.1; invalid in 3.0                                |
| Security requirements                                                | OR-of-AND preserved exactly; `{}` is an explicit anonymous option |
| Unknown scheme, missing OpenID Connect URL                           | Invalid                                                           |
| Role names on non-OAuth/OIDC schemes                                 | 3.1: partial (dropped with a warning); 3.0: invalid               |

### Schemas

| Construct                                                                                                                                        | 3.0                                                                                                              | 3.1                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `type` string, `format`, `enum`, `title`, `description`, `default`, `deprecated`, `readOnly`, `writeOnly`                                        | Represented; `enum`/`const` values must match the type                                                           | Represented; same                                          |
| `format` without a type or string keyword                                                                                                        | Partial (type-agnostic, cannot be attached)                                                                      | Partial                                                    |
| `nullable: true`                                                                                                                                 | Projected as `anyOf [type, null]`, byte-identical to 3.1                                                         | Unsupported keyword (warning)                              |
| `type: [..]` arrays, `type: "null"`                                                                                                              | Invalid                                                                                                          | Projected as `anyOf` of typed variants; `[]` is invalid    |
| Boolean schemas `true`/`false`                                                                                                                   | Invalid                                                                                                          | Represented                                                |
| `const`                                                                                                                                          | Unsupported (warning)                                                                                            | Represented                                                |
| `examples`                                                                                                                                       | Ignored annotation                                                                                               | Represented                                                |
| `example`                                                                                                                                        | Represented                                                                                                      | Represented                                                |
| `exclusiveMinimum`/`exclusiveMaximum`                                                                                                            | Boolean converted; without bound: invalid                                                                        | Numeric; boolean is invalid                                |
| `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `uniqueItems`, `minProperties`, `maxProperties` | Represented                                                                                                      | Represented                                                |
| `properties`, `required`, `additionalProperties`                                                                                                 | Represented (source property order kept)                                                                         | Represented                                                |
| `items` (schema)                                                                                                                                 | Represented                                                                                                      | Represented                                                |
| `prefixItems` + `items`                                                                                                                          | Unsupported (warning)                                                                                            | Represented as tuple; `[]` invalid; `enum`/`const` partial |
| `contains`, `minContains`, `maxContains`                                                                                                         | Represented                                                                                                      | Represented                                                |
| `allOf`, `anyOf`, `oneOf`, `not`                                                                                                                 | Represented (never flattened)                                                                                    | Represented                                                |
| `discriminator` on a composition                                                                                                                 | Represented; implicit mapping derived from component refs, also when own keywords sit beside one `oneOf`/`anyOf` | Represented                                                |
| `discriminator` on a plain object                                                                                                                | Partial                                                                                                          | Partial                                                    |
| `$ref` with siblings                                                                                                                             | Siblings ignored (annotation per key; `x-*` exempt)                                                              | Annotations attach; other keywords become `allOf`          |
| Property, mapping, scope, or variable named `__proto__`                                                                                          | Ordinary data key                                                                                                | Ordinary data key                                          |
| Keywords without `type`                                                                                                                          | `type-less` node; no type implied                                                                                | Same                                                       |
| No keywords at all                                                                                                                               | `any`                                                                                                            | `any`                                                      |
| `if`/`then`/`else`, `dependentRequired`, `dependentSchemas`, `patternProperties`, `propertyNames`, `unevaluated*`, `$dynamicRef`, `content*`     | Unsupported (warning)                                                                                            | Unsupported (warning)                                      |
| `xml`, `externalDocs`, `$comment`, `$id`, `$schema`, unknown keywords                                                                            | Ignored annotation (inside the artifact only)                                                                    | Same                                                       |
| Keywords inapplicable to every declared type                                                                                                     | Ignored annotation (once per schema)                                                                             | Ignored annotation (once per schema)                       |

Keyword-only schemas never imply a type. Multi-type schemas distribute `enum` values to the matching variant. Object-typed schemas with `enum`/`const` become `type-less` nodes carrying the object constraints.

## Identity

- Operation ids follow the model contract: a URL-safe `operationId` is used directly, other ids hash deterministically, and operations without an id hash their method and exact path.
- Schema registry ids derive from the project-relative source path plus the JSON pointer of the definition, so they are stable across machines and independent of traversal order.
- A collision ledger claims every canonical identity with its exact source identity. Two distinct source entities that normalize to one canonical id fail with `SOURCE_IDENTITY_COLLISION` at both locations; the same operation declared twice fails with `SOURCE_DUPLICATE_OPERATION_ID`; the same document configured twice fails at the configuration entry (`CONFIG_PATH_INVALID`). Reordering the source never changes which entity wins because nothing wins: collisions are errors.

## Limits

Defaults are positive integers applied in a fresh process; exceeding any of them produces `SOURCE_LIMIT_EXCEEDED` at the offending location.

| Budget                                 | Default                                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Bytes per document                     | 10 MiB                                                                 |
| Bytes across all documents             | 20 MiB                                                                 |
| Nesting depth                          | 100                                                                    |
| Parsed nodes per document              | 500,000                                                                |
| One string                             | 1 MiB (the model's 1,000,000 code-unit ceiling is the effective bound) |
| Documents (root plus referenced files) | 64                                                                     |
| `$ref` occurrences                     | 100,000                                                                |
| Operations per document                | 10,000                                                                 |
| Aggregate example and default bytes    | 4 MiB                                                                  |
| Source diagnostics                     | 10,000                                                                 |
| Diagnostic pointer length              | 2 KiB (deeper locations report at the nearest ancestor that fits)      |

The canonical model adds its own frozen ceilings (10,000,000 serialized code units, 500,000 nodes, depth 128), and in practice they are the effective scale bound: a source that parses within the budgets above but normalizes into an artifact beyond the model budget fails with `SOURCE_LIMIT_EXCEEDED` at the root document. Measured policy (see the [performance evidence](development/testing.md#performance-evidence)): 10,000 lean operations (one response each) are accepted; a rich shape (two parameters, a request body, and two responses per operation, about 78 canonical nodes each) is accepted at 6,000 operations and rejected at 10,000; retained documentation text is accepted at 8 MiB of source and rejected at 10 MiB; an 11 MiB document is rejected before parsing; one schema with 40,000 properties is accepted and one with 100,000 is rejected, in JSON and in YAML alike, in under two seconds; two node-dense 9 MiB documents (18 MiB total, 480,000 nodes each) parse within 1.5 GiB of RSS and are rejected at the model budget in under four seconds. Every rejection is deterministic and, at the documented budgets, completes in a few seconds in a fresh process. A canonical projection deeper than the model budget (128) is reported at the root document even when the source is within the nesting budget, because canonical depth can exceed source depth for type-less and multi-type schemas.

## Diagnostics

Every diagnostic has a stable code, a fixed value-free message, a severity (`error` or `warning`), and a path in the unified grammar `scope[#pointer]`:

| Scope           | Meaning                                                     | Example                                   |
| --------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `config`        | `specra.config.ts` data; `*` is a user-chosen record key    | `config#/environments/*/baseUrl`          |
| `cli`           | Command options                                             | `cli#/root`                               |
| `source/<path>` | A source document (project-relative POSIX path) and pointer | `source/schemas/user.yaml#/properties/id` |
| `artifact`      | The artifact directory or a canonical model pointer         | `artifact#/model/versions/0`              |

Errors sort before warnings, then by code, then by path (scope, then pointer segment by segment with numeric segments compared numerically). Warnings never fail a command; errors do.

| Code                               | Severity | Action                                                                    |
| ---------------------------------- | -------- | ------------------------------------------------------------------------- |
| `SOURCE_PARSE_FAILED`              | error    | Fix YAML/JSON syntax, encoding, aliases, duplicate keys, or the root type |
| `SOURCE_UNSUPPORTED_VERSION`       | error    | Use `openapi: 3.0.x` or `3.1.x`                                           |
| `SOURCE_INVALID`                   | error    | Correct the construct at the pointer to the supported specification shape |
| `SOURCE_LIMIT_EXCEEDED`            | error    | Reduce size, depth, references, operations, or examples                   |
| `SOURCE_REFERENCE_UNRESOLVED`      | error    | Create the referenced file or pointer                                     |
| `SOURCE_REFERENCE_OUTSIDE_ROOT`    | error    | Move the referenced file inside the project or remove the symlink         |
| `SOURCE_REFERENCE_REMOTE_DISABLED` | error    | Vendor the referenced document into the project                           |
| `SOURCE_REFERENCE_UNSUPPORTED`     | error    | Use a relative path or JSON-pointer fragment                              |
| `SOURCE_REFERENCE_INVALID`         | error    | Break the reference cycle or point at the right kind of value             |
| `SOURCE_DUPLICATE_OPERATION_ID`    | error    | Make every `operationId` unique                                           |
| `SOURCE_IDENTITY_COLLISION`        | error    | Rename one of the colliding entities                                      |
| `SOURCE_UNSUPPORTED_SEMANTIC`      | warning  | Optional: restructure using supported constructs                          |
| `SOURCE_PARTIALLY_REPRESENTED`     | warning  | Optional: review the projected subset                                     |
| `INGESTION_TIMEOUT`                | error    | Raise `--source-timeout` or reduce the source                             |
| `INGESTION_FAILED`                 | error    | Re-run; report a reproducible failure without secrets                     |
| `ARTIFACT_INVALID`                 | error    | Report: the adapter produced a model the contract rejects                 |
| `ARTIFACT_WRITE_FAILED`            | error    | Check permissions and remove any symlinked `.specra/artifacts`            |

Diagnostics never include source values, exception text, absolute machine paths, or secrets. Canonical capability diagnostics inside the artifact keep their own source-independent locations; the CLI mirrors warnings and errors to source pointers. Pointers are bounded to 2 KiB: a location deeper than that is reported at its nearest ancestor within the bound, so an over-long author key can never turn a diagnostic into a failed ingestion.

## Build artifact

`specra build` writes two files into the fixed `.specra/artifacts` directory:

- `documentation.json`: the canonical artifact, serialized by the model's deterministic serializer (compact JSON, sorted keys, semantic ordering), `modelVersion: 1`.
- `manifest.json`: `artifactFormat: 1`, `modelVersion: 1`, project id/name, the ordered source list with byte sizes and SHA-256 digests, statistics, and diagnostic counts. Its typed contract (`ArtifactManifest`, `parseArtifactManifest`, `serializeArtifactManifest`) is exported by `@specra/model`, so readers consume the directory without depending on the CLI.

Files are written into a staging directory next to the target, then promoted by rename; the previous artifact directory is moved aside and removed only after promotion succeeds. A failed build removes any previous artifact directory so stale output never represents the current input. A symlink at any component of `.specra/artifacts` is refused, a regular file at that path fails configuration validation before ingestion, and a read-only `.specra` fails the write while leaving the previous artifact intact. Artifact bytes contain no timestamps, random identifiers, or machine paths: building the same project twice, in a fresh process, or in a different parent directory produces identical bytes.

## Troubleshooting

- **Unsupported OpenAPI version:** set `openapi: 3.1.0` (or a 3.0.x version); Swagger 2.0 documents must be converted first.
- **Invalid YAML/JSON:** the pointer is `source/<file>` with no fragment; check syntax, remove aliases and duplicate keys, ensure UTF-8.
- **Missing `$ref`:** the pointer names the `$ref` key; verify the file path relative to the referencing document and the fragment pointer.
- **Reference outside project root:** every referenced file, including symlink targets, must live under the project root.
- **Remote ref disabled:** download the document into the project and reference it locally.
- **Source exceeds size limit:** split the document into referenced files (each under 10 MiB, 20 MiB total) or trim examples.
- **Schema capability warning:** the construct is documented but not modelled in v1; the artifact keeps the faithful core.
- **Operation identity collision:** rename one of the two `operationId` values named by the diagnostics.
- **Build cancelled:** re-run; no partial artifact directory is left behind.
- **Parser timeout:** raise `--source-timeout` (up to 600,000 ms) or reduce the source.

## Dependency evaluation

The production resolver/validator decision and the libraries evaluated are recorded in [ADR-009](adr/009-openapi-ingestion-and-source-isolation.md). No new production dependency was added: `yaml` remains the only parser dependency, and the resolver, source validator, and normalizer are adapter-private.
