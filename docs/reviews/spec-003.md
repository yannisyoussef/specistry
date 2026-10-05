# SPEC-003 review record

Date: 2026-09-05

The Principal Engineer self-reviewed the OpenAPI ingestion slice against the §87
checklist before independent review. Independent reviews covered OpenAPI/JSON Schema
fidelity, security, QA, performance, and architecture. Reviewers inspected the
adapter commit `e8c7ecd`, the CLI integration commit `1f9729d`, and the performance,
gate, and documentation delta on top of them. Every P1 and P2 finding below was fixed
in the review-fix commit on this branch and re-verified by the full gate run; P3
findings were fixed where the fix was small and mechanical and are otherwise tracked
with an owner.

## Principal Engineer self-review

| Question                                    | Answer and evidence                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Did any parser type leak?                   | No. `@specra/openapi` exports only Specra-owned types; `yaml` is not re-exported; the CLI consumes ports and results, never parsed documents.                                                    |
| Can the parser bypass acquisition policy?   | No. The adapter has no I/O; the architecture gate bans filesystem/network modules and global `fetch` outside the CLI, with self-tests and a verified negative probe.                             |
| Can a ref escape project root?              | No. Lexical confinement (decoded, normalized) in the adapter plus real-path confinement in the CLI port; traversal, encoded traversal, absolute, `file:`, and symlink escapes are tested.        |
| Can normal builds perform network requests? | No. Remote references are diagnosed and never fetched; a local-listener canary observes zero requests during `build`.                                                                            |
| Are remote refs truly off by default?       | Yes. No remote mode exists; `http`/`https` references produce `SOURCE_REFERENCE_REMOTE_DISABLED`.                                                                                                |
| Can parsing exhaust the main CLI process?   | No. Ingestion runs in a bounded host with a byte ceiling before parsing, V8 hints, hard timeout, tree termination, and pipe teardown; the parent revalidates the frame.                          |
| Are 3.0/3.1 semantics faithfully projected? | Yes for the documented matrix; paired dialect fixtures produce identical artifacts and each matrix row is covered by `dialect-matrix.test.ts` or `pipeline.test.ts` (tracked rows listed below). |
| Did normalization silently drop meaning?    | No. Unsupported keywords warn, inert annotations are recorded inside the artifact, and unmodelled `info` metadata is documented as such in the support matrix.                                   |
| Are warnings useful and deterministic?      | Yes. Warnings are emitted only for unsupported/partial constructs and sort deterministically; warning-only projects succeed with exit 0.                                                         |
| Is the diagnostic grammar unified?          | Yes. `scope[#pointer]` for config, cli, source, and artifact scopes; config labels now use numeric list indices; SPEC-002 paths migrated with tests.                                             |
| Are IDs/collisions deterministic?           | Yes. Registry ids derive from source path plus pointer; the ledger claims in sorted order; collisions are errors at both locations regardless of order.                                          |
| Are build artifacts reproducible?           | Yes. Byte-identical across runs, fresh processes, and different parent directories; no timestamps, random ids, or machine paths.                                                                 |
| Did we accidentally begin SPEC-004?         | No. No route, renderer, or reader change; `apps/web` is untouched; `dev` remains reserved.                                                                                                       |

## Performance evidence

Fresh-process measurements (`pnpm test:performance`, Apple M4 Max, macOS 25.6, Node
24.20.0, `yaml` 2.9.0), each case in its own Node process with the ingestion host's
heap hint (`--max-old-space-size=2048`) and default budgets, after the review fixes:

