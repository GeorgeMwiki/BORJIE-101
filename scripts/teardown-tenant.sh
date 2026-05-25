#!/usr/bin/env bash
# teardown-tenant.sh — for TEST / DEV only. Gated by BORJIE_ALLOW_TEARDOWN.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [ "${BORJIE_ALLOW_TEARDOWN:-}" != "true" ]; then
  printf 'error: set BORJIE_ALLOW_TEARDOWN=true to confirm teardown\n' >&2
  exit 3
fi

command -v node >/dev/null 2>&1 || { printf 'error: node required\n' >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { printf 'error: pnpm required\n' >&2; exit 1; }

if [ -f "$REPO_ROOT/.env" ] && [ -z "${DATABASE_URL:-}" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_ROOT/.env"; set +a
fi
: "${DATABASE_URL:=postgresql://localhost:5432/borjie}"
export DATABASE_URL

exec pnpm -s exec tsx "$REPO_ROOT/scripts/teardown-tenant.ts" "$@"
