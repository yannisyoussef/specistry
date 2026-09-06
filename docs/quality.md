# Documentation quality gates

`specra check` evaluates documentation the same way every time and tells CI
whether to fail. It is built from three separate layers, and keeping them
separate is the point:

```text
canonical model + authored content + SDK mappings + structured release diff
                              │  facts
                              ▼
                        rule catalogue            "this operation has no description"
                              │  findings
                              ▼
                        project policy            severity, suppressions, thresholds
                              │
                              ▼
              human report · JSON · exit code
```

A fact is not a verdict. `operation has no description` is a finding; whether
it is informational, a warning, an error, or suppressed is policy, and
whether that fails the build is a threshold. Rules never know an exit code.
See [ADR-017](adr/017-documentation-quality-facts-rules-policy.md).

## There is no score

Specra reports counts by severity, not a percentage. A single number hides
which findings matter, moves when an API grows rather than when its
documentation changes, and invites gaming. `0 errors · 4 warnings · 7 info`
tells an author what to do next; `87/100` does not. The roadmap explicitly
allows either; this is the choice, and it is not a placeholder for a score
arriving later.

## Running it

```bash
specra build
specra check
```

Check reads the artifacts a build already produced. It never writes, never
rebuilds, never applies a fix, never edits a suppression, and never touches
the release catalog. Run `specra build` first, or the check reports
`CANDIDATE_MISSING` rather than judging stale output.

| Option                            | Meaning                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `--version <id>`                  | Evaluate a retained release instead of the candidate build       |
| `--from <candidate\|current\|id>` | Compare against this base, which enables the compatibility rules |
| `--json`                          | Write exactly one JSON envelope to stdout                        |
| `--root <path>`                   | Project root                                                     |

Exit codes: `0` the gate passed, `3` the gate failed, `2` the project or the
policy could not be read, `64` usage, `70` internal, `130` cancelled. A
configuration error is deliberately not the same code as a failed gate.

## The rule catalogue

Every rule has a stable id, a default severity, and a documented
false-positive boundary. Rules run on **valid** artifacts: anything ingestion
or the content pipeline already rejects is a build error, not a quality rule.

### Operations

| Rule                              | Default | What it detects                                                                                     | Boundary                                                                        |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `operation-description`           | warning | The operation has no description, or only whitespace                                                | A one-word description satisfies it; length is not judged                       |
| `operation-summary`               | info    | The contract declared no summary, so the title fell back to the operation id or the method and path | A summary that is deliberately the operation id looks the same, and is reported |
| `operation-success-response`      | warning | No 2xx and no `default` response is documented                                                      | A `2XX` range counts; an operation that genuinely only fails is reported        |
| `operation-parameter-description` | info    | A parameter has no description                                                                      | One finding per parameter, so a suppression covers the whole operation          |
| `operation-request-description`   | info    | A request body has no description                                                                   | The body's schema may still be documented; this asks for the prose around it    |

### Schemas

Only reusable registry definitions are judged: those are the names a reader
meets across many operations. Inline shapes are not.

| Rule                          | Default | What it detects                                                 | Boundary                                                                              |
| ----------------------------- | ------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `schema-description`          | warning | A reusable schema has neither a title nor a description         | Either one satisfies it                                                               |
| `schema-property-description` | info    | A property of a reusable object has no description              | A property that references another definition is skipped: the definition documents it |
| `schema-enum-undocumented`    | info    | A reusable enumeration has no description explaining its values | Per-value documentation is not required, and per-value prose is not judged            |

### Examples

| Rule                       | Default | What it detects                                     | Boundary                                                                                                                                                                                                                                     |
| -------------------------- | ------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `example-request-missing`  | info    | A request media type carries no example             | An example on the schema, or a default value, counts                                                                                                                                                                                         |
| `example-response-missing` | info    | A successful response media type carries no example | Only 2xx responses are asked for                                                                                                                                                                                                             |
| `example-credential-value` | warning | An example value is shaped like a real credential   | Well-known formats (JWT, private key block, `AKIA…`, `gh*_…`, `xox*-…`, `sk_live_…`, `AIza…`) anywhere, plus a long mixed-class opaque string under a credential-named key. Obvious placeholders such as `<YOUR_API_KEY>` are never reported |

The finding names where the value sits, never the value. Nothing about an
example ever reaches a report, a log, or the JSON output.

### Authentication

Specra documents contracts. No rule here judges whether authentication is
strong, and none claims a vulnerability.

| Rule                         | Default | What it detects                                                                                       | Boundary                                                                        |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `auth-scheme-description`    | warning | A security scheme that operations require has no description telling a caller how to get a credential | A scheme declared but never used is not reported                                |
| `auth-anonymous-alternative` | info    | An operation accepts both anonymous and authenticated calls                                           | It cannot tell whether the difference is already explained in prose; hence info |

