# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /workspace
ENV CI=true

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/content/package.json packages/content/package.json
COPY packages/model/package.json packages/model/package.json
COPY packages/playground/package.json packages/playground/package.json
COPY packages/release/package.json packages/release/package.json
COPY packages/search/package.json packages/search/package.json
COPY packages/snippets/package.json packages/snippets/package.json
RUN pnpm install --frozen-lockfile --filter @specra/web...

COPY apps/web apps/web
COPY packages/config packages/config
COPY packages/content packages/content
COPY packages/model packages/model
COPY packages/playground packages/playground
COPY packages/release packages/release
COPY packages/search packages/search
COPY packages/snippets packages/snippets
COPY scripts/clean-package-dist.mjs scripts/clean-package-dist.mjs
# The image is consumer-neutral: compile the reader without baking a project
# artifact into the image. Runtime readiness validates the externally mounted
# candidate or release store before the instance receives traffic.
RUN pnpm --filter '@specra/web^...' run build && \
    NEXT_TELEMETRY_DISABLED=1 pnpm --filter @specra/web exec next build

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS reader
ENV HOSTNAME=0.0.0.0 \
    NODE_ENV=production \
    PORT=3000 \
    SPECRA_PROJECT_ROOT=/data/project
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]