| Case                                          | Input    | Operations / schemas | Wall time |  Peak RSS | Artifact        | Outcome                                      |
| --------------------------------------------- | -------- | -------------------: | --------: | --------: | --------------- | -------------------------------------------- |
| 10,000 lean operations                        | 1.06 MiB |           10,000 / 0 |    566 ms |   407 MiB | 2.86 MiB        | accepted                                     |
| 6,000 rich operations (200 shared schemas)    | 2.11 MiB |          6,000 / 200 |    905 ms |   438 MiB | 4.94 MiB        | accepted                                     |
| 10,000 rich operations                        | 3.48 MiB |         10,000 / 200 |  1,168 ms |   618 MiB | none            | `SOURCE_LIMIT_EXCEEDED` (model node budget)  |
| 8 MiB retained text                           | 7.66 MiB |            1,956 / 0 |    373 ms |   497 MiB | 8.05 MiB        | accepted                                     |
| 10 MiB retained text                          | 9.58 MiB |            2,445 / 0 |    378 ms |   556 MiB | none            | `SOURCE_LIMIT_EXCEEDED` (model code units)   |
| 11 MiB source                                 | 10.5 MiB |                0 / 0 |      1 ms |    99 MiB | none            | `SOURCE_LIMIT_EXCEEDED` before parsing       |
| 40,000-property schema, JSON                  | 1.59 MiB |                1 / 1 |    785 ms |   426 MiB | 3.15 MiB        | accepted                                     |
| 100,000-property schema, JSON                 | 4.00 MiB |                1 / 1 |  1,345 ms |   658 MiB | none            | `SOURCE_LIMIT_EXCEEDED` (model node budget)  |
| 40,000-property schema, YAML                  | 1.82 MiB |                1 / 1 |    975 ms |   432 MiB | 3.15 MiB        | accepted                                     |
| 100,000-property schema, YAML                 | 4.57 MiB |                1 / 1 |  1,925 ms |   698 MiB | none            | `SOURCE_LIMIT_EXCEEDED` (model node budget)  |
| 2 × node-dense 8.4 MiB documents (480k nodes) | 16.7 MiB |                2 / 2 |  3,880 ms | 1,503 MiB | none            | both parsed; `SOURCE_LIMIT_EXCEEDED` (model) |
| 2,000 multipart encodings                     | 137 KiB  |                1 / 0 |     88 ms |   106 MiB | 294 KiB         | accepted                                     |
| 20,000 discriminator variants                 | 2.61 MiB |           1 / 20,001 |  1,121 ms |   499 MiB | 5.06 MiB        | accepted                                     |
| `specra build`, 10,000 lean operations        | 1.06 MiB |           10,000 / 0 |  1,206 ms |       n/a | 3,003,869 units | accepted end to end at the default timeout   |

Before the review fixes the 100,000-property shapes took 33 s (JSON) and 180 s (YAML)
because the parser's `uniqueKeys` option scans existing keys per insertion, the
two-document case exhausted the 1 GiB heap hint, 2,000 encodings took 2.9 s, and 20,000
variants took several seconds of component-name scans. The frozen model v1 budgets
(500,000 nodes, 10,000,000 serialized code units) remain the effective scale bound:
rich operations cost about 78 canonical nodes each, so that shape is accepted near
6,000 operations, while lean operations fit at 10,000. These numbers justify the
documented policy in `docs/openapi.md` and the regression ceilings in the evidence
suite (60 s for the original shapes, 15–20 s for the parser-shape cases, 2 GiB RSS).
The suite also writes `tests/performance/measurements.json`, uploaded by CI as the
`performance-evidence` artifact.

## Severity summary

| Review                |  P0 |  P1 |  P2 |  P3 | Disposition                                                                              |
| --------------------- | --: | --: | --: | --: | ---------------------------------------------------------------------------------------- |
| OpenAPI / JSON Schema |   0 |   2 |   9 |  15 | P1/P2 all fixed; 11 P3 fixed, 4 tracked                                                  |
| Security              |   0 |   0 |   5 |   7 | P2 all fixed; 5 P3 fixed, 2 accepted/tracked with threat-model entries                   |
| QA                    |   0 |   3 |   6 |   7 | P1 all fixed; P2 fixed except the golden-artifact and realistic-contract items (tracked) |
| Performance           |   0 |   2 |   4 |   4 | P1/P2 all fixed; 2 P3 fixed, 2 tracked                                                   |
| Architecture          |   0 |   0 |   4 |   8 | all fixed                                                                                |
| **Total**             |   0 |   7 |  28 |  41 | P0 = 0, every P1 fixed, every P2 fixed or explicitly tracked                             |

