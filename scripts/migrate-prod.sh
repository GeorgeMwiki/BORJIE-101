#!/usr/bin/env bash
# migrate-prod.sh — safely apply pending SQL migrations with an audit trail.
#
# Usage:
#   scripts/migrate-prod.sh [--dry-run] [--json]
#
# Exit codes:
#   0  migrations applied
#   1  error (see stderr)
#   2  already up-to-date (nothing pending)
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f "$REPO_ROOT/.env" ] && [ -z "${DATABASE_URL:-}" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_ROOT/.env"; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  if [ "${NODE_ENV:-}" = "production" ]; then
    printf 'error: DATABASE_URL required in production\n' >&2
    exit 1
  fi
  export DATABASE_URL="postgresql://localhost:5432/borjie"
fi

command -v pnpm >/dev/null 2>&1 || { printf 'error: pnpm required\n' >&2; exit 1; }

exec pnpm -s exec tsx "$REPO_ROOT/scripts/migrate-prod.ts" "$@"
