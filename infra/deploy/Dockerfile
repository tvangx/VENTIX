# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate \
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

FROM base AS build
ARG SERVICE
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY services/${SERVICE} ./services/${SERVICE}
RUN pnpm install --frozen-lockfile --filter "@ticketing/${SERVICE}..."
RUN pnpm --filter "@ticketing/${SERVICE}..." build
RUN pnpm --filter "@ticketing/${SERVICE}" deploy --prod /out
# Custom Prisma output is outside dist and omitted by package.json files.
# Generate again AFTER deploy, against the exact production node_modules layout.
RUN cd /out && ./node_modules/.bin/prisma generate

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
COPY --chown=node:node infra/deploy/app-entrypoint.cjs ./app-entrypoint.cjs
USER node
ENTRYPOINT ["node", "app-entrypoint.cjs"]
CMD ["node", "dist/main.js"]