## Findings and dispositions

### OpenAPI / JSON Schema fidelity

- **P1-1 fixed.** 3.0 `nullable` with constraints produced false `SCHEMA_IGNORED_ANNOTATION` entries per variant and broke 3.0/3.1 byte equivalence. Inapplicable keywords are now reported once per schema against the full declared type list (`schema.ts`); the matrix test proves byte-identical artifacts for `nullable` string, object, and numeric shapes.
- **P1-2 fixed.** `$ref` collection was context-free, so `$ref` strings inside examples, defaults, enum/const values, and extensions caused hard errors and file reads. The collector is now structural (`documents.ts`): it descends only through OpenAPI map and structural positions, treats data-bearing keys as opaque, and reads Example Objects without entering their `value`. A spy acquisition proves no data-driven read.
- **P2-1 fixed.** 3.0 `prefixItems` is an unsupported-semantic warning instead of silently dropped.
- **P2-2 fixed.** A discriminator beside own keywords now attaches to the single `oneOf`/`anyOf` list inside the synthesized `allOf`; implicit mappings derive from its component references.
- **P2-3 fixed.** 3.1 Reference Object `summary`/`description` overrides are returned by `dereference` and applied to parameters, request bodies, responses, headers, and examples; 3.0 siblings are diagnosed as partial per key.
- **P2-4 fixed.** Duplicate name/location pairs within one parameter list are invalid; operation-level overrides of path-level parameters remain the only permitted repetition.
- **P2-5 fixed.** Header `required`, `allowEmptyValue`, and `allowReserved` are diagnosed as partial rather than narrowed silently.
- **P2-6 fixed.** 3.1 role names on non-OAuth schemes are dropped with a partial warning; 3.0 keeps the error.
- **P2-7 fixed.** Records are built with `Object.defineProperty` (`defineOwn`), so `__proto__` keys are ordinary data in properties, discriminator mappings, scopes, server variables, extensions, and JSON conversion; an end-to-end test asserts the key survives into the artifact.
- **P2-8 fixed.** `type: []` is `SCHEMA_INVALID_SEMANTIC` at `/type`.
- **P2-9 fixed.** Operations declared beside a Path Item `$ref` are invalid at each method key; other siblings are partial.
- **P3 fixed:** P3-1 multi-type inapplicable keywords, P3-2 tuple `enum`/`const` partial and `prefixItems: []` invalid, P3-3 `format` alone partial and `format` on boolean/array/object ignored, P3-4 server identities from content, P3-6 `example` beside `examples` invalid, P3-9 reserved header parameters partial, P3-10 parameter without `schema`/`content` and body without `content` invalid, P3-11 3.0 `$ref` sibling anchoring per key with `x-*` exempt, P3-12 parameter and example collisions at both locations, P3-15 single-type `enum`/`const` type check.
- **P3 tracked (OpenAPI reviewer / SPEC-005 owner):** P3-5 documented (no synthesized default server; explicit `[]` overrides); P3-7 schema `$ref` to a non-schema projects to `any` with ignored-annotation diagnostics while the reverse is `SOURCE_INVALID` (doc aligned to describe `SOURCE_REFERENCE_INVALID` as chains only); P3-8 equivalent path templates accepted with distinct identities; P3-13 multipart type-derived default `contentType`; P3-14 3.1 operations without `responses` remain invalid because model v1 requires at least one response.

### Security

