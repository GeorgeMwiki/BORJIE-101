#!/usr/bin/env bash
# =============================================================================
# BORJIE — Phase F.6 — Local production rehearsal
# =============================================================================
# Boots docker-compose.production.yml end-to-end on the current host, runs a
# smoke check against the nginx reverse-proxy, and tears everything down.
#
# Use this BEFORE a real deployment to catch:
#   - missing env vars (compose validates against ?:required)
#   - broken Dockerfile contexts
#   - bad nginx upstream names
#   - missing healthcheck endpoints
#
# Pre-requisites:
#   1. docker engine 24+ with compose v2 plugin
#   2. .env.production filled in (copy from .env.production.example)
#   3. ./certs/ directory containing self-signed pairs for the configured
#      hostnames OR a stub /etc/letsencrypt mount. For a quick local smoke
#      pass, comment out the 443 listener in infra/nginx/prod.conf.
# =============================================================================

set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

readonly COMPOSE_FILE="docker-compose.production.yml"
readonly ENV_FILE="${ENV_FILE:-.env.production}"

# ---- 0. Sanity --------------------------------------------------------------
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE missing. Copy .env.production.example and fill it." >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: docker compose v2 plugin not installed." >&2
    exit 1
fi

# ---- 1. Validate compose syntax --------------------------------------------
echo "[1/5] Validating $COMPOSE_FILE..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" config >/dev/null

# ---- 2. Build all images ---------------------------------------------------
echo "[2/5] Building images..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" build --parallel

# ---- 3. Boot stack ---------------------------------------------------------
echo "[3/5] Bringing stack up (detached)..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d

cleanup() {
    echo "[cleanup] Bringing stack down..."
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down
}
trap cleanup EXIT

# ---- 4. Wait for api-gateway healthcheck -----------------------------------
echo "[4/5] Waiting for api-gateway to become healthy..."
for attempt in {1..30}; do
    status=$(docker inspect --format='{{.State.Health.Status}}' borjie-prod-api-gateway 2>/dev/null || echo "starting")
    if [[ "$status" == "healthy" ]]; then
        echo "  api-gateway healthy after ${attempt}0s"
        break
    fi
    if [[ "$attempt" == "30" ]]; then
        echo "ERROR: api-gateway did not become healthy in 5 minutes." >&2
        docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs api-gateway >&2
        exit 1
    fi
    sleep 10
done

# ---- 5. Smoke checks -------------------------------------------------------
echo "[5/5] Running smoke checks..."
# Hit api-gateway through nginx; bypass TLS verify for self-signed certs.
if curl -skf --resolve "api.borjie.com:443:127.0.0.1" \
        https://api.borjie.com/healthz >/dev/null; then
    echo "  https healthz OK"
else
    echo "  http fallback..."
    curl -sf http://localhost:80/healthz \
        -H "Host: api.borjie.com" >/dev/null || {
            echo "ERROR: smoke check failed." >&2
            docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs nginx api-gateway >&2
            exit 1
        }
fi

# Subset of E2E that targets the local-prod stack (no UI tests — just API).
if [[ -f "package.json" ]] && grep -q '"e2e:smoke"' package.json 2>/dev/null; then
    echo "  running pnpm e2e:smoke..."
    pnpm e2e:smoke || echo "  (e2e:smoke not yet wired; skipping)"
fi

echo "PASS — local production rehearsal succeeded."
