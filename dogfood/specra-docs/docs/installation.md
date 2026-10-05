---
title: Installation
description: Install the supported Specra CLI distribution in a clean consumer project.
---

The initial supported author surface is the packed `@specra/cli` package on Node 24.20 or newer within Node 24. npm and pnpm are the package managers exercised for the release candidate.

```bash
npm install --save-dev @specra/cli@0.1.0-rc.1
npx specra --help
```

```bash
pnpm add --save-dev @specra/cli@0.1.0-rc.1
pnpm exec specra --help
```

The release candidate is inspectable but is not published automatically. Until the owner clears the license gate, install the produced tarball in a clean room instead of expecting the registry coordinate to resolve.

## Public boundary

Consumer projects import `defineConfig` from `@specra/config` and invoke the `specra` executable installed by the CLI package. Internal source paths, monorepo aliases, fixtures, and unpublished subpaths are not supported interfaces.
