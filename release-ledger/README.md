# Public-distribution ledger

This directory is the durable, version-controlled authority for the first
public distribution date and resulting BSL Change Date of each software version.
The immutable `0.1.0-rc.2.json` record belongs to the historical release described
in [brand migration](../docs/brand-migration.md). Its original identity, dates,
source and artifact digest remain unchanged. The separate `0.1.0-rc.3.json`
record binds Specistry's first public source distribution on 2026-10-06 to its
qualified CLI artifact and frozen production source. Its Apache-2.0 Change Date
is 2029-10-06. The two version records are independent.

The release transaction must run
`release:record-public-distribution` from the exact reviewed release commit,
commit the newly created `<version>.json` record through a reviewed PR to `master`, and
then attest its identical checksummed candidate copy before publishing the
GitHub pre-release. Record the earliest public distribution of that version,
including public versioned source, rather than a later artifact upload.
Preparation alone does not invent a distribution event. A version record is
immutable once committed; corrections require
owner and legal review and must never silently replace history.
