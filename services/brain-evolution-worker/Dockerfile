# =============================================================================
# BORJIE — brain-evolution-worker
# =============================================================================
# Sleep-time consolidator. Runs nightly at 02:00 tenant-local time (or by
# Kubernetes CronJob in UTC). Re-reads the day's interaction traces per
# tenant, reflects with a 3-LLM jury, extracts memory deltas, runs each
# delta through the BORJIE Constitution citation verifier, writes the
# survivors into core_memory_blocks + kernel_memory_semantic, and emits a
# `brain-evolution-report` event for the admin portal.
#
# Pattern: Letta sleep-time agents + Harvey 6x task-completion lift study +
# Anthropic "dreaming" pattern. See `.audit/litfin-sota-2026-05-23/
# 09-closed-loop-company-os.md` (Wave-3 task #15).
#
# Build:
#   docker build -f services/brain-evolution-worker/Dockerfile \
#     -t borjie/brain-evolution-worker:dev .
#
# Run:
#   docker run --rm \
#     -e DATABASE_URL=postgres://... \
#     -e BRAIN_EVOLUTION_INTERVAL_MS=0 \
#     borjie/brain-evolution-worker:dev
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

RUN pnpm --filter=@borjie/brain-evolution-worker... --workspace-concurrency=1 build

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

WORKDIR /app/services/brain-evolution-worker
USER worker

ENV NODE_ENV=production \
    BRAIN_EVOLUTION_INTERVAL_MS=0

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
