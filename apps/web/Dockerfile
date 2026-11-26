# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:20.19.5-bookworm-slim@sha256:9e70124bd00f47dd023e349cd587132ae61892acc0e47ed641416c3e18f401c3
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @ticketing/web
ENV VITE_API_MOCKING=false
RUN pnpm --filter @ticketing/web build && rm -f apps/web/dist/mockServiceWorker.js

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/dist ./dist
COPY --chown=node:node apps/web/server.mjs ./server.mjs
USER node
CMD ["node", "server.mjs"]
