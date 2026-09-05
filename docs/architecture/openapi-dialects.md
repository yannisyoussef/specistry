# OpenAPI 3.0 and 3.1 dialect map

OpenAPI ingestion is parser-only in Phase 0. SPEC-003 must prove these mappings with paired golden fixtures before support is described as correct.

| Concern                 | OpenAPI 3.0                                         | OpenAPI 3.1 / JSON Schema 2020-12                   | Canonical rule to prove                                                                         |
| ----------------------- | --------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nullability             | `nullable: true` modifies a typed schema            | `null` participates in `type` arrays or applicators | Normalize allowed null without treating absence as nullable                                     |
| Boolean schema          | Not supported as a Schema Object                    | `true` and `false` schemas                          | Preserve explicit boolean schema nodes                                                          |
| Exclusive bounds        | Boolean flag paired with minimum/maximum            | Numeric `exclusiveMinimum`/`exclusiveMaximum`       | Convert 3.0 pairs; diagnose invalid pairings                                                    |
| `$ref` siblings         | Reference Object siblings generally ignored         | Schema `$ref` siblings are evaluated                | Apply dialect/context rules before canonical projection                                         |
| Tuples                  | Array `items` patterns are limited/dialect-specific | `prefixItems` plus `items`                          | Preserve prefix and additional-item behavior                                                    |
| Type arrays             | Not supported                                       | Multiple types are allowed                          | Do not narrow to the first type; model or capability-diagnose                                   |
| `const`                 | Not supported directly                              | Any JSON value                                      | Preserve arrays/objects and finite JSON numbers                                                 |
| `enum`                  | Values constrained by 3.0 schema vocabulary         | Any JSON values under JSON Schema                   | Preserve values and source order without coercion                                               |
| Keywords without `type` | Schema subset often interpreted structurally        | Assertions/applicators do not imply instance type   | Emit `type-less`; constraints apply conditionally and imply no type                             |
| Schema dialect          | Fixed OpenAPI schema dialect                        | `jsonSchemaDialect` and per-schema dialect behavior | Project represented semantics; capability-diagnose partial/ignored/unsupported/invalid behavior |
| `examples`              | Schema `example` plus media examples                | JSON Schema `examples` plus OpenAPI examples        | Preserve source/context and do not execute content                                              |
| Body encodings          | Multipart/form Encoding Objects                     | Multipart/form Encoding Objects                     | Preserve per-property content type, headers, and serialization                                  |
| Webhooks/callbacks      | Callbacks supported                                 | Callbacks plus top-level webhooks                   | Keep source-specific until canonical event use cases are justified                              |

The resolver also distinguishes Schema Objects from Reference Objects, retains source locations, handles local cycles by graph identity, and never retrieves a remote reference merely because parsing found its URL.

The canonical decisions above are frozen by SPEC-001. SPEC-003 remains responsible
for proving each adapter mapping against paired dialect fixtures; it may not change
model semantics or silently coerce unsupported vocabulary.