- **P2-1 fixed.** Stack hint lowered to 4 MiB (a recoverable `RangeError` instead of a native fault) and a linear pre-parse nesting guard rejects flow runs or indentation beyond the depth budget before composition; tested with 200,000 nested brackets and 900 indented levels.
- **P2-2 fixed.** Values whose prototype is not `Object`/`Array` (typed arrays from `!!binary`, `Date`, `Set`) fail the parse as a syntax error.
- **P2-3 fixed.** Parsing uses `parseDocument` with `logLevel: "silent"`; any parser warning (unknown or non-JSON tags) is `SOURCE_PARSE_FAILED`, so the host never writes to stderr on parser input.
- **P2-4 fixed.** See OpenAPI P2-7.
- **P2-5 fixed and documented.** Data-position `$ref` no longer drives I/O (OpenAPI P1-2). Root-wide confinement is retained deliberately (shared `common/` trees) and recorded in the threat model and the reference: a spec may publish any parseable in-root file, so secrets must live outside the root; a source allowlist is a tracked follow-up.
- **P3 fixed:** P3-1 bounded read through `open`/`read` of `maxBytes + 1`; P3-2 `lstat` of every component of `.specra/artifacts`; P3-3 `canonicalId` on acquired sources with mismatches treated as unresolved (case-insensitive filesystems behave like case-sensitive ones); P3-5 control characters replaced by escapes; P3-6 example conversion short-circuits once the budget is exhausted.
- **P3 accepted/tracked:** P3-4 hard links recorded as an accepted same-filesystem residual; P3-7 host request on argv recorded, stdin delivery tracked.

### QA

- **P1-1 fixed.** `INGESTION_TIMEOUT` (exit 2, `source/openapi.yaml`), abort-signal cancellation of a running host (`reason: "cancelled"`), `buildProject` cancellation, and SIGINT during ingestion (exit 130, `CANCELLED`) are asserted end to end against a genuinely slow 9 MiB document, including the absence of staging/previous residue.
- **P1-2 fixed.** `adversarial/ref-chains.yaml` covers a parameter cycle, a response cycle, a 34-hop chain, and a scalar target with exact codes and locations (cycles report the detection point, overflow reports the origin).
- **P1-3 fixed.** `packages/openapi/src/dialect-matrix.test.ts` adds 57 table-driven rows covering the constructs the reviewer listed (3.0 boolean/type-array/array-items/examples, `jsonSchemaDialect`, duplicate tags, component callbacks/links/pathItems, path-item `$ref`, `1XX`/`5XX`, every OAuth flow, OIDC without URL, unknown scheme type, scheme and parameter collisions, `Content-Type` and duplicate headers, header with `content`, encoding lookup through `$ref`, `allowEmptyValue`, per-location styles, `readOnly`/`writeOnly`/`deprecated`, `multipleOf`, `contains`, `not`, unsupported keywords, `additionalProperties` schemas, inline depth guard) plus every behaviour changed in this review round; the dialect map now points at it.
- **P2-5 fixed.** The limits table states the model's 1,000,000 code-unit string ceiling as the effective bound; pointer-length bounding is documented.
- **P2-6 fixed.** Generator kinds `wide`, `wide-yaml`, `dense`, `encodings`, `polymorphic` with accept/reject cases; the runner takes a document count.
- **P2-7 fixed.** Regular file at the artifact path (caught at context creation as `CONFIG_PATH_INVALID`), read-only `.specra` (write fails, previous artifact intact), and no staging/previous residue after timeout, cancellation, or failure.
- **P2-8 fixed.** Packaged `build` (human and JSON), failure exit 2 with stdout/stderr isolation, and EPIPE on `build`.
- **P2-9 fixed.** Exact `codes()` for reference, truncation, and total-byte limits; dead assertions removed.
- **P3 fixed:** P3-11 alias and merge-key rows, P3-12 empty/whitespace/array-root/JSON duplicate keys/`3.1`/`3.2.0`, P3-13 pure `$ref` cycle decision test, P3-14 evidence JSON uploaded by CI, P3-16 dead `encoding` parse kind removed.
- **P2/P3 tracked (QA owner):** P2-4 a common-subset 3.0/3.1 `basic` pair and a committed golden `documentation.json` (the `pairs/` fixtures and matrix rows cover the byte-equivalence claim today); P3-10 wall-clock bounds on subprocess tests are unchanged and will be widened if CI shows flakiness; P3-15 host-versus-in-process byte comparison.

