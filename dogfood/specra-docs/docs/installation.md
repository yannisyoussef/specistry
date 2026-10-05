---
title: Installation
description: Install the supported Specra CLI distribution in a clean consumer project.
---

The initial supported author surface is the packed `@specra/cli` package on Node 24.20 or newer within Node 24. npm and pnpm are the package managers exercised for the release candidate. Before publication, install the reviewed candidate tarball:

```bash
npm install --save-dev ./specra-cli-0.1.0-rc.2.tgz
npx specra --help
```

```bash
pnpm add --save-dev ./specra-cli-0.1.0-rc.2.tgz
pnpm exec specra --help
```

The release candidate is inspectable but is not published automatically. The registry coordinate `@specra/cli@0.1.0-rc.2` becomes usable only after the owner clears every release gate and explicitly publishes it.

## Public boundary

Consumer projects import `defineConfig` from `@specra/config` and invoke the `specra` executable installed by the CLI package. Internal source paths, monorepo aliases, fixtures, and unpublished subpaths are not supported interfaces.