### SDK mappings

Specra knows only the mappings a project declared (SPEC-008). No rule claims
anything about the real package.

| Rule                     | Default | What it detects                                                         | Boundary                                                                                            |
| ------------------------ | ------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `sdk-example-missing`    | warning | An SDK declaring `coverage: "complete"` maps no example to an operation | Silent for `coverage: "partial"`; the finding targets the operation, with the SDK id as its locator |
| `sdk-example-deprecated` | info    | An SDK example targets a deprecated operation                           | The example may be intentional during a transition                                                  |
| `sdk-package-missing`    | info    | An SDK declaring complete coverage names no installable package         | Silent for partial coverage                                                                         |

### Authored content

| Rule               | Default | What it detects                     | Boundary                                                                                       |
| ------------------ | ------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| `page-description` | info    | An authored page has no description | Broken links, missing assets, and orphan pages are build errors or warnings, not quality rules |

### Compatibility

These run only with `--from`. They read the structured diff **and** both
documentation sets; they never rewrite a diff record and never invent a diff
aspect. Uncertain changes stay uncertain on purpose.

| Rule                           | Default | What it classifies                                                                                            |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------- |
| `api-operation-removed`        | error   | An operation the base documented is absent; a removed service is expanded into its operations                 |
| `api-required-parameter-added` | error   | A parameter was added and is required in the target, so a previously valid call is now rejected               |
| `api-parameter-removed`        | warning | A documented parameter disappeared                                                                            |
| `api-response-removed`         | warning | A documented response status disappeared                                                                      |
| `api-security-restricted`      | error   | Set semantics over OR-of-AND alternatives: some credential set the base accepted satisfies no alternative now |
| `api-schema-changed`           | info    | A request, response, or reusable schema changed. Specra does **not** classify it; a human decides             |

Deliberately **not** classified: an added operation, an added response, a
deprecation, a widened enumeration, a nullability change, an
`additionalProperties` change, or any composition change. An operation whose
identity changed is a removal plus an addition, never a guessed rename.
Renaming heuristics are not planned.

### Policy

| Rule                  | Default | What it detects                                                          |
| --------------------- | ------- | ------------------------------------------------------------------------ |
| `suppression-unused`  | warning | A suppression matched nothing, so the policy no longer describes reality |
| `suppression-expired` | warning | A suppression passed its expiry date and stopped applying                |

## Configuring policy

```ts
export default defineConfig({
  // …
  quality: {
    rules: {
      "operation-description": "error",
      "schema-property-description": "off",
    },
    failOn: "error",
    maxWarnings: 25,
    suppressions: [
      {
        rule: "operation-description",
        target: "openapi.yaml~listInboxes",
        reason: "Tracked in DOC-14; the endpoint is being retired in v3.",
        expires: "2026-12-31",
      },
    ],
  },
});
```

A project without a `quality` section behaves exactly as the defaults above.

**Severities** are `off`, `info`, `warning`, and `error`. A misspelled rule
id is a configuration error (`QUALITY_RULE_UNKNOWN`), never a silently
disabled rule.

**Thresholds.** `failOn` (default `error`) fails the gate when any finding is
at or above that severity; `never` reports without failing. `maxWarnings`
fails when the warning count is strictly greater than the number, so
`maxWarnings: 0` means no warnings at all and `maxWarnings: 25` allows
exactly 25.

**Precedence** is frozen and tested:

```text
rule default severity
→ configured severity (off removes the rule from the run entirely)
→ suppression match (an expired suppression does not apply)
→ counts by effective severity
→ failOn, then maxWarnings
→ exit code
```

## Suppressions

A suppression accepts one finding on one entity, with a reason a reviewer can
read:

- `rule` and `target` are both required; there is no wildcard. Turning a rule
  off everywhere is `rules: { "<id>": "off" }`, which is visibly different
  from accepting a specific piece of debt.
- `target` is a canonical identity: `<service>~<operation>`,
  `<service>~<schema>`, `<service>~<scheme>`, a page route, or an SDK id.
  The identity is printed with every finding and in the JSON output.
- `reason` is 1 to 200 characters of plain text. Control characters, line
  breaks, and bidirectional marks are rejected.
- `expires` is an optional UTC `YYYY-MM-DD`. The suppression applies through
  that day and stops the day after, whatever the machine's timezone.
- A suppression covers every finding of that rule on that entity, including
  ones distinguished by a locator.

