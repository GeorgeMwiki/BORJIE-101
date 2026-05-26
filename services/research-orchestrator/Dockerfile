# =============================================================================
# BORJIE — research-orchestrator
# =============================================================================
# Deep Research engine — Planner + Executor + Scorer + Synthesizer pipeline
# for the 5 research modes (Reactive Query, Anticipatory Sweep, Daily Briefing,
# Deep Dive, Continuous Watch). Owns the cron-driven Daily Briefing and the
# per-watch Continuous Watch loop.
#
# Build:
#   docker build -f services/research-orchestrator/Dockerfile \
#     -t borjie/research-orchestrator:dev .
#
# Run:
#   docker run --rm \
#     -e DATABASE_URL=postgres://... \
#     -e REDIS_URL=redis://... \
#     -e TAVILY_API_KEY=... \
#     -e EXA_API_KEY=... \
#     borjie/research-orchestrator:dev
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

RUN pnpm --filter=@borjie/research-orchestrator... --workspace-concurrency=1 build

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

WORKDIR /app/services/research-orchestrator
USER worker

ENV NODE_ENV=production \
    PORT=4011

EXPOSE 4011

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
