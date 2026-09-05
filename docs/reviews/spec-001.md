# SPEC-001 review record

Date: 2026-09-05

The Principal Engineer reviewed the canonical model before independent review.
Independent reviews covered OpenAPI/JSON Schema fidelity, frontend/search/snippet
consumer usability and QA, security, architecture, and performance. Reviewers
inspected committed baseline `e3c4f5a`; blocking fixes were then re-reviewed against
the final worktree.

## Severity summary

- **P0:** 0.
- **P1:** 0 open; all 20 reported instances were resolved, including overlap between
  reviewers.
- **P2:** 0 undispositioned; correctness items were resolved and two efficiency/harness
  improvements are tracked below.
- **P3:** 1 tracked for the future adapter collision ledger.

## Resolved P1

| Finding                                                                                                                | Disposition                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Generated operation IDs collapsed distinct slash spellings and unsafe contract IDs were lost.                          | Added exact `contractId` retention and canonical-safe/hash derivation; missing IDs hash method plus the exact NFC path. Distinct path and arbitrary-ID tests pass.                                                      |
| Case folding rejected valid server values, scopes, tags, and required property names.                                  | Duplicate checks now use NFC-normalized, case-sensitive values; case variants are covered.                                                                                                                              |
| Security alternative identity ignored scopes and used collision-prone delimiters.                                      | Validation and serialization now use canonical JSON tuple keys containing scheme IDs and sorted exact scopes.                                                                                                           |
| Malformed optional schema fields could pass validation and crash serialization.                                        | Added strict presence/type checks for scalar/type-less groups, enum values, array flags, required membership, and duplicate enum semantics. Serialization fails only through `CanonicalModelError`.                     |
| Parameter/header serialization was not location-aware and form-part encoding was absent.                               | Added discriminated query/path/header/cookie serialization, simple-only response headers, per-property multipart/form encodings, and applicability validation.                                                          |
| `allOf` discriminator inheritance could not validate.                                                                  | Discriminators are now supported on `allOf`, `anyOf`, and `oneOf`, with fixtures.                                                                                                                                       |
| Diagnostic paths used model-relative or fictitious numeric map positions.                                              | Artifact validation uses `/model`-relative pointers, safe canonical registry keys, and collection-level locations where an untrusted map key cannot safely be emitted.                                                  |
| Runtime validation did not cover headings and several optional fields.                                                 | Added field-by-field validation for pages/headings, descriptions, bearer metadata, server variables, request/header metadata, server references, and contract IDs.                                                      |
| Limits could be omitted, relaxed, or changed through accessors after validation.                                       | Limits require the exact six-field own-data-property shape, are copied into a frozen snapshot, and can only tighten defaults. Oversized serialized input is rejected before parsing.                                    |
| Array subclasses, inherited accessors, and numeric-looking extra properties could execute or disappear.                | Arrays must have `Array.prototype`, indices must be canonical own data properties within length, and every other enumerable key is rejected.                                                                            |
| Aggregate artifact size and diagnostic amplification were unbounded.                                                   | Added a 10,000,000-code-unit aggregate/input ceiling and a deterministic 10,000-diagnostic ceiling with a stable budget sentinel. Re-review confirmed both blockers closed.                                             |
| Definition-of-Done evidence lacked a committed golden, consumer type contract, seeded permutations, and breadth cases. | Added a canonical v1 golden, isolated public-consumer type test, recorded-seed permutations, compatibility rejection, indirect/composed recursion, type-less collection/const/enum, and broad-object performance cases. |

## Resolved P2 highlights

- Object keys are included in per-string and aggregate budgets.
- Unknown-schema links are restricted to matching capability taxonomy, including a
  dedicated unresolved-reference diagnostic; invariant severity cannot be demoted.
- Media type/subtype and parameter names canonicalize without folding case-sensitive
  parameter values.
- Diagnostic factories reject invalid identities, non-pointer paths, C0/C1 controls,
  and bidi formatting controls.
- `sameSet` is linear rather than quadratic; the 20,000-property regression stays
  below the CI smoke ceiling.
- The architecture gate now uses the TypeScript AST, rejects Node/runtime dependency
  loading from production model code, confines relative imports to model source, and
  detects computed browser globals.
- `createSchemaId` validates RFC 6901 escaping and non-empty source identity.
- Documentation now states the implemented UTF-16 ordering and exact path/media rules.

## Tracked P2/P3

| Finding                                                                                                        | Owner / exit condition                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation, canonical construction, final key sorting, and parsing still repeat some full traversals.          | A future model-performance change may introduce private already-validated paths only with byte-equivalence and safety regression proof. Current bounded workloads pass comfortably.    |
| The performance harness records wall time and breadth but not subprocess peak RSS at every boundary shape.     | SPEC-003 owns the production 10 MiB/10,000-operation acquisition/parser benchmark and fresh-process RSS gate; SPEC-001 now caps aggregate artifact size and diagnostics independently. |
| A 64-bit generated-ID hash cannot provide a mathematical collision guarantee across adapter source registries. | SPEC-003 adapters must keep semantic-key-to-generated-ID collision ledgers and fail if distinct source identities map to one generated ID; model uniqueness checks remain mandatory.   |

## Principal Engineer decision

No P0 or blocking P1 remains. The carried SPEC-000 blockers for keyword-without-type
and mixed-vocabulary behavior are closed by explicit type-less semantics and linked,
value-free capability diagnostics. The tracked items do not weaken model semantics or
permit unbounded input; they have named owners and testable exit conditions outside
SPEC-001.
