# syntax=docker/dockerfile:1.6
#
# Muzima Field Capture Service — mobile-app-facing endpoints for
# surveyor photo/video/audio/inspection/polygon uploads.
#
# Spec: Docs/requirements/VOICE_MEMO_2026-04-18_questionnaire_analysis.md §2-§3.
#
# Multi-stage build preserving the pnpm workspace layout (matches the
# services/api-gateway runner fix in commit 9b75f599 and the
# services/onboarding-orchestrator pattern).

FROM node:20-alpine AS builder
WORKDIR /repo

# Workspace manifests first for cache hits.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.base.json ./

# Peer / workspace deps that field-capture-service compiles against.
COPY packages/observability/package.json packages/observability/tsconfig.json packages/observability/
COPY packages/observability/src packages/observability/src
COPY packages/geo-intelligence/package.json packages/geo-intelligence/tsconfig.json packages/geo-intelligence/
COPY packages/geo-intelligence/src packages/geo-intelligence/src

COPY services/field-capture-service/package.json services/field-capture-service/tsconfig.json services/field-capture-service/
COPY services/field-capture-service/src services/field-capture-service/src

RUN corepack enable && pnpm install --filter @borjie/field-capture-service... --frozen-lockfile
RUN pnpm --filter @borjie/observability build || true
RUN pnpm --filter @borjie/geo-intelligence build
RUN pnpm --filter @borjie/field-capture-service build

FROM node:20-alpine AS runner
WORKDIR /repo

# Preserve the workspace layout — pnpm-style nested node_modules need it.
COPY --from=builder /repo /repo

ENV NODE_ENV=production
EXPOSE 9020
WORKDIR /repo/services/field-capture-service

# Run as non-root user (mirrors infra/k8s/*/securityContext.runAsNonRoot: true)
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /repo
USER app

CMD ["node", "dist/index.js"]