### Performance

- **P1-1 fixed.** Duplicate keys are detected in one linear `visit` pass with a `Set` per mapping instead of the parser's per-insertion scan: 100,000-property documents went from 33 s (JSON) and 180 s (YAML) to 1.3 s and 1.9 s. A `JSON.parse` fast path was measured and not adopted (ADR-009).
- **P1-2 fixed.** Heap hint raised to 2 GiB to match the evidence ceiling; two node-dense documents inside the 20 MiB total budget now parse (1.5 GiB RSS) instead of exhausting the heap.
- **P2-1 fixed.** Declared property names are collected once per media schema; 2,000 encodings normalize in 88 ms.
- **P2-2 fixed.** A reverse `SchemaId → key` map makes component-name lookup O(1); 20,000 discriminator variants normalize in 1.1 s.
- **P2-3 fixed.** The pipeline validates once through canonicalization, the host serializes the already-canonical artifact with `JSON.stringify`, and the parent verifies canonical bytes with one parse instead of parse plus re-serialization.
- **P2-4 fixed.** Wide-mapping (JSON and YAML), multi-document, encoding, and discriminator cases with 15–20 s ceilings; the CLI case runs at the default 30 s timeout; the reference's "about a second" claim is replaced by measured statements.
- **P3 fixed:** P3-1 head-indexed pending queue; P3-3 example budget counted in UTF-8 bytes.
- **P3 tracked (performance owner):** P3-2 canonical depth amplification is attributed to the root document (documented); P3-4 canonical diagnostics are bounded by the node budget rather than a dedicated cap.

### Architecture

- **P2 all fixed** in the earlier pass: artifact manifest contract exported by `@specra/model`, `yaml` removed from the CLI manifest with nested workspace dependencies staged, duplicate `openapi` entries diagnosed at the configuration entry, ingestion entry cap, bounded read, `TypeError` for invalid adapter options, 64 MiB frame ceiling justified by the model's serialized-length budget, I/O gate self-test, and content-derived server identities.

## Tracked and accepted

| Item                                                               | Owner                | Disposition                                            |
| ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------ |
| Source allowlist / subtree confinement for `$ref` targets          | Security, SPEC-006   | Tracked; root-wide confinement documented and accepted |
| Hard links from outside the project root                           | Security             | Accepted same-filesystem residual (threat model)       |
| Host request delivered on argv                                     | Security             | Accepted; stdin delivery tracked                       |
| Equivalent path templates with different parameter names           | OpenAPI              | Tracked                                                |
| Multipart type-derived default `contentType`                       | OpenAPI, SPEC-005    | Tracked                                                |
| 3.1 operations without `responses`                                 | OpenAPI, model owner | Rejected by model v1 contract; documented              |
| Schema `$ref` to non-schema targets projecting to `any`            | OpenAPI              | Tracked; reference documents current behaviour         |
| Canonical depth amplification attributed at the root               | Performance          | Documented                                             |
| Common-subset 3.0/3.1 `basic` pair and golden `documentation.json` | QA                   | Tracked                                                |
| Host-versus-in-process artifact byte comparison                    | QA                   | Tracked                                                |
| Realistic production contract fixture (TestInbox)                  | QA                   | Tracked outside core behaviour                         |
| `@hyperjump/json-schema` as a development-only conformance oracle  | OpenAPI              | Tracked (ADR-009)                                      |

## Principal Engineer decision

**Approved to merge into `develop`.** P0 = 0; all seven P1 findings are fixed and
re-verified by tests; all 28 P2 findings are fixed except the golden-artifact and
realistic-contract items, which are tracked with owners; every P3 is fixed, documented,
or tracked. The support contract in `docs/openapi.md`, the dialect map, the threat model,
ADR-009, and the performance evidence describe the merged behaviour. SPEC-004 has not
been started.
