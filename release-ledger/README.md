# Public-distribution ledger

This directory is the durable, version-controlled authority for the first
public distribution date and resulting BSL Change Date of each Specra version.
There is intentionally no version record yet because no release is public.

The future protected publication transaction must run
`release:record-public-distribution` from the exact reviewed release commit,
commit the newly created `<version>.json` record through branch protection, and
include its identical candidate copy in checksums and provenance before making
that version public. A candidate build or private CI artifact must not create a
ledger entry. A version record is immutable once committed; corrections require
owner and legal review and must never silently replace history.
