# Public-distribution ledger

This directory is the durable, version-controlled authority for the first
public distribution date and resulting BSL Change Date of each Specra version.
There is intentionally no version record yet because no release is public.

The public-first release transaction must run
`release:record-public-distribution` from the exact reviewed release commit,
commit the newly created `<version>.json` record through branch protection, and
commit it before the source repository becomes public on the recorded date,
then attest its identical checksummed candidate copy before publishing the
GitHub pre-release. Private preparation alone does not create a ledger entry;
the explicit, owner-authorized visibility event does. A version record is
immutable once committed; corrections require
owner and legal review and must never silently replace history.
