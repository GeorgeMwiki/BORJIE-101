# =============================================================================
# BORJIE — junior-evolution-worker
# =============================================================================
# Lifecycle worker for dynamically-spawned + tenant-authored juniors.
# Runs nightly at 04:00 UTC (two hours after the UI evolution sweep).
#
# Spec: Docs/DESIGN/JUNIOR_DYNAMIC_SPAWNING_SPEC.md §7.
#
# Build:
#   docker build -f services/junior-evolution-worker/Dockerfile \
#     -t borjie/junior-evolution-worker:dev .
#
# Run (one-shot mode):
#   docker run --rm -e JUNIOR_EVO_ONESHOT=1 \
#     borjie/junior-evolution-worker:dev
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

RUN pnpm --filter=@borjie/junior-evolution-worker... --workspace-concurrency=1 build

# -----------------------------------------------------------------------------
# Stage 3: Runner
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN apk add --no-cache dumb-init
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker

WORKDIR /app

COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/package.json ./
COPY --from=builder --chown=worker:nodejs /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=worker:nodejs /app/packages ./packages
COPY --from=builder --chown=worker:nodejs /app/services ./services

WORKDIR /app/services/junior-evolution-worker
USER worker

ENV NODE_ENV=production

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
