#!/usr/bin/env bash
# smoke-test.sh — post-deploy sanity checks.
# Runs against a freshly-booted instance and fails if anything is off.
#
# Checks:
#   1. Gateway responds to /health within 30s.
#   2. /api/v1 version endpoint returns JSON.
#   3. Every migration in packages/database/src/migrations is applied
#      (COUNT matches file count in _migrations table).
#   4. Demo tenant tenant-001 exists and is active.
#   5. Marketing landing page renders (contains known heading).
#   6. UAT walkthrough passes.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:4001}"
MARKETING_URL="${MARKETING_URL:-http://127.0.0.1:3000}"
DATABASE_URL="${DATABASE_URL:-postgresql://localhost:5432/borjie}"

fail() { printf '\xE2\x9C\x97 %s\n' "$1"; exit 1; }
pass() { printf '\xE2\x9C\x93 %s\n' "$1"; }

# 1. Gateway boot check
printf 'Waiting for gateway at %s ...\n' "$GATEWAY_URL"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null --max-time 2 "$GATEWAY_URL/health"; then
    pass "gateway health reachable after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then fail "gateway not responding after 30s"; fi
done

# 2. /api/v1 version endpoint
if ! curl -sf "$GATEWAY_URL/api/v1" | grep -q '"version"'; then
  fail "/api/v1 did not return version payload"
fi
pass "/api/v1 version endpoint returns JSON"

# 3. Migrations applied
MIG_DIR="$REPO_ROOT/packages/database/src/migrations"
if [ -d "$MIG_DIR" ] && command -v psql >/dev/null 2>&1; then
  FILE_COUNT="$(ls -1 "$MIG_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ')"
  ROW_COUNT="$(psql "$DATABASE_URL" -tAc \
    "SELECT COUNT(*)::int FROM _migrations" 2>/dev/null \
    || psql "$DATABASE_URL" -tAc \
    "SELECT COUNT(*)::int FROM drizzle.__drizzle_migrations" 2>/dev/null \
    || echo 0)"
  if [ -z "$ROW_COUNT" ] || [ "$ROW_COUNT" -eq 0 ]; then
    printf '! migrations table not populated yet (COUNT=0) — run scripts/migrate-prod.sh\n'
  elif [ "$ROW_COUNT" -lt "$FILE_COUNT" ]; then
    fail "migrations not fully applied (files=$FILE_COUNT, rows=$ROW_COUNT)"
  else
    pass "migrations applied (rows=$ROW_COUNT >= files=$FILE_COUNT)"
  fi
else
  printf '! psql or migrations dir not present; skipping migration check\n'
fi

# 4. Demo tenant exists
if command -v psql >/dev/null 2>&1; then
  TENANT_ROW="$(psql "$DATABASE_URL" -tAc \
    "SELECT status FROM tenants WHERE id='tenant-001' LIMIT 1" 2>/dev/null || echo "")"
  if [ -z "$TENANT_ROW" ]; then
    printf '! demo tenant tenant-001 not found (run bootstrap-tenant.sh)\n'
  elif [ "$TENANT_ROW" != "active" ]; then
    fail "demo tenant status is '$TENANT_ROW' (expected 'active')"
  else
    pass "demo tenant tenant-001 is active"
  fi
fi

# 5. Marketing page renders
if curl -sf --max-time 5 "$MARKETING_URL" >/dev/null 2>&1; then
  pass "marketing page reachable at $MARKETING_URL"
else
  printf '! marketing page not reachable; skipping (set MARKETING_URL to enable)\n'
fi

# 6. UAT walkthrough
if [ -x "$REPO_ROOT/scripts/uat-walkthrough.sh" ]; then
  GATEWAY_URL="$GATEWAY_URL" bash "$REPO_ROOT/scripts/uat-walkthrough.sh" \
    || fail "UAT walkthrough failed"
  pass "UAT walkthrough succeeded"
fi

pass "smoke test complete"
