# DDAS — single application image: API + web console + background workers.
# Build from the repo root:  docker build -f deploy/Dockerfile -t ddas .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm build

# Production dependencies only, deployed for the server workspace.
FROM node:24-slim AS prod-deps
WORKDIR /repo
RUN corepack enable
COPY --from=build /repo ./
RUN pnpm --filter @ddas/server deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
# --chown at copy time: a recursive chown over node_modules after the fact
# doubles layer size and gets OOM-killed on small builders.
COPY --from=prod-deps --chown=node:node /out ./
COPY --from=build --chown=node:node /repo/apps/web/dist ./web
RUN mkdir -p /data/blobs && chown node:node /data /data/blobs
USER node
ENV PORT=3000 BLOB_DIR=/data/blobs WEB_DIST=/app/web
EXPOSE 3000
CMD ["node", "dist/main.js"]
