FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json ./packages/core/
COPY packages/orchestrator/package.json ./packages/orchestrator/
RUN pnpm install --frozen-lockfile --filter @vu/orchestrator...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /app/packages/orchestrator/node_modules ./packages/orchestrator/node_modules
COPY . .
RUN pnpm build --filter @vu/orchestrator...

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/orchestrator/dist ./packages/orchestrator/dist
COPY --from=build /app/packages/orchestrator/package.json ./packages/orchestrator/package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "packages/orchestrator/dist/index.js"]
