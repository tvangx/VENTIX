# syntax=docker/dockerfile:1
# Build từ thư mục GỐC repo (cần workspace + lockfile):
#   docker build -f services/notification/Dockerfile -t ticketing/notification .
# (với chính template: thêm --build-arg SERVICE_PKG=@ticketing/notification)
ARG NODE_VERSION=20

# ---- base: pnpm + openssl (Prisma cần openssl) ----
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
 && apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# ---- build: cài, biên dịch service + package workspace, rồi gói riêng bản prod ----
FROM base AS build
ARG SERVICE_PKG=@ticketing/notification
COPY . .
RUN pnpm install --frozen-lockfile --filter "${SERVICE_PKG}..."
RUN pnpm --filter "${SERVICE_PKG}..." build
RUN pnpm --filter "${SERVICE_PKG}" deploy --prod /out
# Prisma client phải được sinh lại trong thư mục deploy (chỉ chạy khi schema đã có model).
RUN cd /out && node scripts/prisma-generate.js

# ---- runtime: nhỏ, chạy bằng user không phải root ----
FROM node:${NODE_VERSION}-slim AS runtime
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=3008
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3008
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3008/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
