# =============================================================================
# BORJIE — voice-agent service ("Mr. Mwikila")
# =============================================================================
# Sub-1s realtime voice agent for rent reminders, viewing bookings and
# maintenance intake. Exposes a thin Fastify HTTP surface that mints session
# IDs + WebSocket URLs; the inbound audio/transcript stream itself is brokered
# by the provider pipeline (gpt-realtime-2 primary, ElevenLabs v3 for
# Swahili/Bantu, Lelapa Vulavula for Sw/Lug, Spitch for Yo/Ig/Ha, Cartesia
# Sonic-2 for low-latency en fallback).
#
# Telephony (Twilio/SIP bridge) is intentionally OUT OF SCOPE here — defer to
# a downstream service. See `.audit/litfin-sota-2026-05-23/
# 14-multimodal-generative.md` (§3 Voice / audio SOTA).
#
# Required env vars at runtime (provider stubs read these — see
# src/providers/*):
#   OPENAI_API_KEY         gpt-realtime-2 primary
#   ELEVENLABS_API_KEY     ElevenLabs v3 (Swahili / Bantu / multilingual)
#   LELAPA_API_KEY         Lelapa Vulavula (Sw / Lug / SA-Bantu STT)
#   SPITCH_API_KEY         Spitch (Yo / Ig / Ha)
#   CARTESIA_API_KEY       Cartesia Sonic-2 low-latency fallback
#
# Build:
#   docker build -f services/voice-agent/Dockerfile \
#     -t borjie/voice-agent:dev .
#
# Run:
#   docker run --rm -p 8080:8080 \
#     -e OPENAI_API_KEY=... -e ELEVENLABS_API_KEY=... \
#     -e LELAPA_API_KEY=... -e SPITCH_API_KEY=... -e CARTESIA_API_KEY=... \
#     borjie/voice-agent:dev
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

RUN pnpm --filter=@borjie/voice-agent... --workspace-concurrency=1 build

# -----------------------------------------------------------------------------
# Stage 3: Runner
# -----------------------------------------------------------------------------
FROM node:22-alpine AS runner

RUN apk add --no-cache dumb-init
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 voice

WORKDIR /app

# Keep the full workspace tree so pnpm symlinks resolve at runtime.
COPY --from=builder --chown=voice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=voice:nodejs /app/package.json ./
COPY --from=builder --chown=voice:nodejs /app/pnpm-workspace.yaml ./
COPY --from=builder --chown=voice:nodejs /app/packages ./packages
COPY --from=builder --chown=voice:nodejs /app/services ./services

WORKDIR /app/services/voice-agent
USER voice

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
