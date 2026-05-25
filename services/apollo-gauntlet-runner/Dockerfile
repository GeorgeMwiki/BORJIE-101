# syntax=docker/dockerfile:1.6
# =============================================================================
# BORJIE — apollo-gauntlet-runner
# =============================================================================
# Nightly Apollo-style scheming-detection gauntlet. Plays every scenario
# through the deployed agent under test (configurable via env), scores with
# heuristic + LLM-as-judge scorers, emits a gauntlet report.
#
# Pattern: Apollo Research 2025 (arXiv 2509.15541), adapted to property-
# management surfaces. See `.audit/litfin-sota-2026-05-23/` for the
# canonical wiring plan.
#
# Pure batch — no HTTP listener. CronJob fires the entrypoint, the runner
# completes one pass, exits.
#
# Build:
#   docker build -f services/apollo-gauntlet-runner/Dockerfile \
#     -t borjie/apollo-gauntlet-runner:dev .
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder — install workspace deps + compile the runner package.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Workspace manifests first for cache hits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY .npmrc ./
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@borjie/apollo-gauntlet-runner... --workspace-concurrency=1 build

# -----------------------------------------------------------------------------
# Stage 2: Runner — minimal runtime image.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN apk add --no-cache dumb-init
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker

WORKDIR /app

# Preserve the workspace tree so pnpm symlinks resolve at runtime.
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/package.json ./
COPY --from=builder --chown=worker:nodejs /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=worker:nodejs /app/packages ./packages
COPY --from=builder --chown=worker:nodejs /app/services ./services

WORKDIR /app/services/apollo-gauntlet-runner
USER worker

ENV NODE_ENV=production \
    APOLLO_GAUNTLET_INTERVAL_MS=0

# Run-once entrypoint — CronJob fires this and we exit cleanly.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
