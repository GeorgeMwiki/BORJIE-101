# syntax=docker/dockerfile:1.6
# =============================================================================
# BORJIE — sleep-pass-orchestrator
# =============================================================================
# Always-on 60s heartbeat orchestrator that dispatches 8 off-peak sleep
# passes (DLQ replay, cache warm-up, data-quality scan, index maintenance,
# audit-chain verify, expired-token cleanup, metrics rollup, dormant-tenant
# detector).
#
# Each pass is time-boxed via AbortController. Adapters are injected
# (Drizzle/Redis ports) at the composition root in `src/index.ts`.
# Ported from LITFIN PROJECT/src/core/heartbeat.
#
# Exposes:
#   - GET /healthz  — liveness (always 200 once Fastify has bound the port)
#   - GET /readyz   — readiness (DB ping when wired, else memory mode)
#   - GET /metrics  — Prometheus exposition on the app port (3040)
#
# Build:
#   docker build -f services/sleep-pass-orchestrator/Dockerfile \
#     -t borjie/sleep-pass-orchestrator:dev .
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder — install workspace deps + compile.
# -----------------------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json tsconfig.json ./
COPY .npmrc ./
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@borjie/sleep-pass-orchestrator... --workspace-concurrency=1 build

# -----------------------------------------------------------------------------
# Stage 2: Runner — minimal runtime image.
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

WORKDIR /app/services/sleep-pass-orchestrator
USER worker

ENV NODE_ENV=production \
    PORT=3040 \
    HOST=0.0.0.0 \
    HEARTBEAT_INTERVAL_MS=60000

EXPOSE 3040

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
