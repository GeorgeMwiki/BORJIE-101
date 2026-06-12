# =============================================================================
# @borjie/api-gateway — production container
# =============================================================================
# Multi-stage build for the Borjie API gateway.
#
# Stage 1 (deps)    : install pnpm, fetch the full workspace, install deps with
#                     a frozen lockfile so the build is fully reproducible.
# Stage 2 (build)   : compile @borjie/database (downstream type provider) and
#                     then @borjie/api-gateway via `pnpm -F ... build`.
# Stage 3 (runtime) : copy only the api-gateway production deps + dist into a
#                     slim Node 20 image, drop to a non-root user, expose 3001.
#
# Build context  : monorepo root (NOT services/api-gateway).
# Build command  : docker build -f services/api-gateway/Dockerfile -t borjie-api-gateway:latest .
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: workspace dependency install
# -----------------------------------------------------------------------------
FROM node:20.18.0-bookworm-slim AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI="true"

RUN corepack enable \
  && corepack prepare pnpm@8.15.0 --activate \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
       python3 \
       build-essential \
       ca-certificates \
       curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY .npmrc ./
COPY turbo.json ./
COPY tsconfig.base.json ./
COPY tsconfig.json ./

COPY apps ./apps
COPY packages ./packages
COPY services ./services
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 2: build api-gateway + transitive workspace packages
# -----------------------------------------------------------------------------
FROM deps AS build

WORKDIR /repo

# Build the FULL @borjie/* dependency closure with turbo (`^build` topo
# order), not raw pnpm filters. Two reasons: (1) several packages declare
# @borjie peers that pnpm's filter graph does not topologically sort, and
# (2) the gateway's tsup config bundles the workspace graph via
# `noExternal: [/^@borjie\//]`, and esbuild resolves each package through
# its package.json entry — which for ~120 packages points at `dist/`. On a
# cache-cold builder those dists only exist if the closure is built first.
# Mirrors docker/Dockerfile.api (the CI/E2E image).
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm exec turbo run build --filter=@borjie/api-gateway --no-daemon

# Prune dev deps for the api-gateway shipping surface only.
RUN pnpm -F @borjie/api-gateway --prod deploy /deploy

# -----------------------------------------------------------------------------
# Stage 3: minimal runtime image
# -----------------------------------------------------------------------------
FROM node:20.18.0-bookworm-slim AS runtime

ENV NODE_ENV="production"
ENV PORT="3001"
ENV HOST="0.0.0.0"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       dumb-init \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 borjie \
  && useradd  --system --uid 1001 --gid borjie --home /app borjie

WORKDIR /app

COPY --from=build --chown=borjie:borjie /deploy/dist           ./dist
COPY --from=build --chown=borjie:borjie /deploy/node_modules   ./node_modules
COPY --from=build --chown=borjie:borjie /deploy/package.json   ./package.json

USER borjie

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:3001/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
