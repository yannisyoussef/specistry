# Canonical model diagnostic catalog

Diagnostics are deterministic machine contracts and safe human summaries. IDs derive
only from code plus bounded canonical location; messages are fixed in
`DIAGNOSTIC_MESSAGES`. Values, examples, source excerpts, credentials, and arbitrary
labels never participate in IDs or messages.

Canonical locations may identify a version, service, operation, schema, and RFC 6901
path. They never contain YAML line syntax. Adapters may maintain source-specific
locations outside the canonical artifact and correlate them during author reporting.

## Invariant diagnostics

| Code                      | Meaning                                             |
| ------------------------- | --------------------------------------------------- |
| `DUPLICATE_ID`            | Identity collision in a defined uniqueness scope    |
| `INVALID_CANONICAL_ID`    | ID is unsafe, too long, or not NFC normalized       |
| `INVALID_DIAGNOSTIC`      | ID/message/severity/location is not canonical       |
| `INVALID_JSON_VALUE`      | Number is non-finite or negative zero               |
| `INVALID_MODEL`           | Canonical object shape or semantic field is invalid |
| `INVALID_PATH_PARAMETER`  | Path template and path parameter disagree           |
| `INVALID_SCHEMA`          | Schema node violates model v1 invariants            |
| `MODEL_LIMIT_EXCEEDED`    | Configured deterministic model budget was exceeded  |
| `MISSING_DIAGNOSTIC`      | Schema diagnostic link has no artifact diagnostic   |
| `MISSING_REFERENCE`       | Schema/discriminator target is absent               |
| `MISSING_SECURITY_SCHEME` | Security requirement target is absent               |
| `MISSING_SERVER`          | Operation server target is absent                   |
| `NON_SERIALIZABLE`        | Value would be lost, invoked, or changed by JSON    |

Invariant diagnostics are errors and prevent canonical serialization.

## Capability diagnostics

| Code                           | Default severity | Disposition                            |
| ------------------------------ | ---------------- | -------------------------------------- |
| `SCHEMA_IGNORED_ANNOTATION`    | Info             | Inert annotation intentionally omitted |
| `SCHEMA_PARTIALLY_REPRESENTED` | Warning          | Faithful documented subset retained    |
| `SCHEMA_UNRESOLVED_REFERENCE`  | Warning          | Source reference could not be resolved |
| `SCHEMA_UNSUPPORTED_SEMANTIC`  | Warning          | Semantic cannot be modeled in v1       |
| `SCHEMA_INVALID_SEMANTIC`      | Error            | Source semantic is invalid             |

Capability errors describe source validity and may be serialized as part of an
artifact containing explicit unknown nodes. They do not mean the artifact structure
itself is invalid. Policy in a later orchestrator decides whether such an artifact may
be published.

## Safety rules

- Construct diagnostics with `createDiagnostic`; hand-authored IDs/messages fail
  artifact validation.
- Link diagnostics through `diagnosticIds` on affected schemas.
- Use `unknown` when no faithful documentation projection remains.
- Never interpolate a keyword value, example, URL credential, source excerpt, or
  author-controlled identifier into message text.
- Logs and CI annotations must treat even canonical location metadata as untrusted
  display data and escape terminal/workflow syntax.
