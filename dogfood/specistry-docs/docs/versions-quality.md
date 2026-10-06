---
title: Versions and quality
description: Promote immutable documentation releases and enforce deterministic documentation policy.
---

`specistry release` promotes a verified candidate into an immutable release directory. `specistry current` changes only the mutable current pointer, which also provides rollback. Historical routes never fall forward to a newer release.

`specistry diff` emits the public structured diff without guessing renames or classifying every schema change. `specistry check` derives facts, applies a static rule catalogue and project policy, then reports counts and a gate result. There is no score.

Suppressions require an exact rule, target, and reviewable reason. Expired and unused suppressions become findings. Compatibility findings are intentionally conservative; uncertain schema changes still need human review.
