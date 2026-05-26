# =============================================================================
# BORJIE — wave-resilience-manager (Wave 18DD)
# =============================================================================
# Per AGENT_SELF_REVIVAL_SPEC: detect crashed agent waves, revive them from
# the last checkpoint, drive to 100% completion automatically.
#
# Build:
#   docker build -f services/wave-resilience-manager/Dockerfile \
#     -t borjie/wave-resilience-manager:dev .
#
# Run:
#   docker run --rm \
#     -e DATABASE_URL=postgres://... \
#     -e PORT=4090 \
#     borjie/wave-resilience-manager:dev
# =============================================================================

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY .npmrc ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./
COPY --from=deps /app/pnpm-lock.yaml ./
COPY --from=deps /app/pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY services ./services
RUN pnpm --filter=@borjie/wave-resilience-manager... --workspace-concurrency=1 build

FROM node:22-alpine AS runner
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/services/wave-resilience-manager/dist ./dist
COPY --from=builder /app/services/wave-resilience-manager/package.json ./package.json
COPY --from=deps    /app/node_modules ./node_modules
EXPOSE 4090
CMD ["node", "dist/index.js"]
