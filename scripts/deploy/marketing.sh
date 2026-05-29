#!/usr/bin/env bash
# =============================================================================
# scripts/deploy/marketing.sh — one-command Vercel deploy for @borjie/marketing
# =============================================================================
# Pre-requisites (run ONCE per laptop):
#   1. npm i -g vercel@latest          # install CLI
#   2. vercel login                    # auth (opens browser)
#   3. cd apps/marketing && vercel link
#      → choose Borjie org, project name `borjie-marketing` (create if missing)
#   4. Populate env vars in Vercel Dashboard → Settings → Environment Variables
#      using apps/marketing/.env.production.example as the checklist.
#
# Then any time you want to deploy:
#   ./scripts/deploy/marketing.sh             # preview deploy (default)
#   ./scripts/deploy/marketing.sh production  # production deploy (--prod)
#
# Source-of-truth: Docs/OPS/DEPLOY_VERCEL_RUNBOOK.md
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="$REPO_ROOT/apps/marketing"
MODE="${1:-preview}"

# Colour helpers (chalk-equivalent — no console.log per CLAUDE.md).
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RESET=$'\033[0m'

log()  { printf '%s%s%s\n' "$CYAN"   "[deploy:marketing] $*" "$RESET"; }
ok()   { printf '%s%s%s\n' "$GREEN"  "[deploy:marketing] $*" "$RESET"; }
warn() { printf '%s%s%s\n' "$YELLOW" "[deploy:marketing] $*" "$RESET"; }
err()  { printf '%s%s%s\n' "$RED"    "[deploy:marketing] $*" "$RESET" >&2; }

log "Repo root: $REPO_ROOT"
log "Mode: $MODE"

if ! command -v vercel >/dev/null 2>&1; then
  err "vercel CLI not installed. Run: npm i -g vercel@latest"
  exit 1
fi

if [[ ! -f "$APP_DIR/.vercel/project.json" ]]; then
  err "Project not linked. From $APP_DIR run: vercel link"
  exit 1
fi

cd "$APP_DIR"

# Vercel auto-detects Next, reads our vercel.json, and pulls env vars from the
# linked project. We pass --yes to skip the interactive confirmation since this
# is a scripted deploy.
if [[ "$MODE" == "production" ]]; then
  warn "DEPLOYING TO PRODUCTION — proceeding in 3s. Ctrl-C to abort."
  sleep 3
  vercel pull --yes --environment=production
  vercel build --prod
  DEPLOY_URL=$(vercel deploy --prebuilt --prod --yes)
else
  vercel pull --yes --environment=preview
  vercel build
  DEPLOY_URL=$(vercel deploy --prebuilt --yes)
fi

ok "Deployed: $DEPLOY_URL"
printf '%s\n' "$DEPLOY_URL" > "$REPO_ROOT/.deploy-url-marketing"
ok "URL saved to .deploy-url-marketing (gitignored)"
