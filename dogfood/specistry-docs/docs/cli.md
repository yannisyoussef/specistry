---
title: CLI reference
description: Understand command behavior, machine output, and stable exits.
---

The public executable provides `validate`, `build`, `check`, `diff`, `release`, `current`, and `deprecate`. Every command accepts `--root`; read and build commands support bounded configuration and source timeouts.

Machine mode writes one JSON envelope. Exit 0 is success, 2 is a validation or project-policy error, 3 is a quality-gate failure, 64 is usage, 70 is internal failure, and 130 is cancellation. Message prose is not a machine interface; consume stable codes and structured fields.

The CLI never searches parent directories. Select the consumer project explicitly when invoking it from automation.
