FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json ./packages/core/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/admin/package.json ./packages/admin/
RUN pnpm install --frozen-lockfile --filter @vu-orchestration/admin...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build --filter @vu-orchestration/admin...

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/packages/admin/dist ./packages/admin/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/orchestrator/dist ./packages/orchestrator/dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "packages/admin/dist/server/index.js"]
