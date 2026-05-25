# =============================================================================
# BORJIE — consolidation-worker
# =============================================================================
# A long-running worker process that pulls the last 24h of unconsumed
# `kernel_cot_reservoir` rows and writes consolidated semantic facts via
# the @borjie/database semantic-memory service.
#
# Build:
#   docker build -f services/consolidation-worker/Dockerfile \
#     -t borjie/consolidation-worker:dev .
#
# Run:
#   docker run --rm \
#     -e DATABASE_URL=postgres://... \
#     -e CONSOLIDATION_INTERVAL_MS=3600000 \
#     borjie/consolidation-worker:dev
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
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

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
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

RUN pnpm --filter=@borjie/consolidation-worker... --workspace-concurrency=1 build

# -----------------------------------------------------------------------------
# Stage 3: Runner
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN apk add --no-cache dumb-init
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker

WORKDIR /app

# Keep the full workspace tree so pnpm symlinks resolve at runtime.
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/package.json ./
COPY --from=builder --chown=worker:nodejs /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=worker:nodejs /app/packages ./packages
COPY --from=builder --chown=worker:nodejs /app/services ./services

WORKDIR /app/services/consolidation-worker
USER worker

ENV NODE_ENV=production \
    CONSOLIDATION_INTERVAL_MS=3600000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
