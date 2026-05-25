#!/bin/sh
# =============================================================================
# Redis replica entrypoint — renders config from env and exec redis-server
# =============================================================================
set -eu

: "${REDIS_PASSWORD:?REDIS_PASSWORD required}"
: "${REDIS_PRIMARY_HOST:=redis-primary}"
: "${REDIS_PRIMARY_PORT:=6379}"
: "${REDIS_REPLICA_ANNOUNCE_HOST:?REDIS_REPLICA_ANNOUNCE_HOST required (e.g. redis-replica-1)}"

export REDIS_PRIMARY_HOST REDIS_PRIMARY_PORT REDIS_REPLICA_ANNOUNCE_HOST

TPL="${TEMPLATE_PATH:-/etc/redis/redis-replica.conf.tpl}"
OUT="${OUTPUT_PATH:-/etc/redis/redis-replica.conf}"

sed \
  -e "s|\${REDIS_PRIMARY_HOST}|${REDIS_PRIMARY_HOST}|g" \
  -e "s|\${REDIS_PRIMARY_PORT}|${REDIS_PRIMARY_PORT}|g" \
  -e "s|\${REDIS_REPLICA_ANNOUNCE_HOST}|${REDIS_REPLICA_ANNOUNCE_HOST}|g" \
  "$TPL" > "$OUT"

exec redis-server "$OUT" \
  --requirepass "$REDIS_PASSWORD" \
  --masterauth "$REDIS_PASSWORD"
