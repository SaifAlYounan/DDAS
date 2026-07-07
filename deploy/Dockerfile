# DDAS single-container image — Phase 0 stub; real build lands with apps/server in Phase 1.
# Multi-stage: pnpm build → runtime image serving API + console + workers.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-slim
WORKDIR /app
COPY --from=build /app .
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]
