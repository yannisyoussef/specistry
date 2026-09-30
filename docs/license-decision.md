# Software license owner decision

Status: **OPEN — blocks public distribution.** The repository and staged
package consistently declare `UNLICENSED`. SPEC-012 does not silently change
ownership or licensing terms.

The owner should select one of these realistic policies after confirming
copyright ownership and business intent:

| Choice                               | Practical effect                                                                  | Main trade-off                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Apache-2.0                           | Permissive use and redistribution with an explicit patent grant and notice duties | Longer license and notice management                                                                             |
| MIT                                  | Short, broadly understood permissive terms                                        | No express patent grant                                                                                          |
| AGPL-3.0-only                        | Requires source availability for modified network-served versions                 | Strong reciprocal obligation may reduce commercial adoption and conflicts with some dependency or buyer policies |
| Proprietary / source-available terms | Owner controls commercial rights and redistribution                               | Requires authored terms, enforcement strategy, and a clear evaluation grant                                      |

Before public release, the owner must record the choice, add the authoritative
license text, update every package manifest and README, verify notices and
dependency compatibility, and have counsel review any non-standard terms.
Until then, release-candidate artifacts are for local evaluation only.
