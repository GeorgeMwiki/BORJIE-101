# syntax=docker/dockerfile:1.7
#
# Multi-stage build for @borjie/mcp-server-process-intel.
#
# LICENSE SEGREGATION
# -------------------
# Stage 1 (`python-deps`) installs pm4py — AGPL-3.0. The output of this
# stage is a self-contained Python venv at /opt/pm4py-venv.
#
# Stage 2 (`node-build`) and Stage 3 (`runtime`) install the MIT-licensed
# Node code. The runtime image COPYs only:
#   - The Python venv (a binary blob the host calls via stdin/stdout)
#   - The `python/server.py` script (which imports pm4py)
#   - The compiled Node bundle (MIT)
#
# The TypeScript host never imports pm4py symbols — it only spawns the
# Python interpreter as a child process. That OS-level boundary (per
# AGPL section 13) keeps the AGPL'd code separate from our MIT codebase.

# ---------- Stage 1: Python (AGPL) ----------------------------------------
FROM python:3.14-slim-bookworm AS python-deps

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
 && rm -rf /var/lib/apt/lists/*

# Create an isolated venv so pm4py + its AGPL dependencies live in
# /opt/pm4py-venv and never bleed into the system Python.
RUN python -m venv /opt/pm4py-venv
ENV PATH="/opt/pm4py-venv/bin:${PATH}"

COPY python/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r /tmp/requirements.txt

COPY python/ /opt/pm4py-sidecar/

# Drop a notice next to the AGPL deps so anyone inspecting the image
# can see the segregation rationale.
RUN echo "pm4py + its transitive deps are AGPL-3.0. Segregation: process boundary (stdin/stdout). See README.md." \
        > /opt/pm4py-venv/AGPL-NOTICE.txt


# ---------- Stage 2: Node build (MIT) -------------------------------------
FROM node:20-bookworm-slim AS node-build

WORKDIR /build
COPY package.json tsconfig.json ./
COPY src/ ./src/

# pm4py is NOT a Node dependency — we never `npm install` it.
RUN npm install --no-audit --no-fund \
 && npx tsc


# ---------- Stage 3: Runtime ----------------------------------------------
FROM node:20-bookworm-slim AS runtime

# Bring in Python so we can spawn the sidecar.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# AGPL'd Python venv + sidecar script (process-boundary segregated).
COPY --from=python-deps /opt/pm4py-venv /opt/pm4py-venv
COPY --from=python-deps /opt/pm4py-sidecar/server.py /app/python/server.py
COPY --from=python-deps /opt/pm4py-sidecar/__init__.py /app/python/__init__.py

# MIT-licensed Node bundle.
COPY --from=node-build /build/dist /app/dist
COPY --from=node-build /build/node_modules /app/node_modules
COPY package.json /app/package.json

ENV PYTHON_BIN=/opt/pm4py-venv/bin/python
ENV NODE_ENV=production

USER node

ENTRYPOINT ["node", "/app/dist/index.js"]
