# syntax=docker/dockerfile:1.7
#
# scientific-discovery-sidecar — FastAPI service running DoWhy + Tigramite.
#
# Multi-stage build:
#   Stage 1 (`builder`) installs the heavy numerical + causal stack into
#   a self-contained venv at /opt/venv. Build deps (gcc, gfortran) stay
#   in the builder stage and are dropped in the runtime image.
#
#   Stage 2 (`runtime`) copies the venv + app code into a slim image.
#   The Dockerfile pins the base image SHA-implicit via the version tag
#   so reproducibility is reasonable without a binary lockfile.
#
# Image size targets:
#   builder  : ~1.6 GB (numpy + scipy + sklearn + dowhy + tigramite)
#   runtime  : ~900 MB compressed → ~1.2 GB on disk after venv copy
#
# Final EXPOSE: 8000


# ---------- Stage 1: builder --------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Build deps — gcc/gfortran for numpy/scipy, build-essential for any
# C-extensions DoWhy / Tigramite need to compile from source.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        build-essential \
        gcc \
        gfortran \
        libopenblas-dev \
        liblapack-dev \
        curl \
 && rm -rf /var/lib/apt/lists/*

# Isolated venv keeps everything tidy and easy to COPY across stages.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"

COPY requirements.txt /tmp/requirements.txt
RUN pip install --upgrade pip setuptools wheel \
 && pip install -r /tmp/requirements.txt


# ---------- Stage 2: runtime --------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:${PATH}" \
    DISCOVERY_SIDECAR_HOST=0.0.0.0 \
    DISCOVERY_SIDECAR_PORT=8000 \
    DISCOVERY_SIDECAR_LOG_LEVEL=info

# Runtime deps only — openblas + lapack so numpy/scipy can find their
# BLAS, and curl for the HEALTHCHECK.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        libopenblas0 \
        liblapack3 \
        curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root user — never run FastAPI as root.
RUN groupadd --system app \
 && useradd --system --gid app --create-home --home-dir /home/app app

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY app/ /app/app/
COPY pyproject.toml /app/pyproject.toml

# Make /app importable as a package root for `uvicorn app.main:app`.
RUN chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl --fail --silent http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
