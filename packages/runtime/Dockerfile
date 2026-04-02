FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm && apk add --no-cache git

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/core/package.json ./packages/core/
COPY packages/orchestrator/package.json ./packages/orchestrator/
COPY packages/runtime/package.json ./packages/runtime/
RUN pnpm install --frozen-lockfile --filter @vu-orchestration/runtime...

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build --filter @vu-orchestration/runtime...

FROM node:22-alpine AS runtime
RUN apk add --no-cache git
WORKDIR /app
COPY --from=build /app/packages/*/dist ./packages/
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "packages/runtime/dist/index.js"]
