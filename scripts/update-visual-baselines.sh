#!/usr/bin/env bash
# Regenerates the Playwright visual baselines on Linux, the CI platform, so a
# macOS or Windows workstation never produces the reference images. The
# repository is copied into a Node 24 container (host node_modules and build
# output are excluded), dependencies are installed with the frozen lockfile,
# the reader is built against the TestInbox fixture, and the `visual` project
# runs with --update-snapshots. Review every changed image against
# docs/design/reader-v1.md before committing.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p tests/visual/__screenshots__

docker run --rm \
  -v "$PWD:/host:ro" \
  -v "$PWD/tests/visual/__screenshots__:/out" \
  -e CI=1 \
  node:24-bookworm bash -eu -c '
    mkdir -p /work
    tar -C /host \
      --exclude=node_modules --exclude=.next --exclude=dist --exclude=coverage \
      --exclude=test-results --exclude=playwright-report --exclude=.git \
      -cf - . | tar -C /work -xf -
    cd /work
    corepack enable
    corepack prepare pnpm@11.19.0 --activate
    pnpm install --frozen-lockfile
    pnpm exec playwright install --with-deps chromium
    export SPECRA_PROJECT_ROOT=/work/tests/fixtures/reader/testinbox
    export SPECRA_SITE_URL=https://docs.example.test
    pnpm --filter @specra/cli... build
    pnpm --filter @specra/web build
    pnpm exec playwright test --project visual --update-snapshots
    cp -R tests/visual/__screenshots__/. /out/
  '

echo "Baselines written to tests/visual/__screenshots__; review them before committing."