Suppressed findings are counted, listed, and reported with their reason;
nothing is erased. A suppression that matches nothing becomes a
`suppression-unused` finding, so the rule keeps being evaluated everywhere
else and stale entries surface instead of rotting. An unknown identity is
treated as unused rather than as a hard error, because entities legitimately
disappear between releases and a stale suppression should not break an
unrelated build.

## Output

Human output lists errors and warnings in full, summarizes info findings by
rule (unless the policy can fail on info), and ends with counts and the gate
result. Untrusted text — an operation title, a schema name, an SDK label —
passes through the same terminal sanitizer as every other Specra command, so
a hostile contract cannot rewrite a terminal.

`--json` writes exactly one envelope to stdout and nothing to stderr:

```json
{
  "diagnostics": [],
  "ok": false,
  "quality": {
    "qualityFormat": 1,
    "target": { "kind": "release", "version": "v2" },
    "comparison": { "from": "v1" },
    "summary": {
      "error": 1,
      "warning": 4,
      "info": 12,
      "suppressed": 2,
      "rules": 24,
      "truncated": false,
      "gate": "failed",
      "reason": "error"
    },
    "findings": [
      {
        "id": "api-operation-removed:openapi.yaml~getRawMessage",
        "rule": "api-operation-removed",
        "category": "compatibility",
        "severity": "error",
        "target": {
          "kind": "operation",
          "identity": "openapi.yaml~getRawMessage",
          "label": "GET /inboxes/{id}/raw"
        },
        "message": "The operation was documented in the comparison base and is absent here."
      }
    ]
  }
}
```

`ok: false` with a `quality` block is a failed gate; `ok: false` without one
is a project or policy error, and its `diagnostics` say what. Machine
consumers should key on `rule`, `id`, and `severity`, never on message text.

**Finding identity** is `<rule>:<entity identity>[:<locator>]`. It is derived
from canonical identities, never from source line numbers, so reordering a
contract does not invent new findings. Authored-page findings additionally
carry a project-relative `source` path.

**Bounds.** At most 1,000 findings per rule and 5,000 in one evaluation. When
a rule stops at its budget the summary says `truncated: true`, and the gate
fails if that rule's severity could have changed the outcome: an incomplete
evaluation is never allowed to report a pass it cannot prove.

## Diffing releases

```bash
specra diff --from v1 --to v2
specra diff --from current          # against the candidate build
specra diff --from v1 --json
```

`--from` is required; `--to` defaults to `candidate`. Each source is
`candidate`, `current` (resolved through the catalog), or an exact retained
version id. Nothing is inferred from version ordering.

Diff is informational: it exits 0 whether or not anything changed, and
compatibility policy lives in `specra check --from`. It reuses the SPEC-010
structured diff verbatim, including its `diffFormat: 1` envelope, so the
machine output of `specra diff --json` is the same record the release
workflow reviews. It never writes to `.specra/candidates`, never dispositions
a candidate, and never generates changelog prose.

```text
Specra diff v1 → v2

Operations:
  - GET /inboxes/{id}/raw
  + POST /inboxes/{id}/messages/wait
  ~ GET /inboxes
      deprecated deprecated
      parameter-added query:cursor

Schemas:
  ~ Inbox

4 change(s)
```

## In CI

```bash
specra validate
specra build
specra check
```

Any runner works; nothing here is specific to one CI product. To keep the
report as an artifact, redirect it:

```bash
specra check --json > specra-quality.json
```

To gate a release on quality, order the commands explicitly rather than
coupling them:

```bash
specra check --from current
specra release v2 --current
```

`specra release` does not run `specra check` for you. Hidden coupling between
a gate and a publish step is how gates get disabled.

## Rule migration policy

Rule ids and default severities are public policy, and CI depends on them.

- A **new rule** enters the catalogue at `info` or `warning`, never at
  `error`, so adding one cannot break an existing pipeline that had no chance
  to review it.
- **Raising** a default severity, **removing** a rule, or **renaming** an id
  is a documented compatibility change, recorded here and in the roadmap
  entry for the slice that makes it. A renamed id keeps the old id accepted
  in configuration for at least one documented release window.
- Message text may change at any time; it is not an interface. Key automation
  on `rule`, `id`, and `severity`.
- `RULE_REGISTRY_VERSION` in `@specra/quality` is bumped whenever the
  catalogue or a default changes.

## What quality checking is not

- It sends no request and reaches no network. It cannot tell you whether an
  endpoint behaves the way its documentation claims.
- It is not a security scanner. It reports credential-shaped examples and
  missing authentication documentation; it makes no claim about
  vulnerabilities, authentication strength, or compliance.
- It runs no user-supplied code. There is no plugin mechanism, no rule
  callback in configuration, and no dynamic module loading; the registry is a
  static array. Extending it would need its own security review.
- It grades nothing with a model and writes no prose.
