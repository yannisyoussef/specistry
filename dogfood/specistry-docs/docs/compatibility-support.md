---
title: Compatibility and support
description: Know which interfaces are supported before the first stable release.
---

The release candidate supports Node 24.20 through the end of Node 24, OpenAPI 3.0 and 3.1 as documented, current stable Chromium, Firefox, and WebKit engines, configuration schema 1, and the documented Node reader deployment.

Quality JSON, diff JSON, manifest formats, release-store structures, CLI exits, route identity, and configuration keys are compatibility-sensitive. Before 1.0, an intentional change may still occur, but it must be documented with a migration path; silent format drift is not acceptable.

npm and pnpm clean-room installs are tested. Yarn, Bun, Windows authoring, and production reader platforms beyond the tested Linux container are not claimed.

Use GitHub issues for reproducible non-sensitive defects and discussions for adoption questions. There is no SLA. Only the current release candidate is supported during pre-1.0 evaluation. Security reports use GitHub Security Advisories.
