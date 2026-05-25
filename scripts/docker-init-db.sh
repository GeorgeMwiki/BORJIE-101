#!/usr/bin/env bash
# =============================================================================
# docker-init-db.sh — concatenate every SQL migration into one init file
# =============================================================================
# The `postgres` docker image runs everything under /docker-entrypoint-initdb.d
# in lexical order on FIRST BOOT (i.e. when the data directory is empty).
#
# We mount packages/database/src/migrations as a read-only volume, but the
# image only executes files whose names end in .sql/.sh — existing names
# already satisfy that. This helper is kept for CI/local verification: it
# prints the concatenated migration order so a dev can confirm there are no
# gaps before running `docker compose up`.
#
# Usage:
#   ./scripts/docker-init-db.sh            # prints concat order to stdout
#   ./scripts/docker-init-db.sh > init.sql # writes a single combined file
# =============================================================================

set -euo pipefail

MIGRATION_DIR="$(cd "$(dirname "$0")/.." && pwd)/packages/database/src/migrations"

if [[ ! -d "$MIGRATION_DIR" ]]; then
  echo "ERROR: migration dir not found: $MIGRATION_DIR" >&2
  exit 1
fi

echo "-- ============================================================"
echo "-- BORJIE — combined migrations generated at $(date -u +%FT%TZ)"
echo "-- Source: $MIGRATION_DIR"
echo "-- ============================================================"
echo

# pgvector extension bootstrap (document-intelligence requires it).
echo "-- Ensure pgvector extension is available before any migration runs."
echo "CREATE EXTENSION IF NOT EXISTS vector;"
echo

for f in $(ls "$MIGRATION_DIR"/*.sql | sort); do
  echo
  echo "-- ---------- $(basename "$f") ----------"
  cat "$f"
  echo
done
