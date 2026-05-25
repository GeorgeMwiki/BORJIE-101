#!/usr/bin/env bash
# load-test-suite.sh — autocannon-driven 10-scenario load test.
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:4001}"

# Fail fast if the gateway is not reachable.
if ! curl -sf -o /dev/null --max-time 5 "$GATEWAY_URL/health"; then
  printf 'load-test: gateway not reachable at %s\n' "$GATEWAY_URL" >&2
  exit 1
fi

mkdir -p "$REPO_ROOT/load-test-reports"
exec node "$REPO_ROOT/scripts/load-test-suite.mjs" "$@"
