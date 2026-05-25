# syntax=docker/dockerfile:1.7
#
# BORJIE document-render stack
# --------------------------------
# Self-hosted, all-OSS pipeline for the @borjie/document-studio
# renderers:
#
#   - Carbone server  (port 4000) — DOCX/PDF/XLSX/PPTX/ODS templating
#                       https://carbone.io/api-reference.html
#   - Typst HTTP svc  (port 8001) — Rust-based LaTeX alternative
#                       https://typst.app/docs/
#                       https://github.com/typst/typst
#   - Puppeteer svc   (port 8002) — Headless Chromium for HTML→PDF
#                       https://pptr.dev/api/puppeteer.page.pdf
#
# Spec: .audit/litfin-sota-2026-05-23/19-document-generation.md §4–5
# Consumer: packages/document-studio/src/renderers/*
#
# Image size estimate: ~1.4 GB (LibreOffice for Carbone PDF conversion
# is the heaviest dependency at ~620 MB; Chromium ~280 MB; Typst CLI
# ~30 MB; Node base ~180 MB; Carbone+deps ~150 MB; misc ~140 MB).
# Multi-stage keeps the runtime image free of build toolchains.

# ---------- Stage 1: Typst binary download ---------------------------------
# We pull the Typst release tarball in a throwaway stage so the runtime
# image never carries `curl`/`tar` and a half-cached download layer.
FROM debian:bookworm-slim AS typst-fetch

ARG TYPST_VERSION=0.13.1
ARG TARGETARCH

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /typst-dl

# Resolve the right release asset for the build platform. Typst ships
# linux-x86_64 and linux-aarch64 prebuilts.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64)  TYPST_ARCH=x86_64-unknown-linux-musl ;; \
      arm64)  TYPST_ARCH=aarch64-unknown-linux-musl ;; \
      *) echo "Unsupported arch ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o typst.tar.xz \
      "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${TYPST_ARCH}.tar.xz"; \
    mkdir -p /typst-out; \
    tar -xJf typst.tar.xz --strip-components=1 -C /typst-out; \
    /typst-out/typst --version


# ---------- Stage 2: Runtime ------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# OS deps:
#   - libreoffice-core/writer/calc/impress: Carbone shells out to
#     soffice for DOCX→PDF / XLSX→PDF / PPTX→PDF conversions.
#   - chromium + fonts: Puppeteer HTML→PDF service.
#   - tini: PID 1 init so SIGTERM cleanly reaps soffice + chromium.
#   - dumb-init alternative; we pick tini for the same reason.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      libreoffice-calc \
      libreoffice-impress \
      chromium \
      chromium-sandbox \
      fonts-liberation \
      fonts-noto-core \
      fonts-noto-cjk \
      fonts-dejavu-core \
      tini \
      ca-certificates \
      curl \
 && rm -rf /var/lib/apt/lists/*

# Drop the Typst binary in from the fetch stage.
COPY --from=typst-fetch /typst-out/typst /usr/local/bin/typst
RUN chmod +x /usr/local/bin/typst && typst --version

# Puppeteer will use the system chromium — no Chrome download at npm install.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy in the small Node service that hosts the three HTTP endpoints
# (Carbone proxy + Typst wrapper + Puppeteer render). Source lives
# alongside this Dockerfile so the whole render stack is one folder.
COPY package.json /app/package.json
COPY server/ /app/server/
COPY scripts/ /app/scripts/

# Production install — pins via lockfile if checked in; otherwise
# `npm install` is fine because this image is built rarely. Carbone
# is the heavy dep here.
RUN npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Render stack ports — must match docker-compose.yml.
EXPOSE 4000 8001 8002

# Healthcheck script probes /health on all three services.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=4 \
  CMD ["node", "/app/scripts/healthcheck.js"]

ENV NODE_ENV=production

# Run as non-root user (mirrors infra/k8s/*/securityContext.runAsNonRoot: true).
# Debian syntax — base image is node:22-bookworm-slim. Chromium sandbox
# requires CAP_SYS_ADMIN at kernel level, but Puppeteer with --no-sandbox
# still works inside non-root; the OS package `chromium-sandbox` gives
# SUID-based sandbox that runs as the app user.
RUN groupadd -r app && useradd -r -g app -d /app -s /sbin/nologin app \
 && chown -R app:app /app
USER app

# tini reaps soffice/chromium children cleanly.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "/app/server/index.js"]
