---
title: Installation
description: Install the supported Specistry CLI distribution in a clean consumer project.
---

The initial supported author surface is the packed `@specistry/cli` package on Node 24.20 or newer within Node 24. npm and pnpm are the package managers exercised for the release candidate. Before publication, install the reviewed candidate tarball:

```bash
npm install --save-dev ./specistry-cli-0.1.0-rc.3.tgz
npx specistry --help
```

```bash
pnpm add --save-dev ./specistry-cli-0.1.0-rc.3.tgz
pnpm exec specistry --help
```

The release candidate is inspectable but is not published automatically. The registry coordinate `@specistry/cli@0.1.0-rc.3` becomes usable only after the owner clears every release gate and explicitly publishes it.

## Public boundary

Consumer projects import `defineConfig` from `@specistry/config` and invoke the `specistry` executable installed by the CLI package. Internal source paths, monorepo aliases, fixtures, and unpublished subpaths are not supported interfaces.
