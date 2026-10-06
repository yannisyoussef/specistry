# Public-distribution ledger

This directory is the durable, version-controlled authority for the first
public distribution date and resulting BSL Change Date of each software version.
The immutable `0.1.0-rc.2.json` record belongs to the historical release described
in [brand migration](../docs/brand-migration.md). Its original identity, dates,
source and artifact digest remain unchanged. Specistry RC3 has no distribution
record yet; it requires a separate record based on its actual distribution.

The release transaction must run
`release:record-public-distribution` from the exact reviewed release commit,
commit the newly created `<version>.json` record through branch protection, and
then attest its identical checksummed candidate copy before publishing the
GitHub pre-release. Record the earliest public distribution of that version,
including public versioned source, rather than a later artifact upload.
Preparation alone does not invent a distribution event. A version record is
immutable once committed; corrections require
owner and legal review and must never silently replace history.
