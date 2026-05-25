#!/usr/bin/env bash
# bootstrap-tenant.sh — single-command new-tenant provisioning for BORJIE.
#
# Usage:
#   scripts/bootstrap-tenant.sh \
#     --name "Acme Properties" \
#     --country TZ \
#     --admin-email admin@acme.example \
#     --admin-phone "+255712345678" \
#     [--slug acme] [--with-demo-data] [--dry-run] [--json]
#
# Delegates to scripts/bootstrap-tenant.ts for the real work — this wrapper
# only validates tooling, loads env, and runs the tsx script with every
# flag passed through. Exit codes match the Node script.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

die() { printf 'error: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node is required (>=20)"
command -v pnpm >/dev/null 2>&1 || die "pnpm is required (>=8.15)"

if [ -f "$REPO_ROOT/.env" ] && [ -z "${DATABASE_URL:-}" ]; then
  # shellcheck disable=SC1091
  set -a; . "$REPO_ROOT/.env"; set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
  if [ "${BORJIE_ENV:-dev}" = "dev" ] || [ "${BORJIE_ENV:-dev}" = "test" ]; then
    export DATABASE_URL="postgresql://localhost:5432/borjie"
  else
    die "DATABASE_URL is required (production must set it explicitly)"
  fi
fi

# Force strict mode unless the caller asks for a dry-run.
if [[ "$*" != *"--dry-run"* ]] && [ "${BORJIE_ENV:-dev}" = "production" ]; then
  printf 'bootstrap-tenant: production run — creating a new tenant now.\n' >&2
fi

exec pnpm -s exec tsx "$REPO_ROOT/scripts/bootstrap-tenant.ts" "$@"
