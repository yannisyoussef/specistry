# Compatibility policy

Specra `0.1.0-rc.2` is a pre-1.0 release candidate. Pre-1.0 does not mean
silent drift: compatibility-sensitive changes are documented, tested, and
include a migration path, but may occur before 1.0 when evidence shows the
current contract is wrong.

| Surface             | Supported contract                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Node                | `>=24.20.0 <25` for the author CLI and production reader                                                                                     |
| Package managers    | npm and pnpm 11.19 clean-room installs; Yarn and Bun are not claimed                                                                         |
| Author OS           | Linux and macOS evidence; Windows path semantics are unit-tested but a Windows clean-room run is still required before claiming host support |
| Production OS       | The Linux reference container; other Node hosts are operator-evaluated                                                                       |
| OpenAPI             | Local OpenAPI 3.0 and 3.1 under the published support and downgrade matrix                                                                   |
| AsyncAPI / GraphQL  | Not ingested                                                                                                                                 |
| Browsers            | Current stable Chromium, Firefox, and WebKit engines for critical flows; no Internet Explorer support                                        |
| Configuration       | `schemaVersion: 1`; unknown keys fail; migrations are explicit                                                                               |
| CLI                 | Documented commands, exit codes, and diagnostic codes are compatibility-sensitive; prose is not                                              |
| Quality JSON        | `qualityFormat: 1`; rule ids and default severities follow the published migration policy                                                    |
| Diff JSON           | `diffFormat: 1`; no rename heuristics                                                                                                        |
| Model and manifests | Numeric format versions are validated; future unsupported versions fail closed                                                               |
| Release store       | Immutable version directories and an atomically replaced catalog; do not mutate components in place                                          |
| Deployment          | Node reader with prebuilt artifacts or an immutable release store; static export is unsupported                                              |

Only the CLI package and reader container described in the release audit are
supported external distributions. Architectural workspace packages are
bundled implementation details even when a package manager can see them in the
tarball.
