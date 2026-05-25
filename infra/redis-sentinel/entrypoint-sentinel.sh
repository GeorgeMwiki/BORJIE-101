#!/bin/sh
# =============================================================================
# Sentinel entrypoint — renders sentinel.conf.tpl from env and exec sentinel
# =============================================================================
set -eu

: "${REDIS_PASSWORD:?REDIS_PASSWORD required}"
: "${REDIS_SENTINEL_NAME:=borjie-master}"
: "${REDIS_PRIMARY_HOST:=redis-primary}"
: "${REDIS_PRIMARY_PORT:=6379}"
: "${REDIS_SENTINEL_QUORUM:=2}"
: "${SENTINEL_PORT:=26379}"
: "${SENTINEL_ANNOUNCE_HOST:?SENTINEL_ANNOUNCE_HOST required (set to container hostname)}"

export REDIS_PASSWORD REDIS_SENTINEL_NAME REDIS_PRIMARY_HOST REDIS_PRIMARY_PORT \
       REDIS_SENTINEL_QUORUM SENTINEL_PORT SENTINEL_ANNOUNCE_HOST

TPL="${TEMPLATE_PATH:-/etc/redis/sentinel.conf.tpl}"
OUT="${OUTPUT_PATH:-/etc/redis/sentinel.conf}"

# envsubst is in gettext; alpine ships busybox which has neither.
# Inline implementation: replace ${VAR} with $VAR for the vars we care about.
sed \
  -e "s|\${SENTINEL_PORT}|${SENTINEL_PORT}|g" \
  -e "s|\${REDIS_SENTINEL_NAME}|${REDIS_SENTINEL_NAME}|g" \
  -e "s|\${REDIS_PRIMARY_HOST}|${REDIS_PRIMARY_HOST}|g" \
  -e "s|\${REDIS_PRIMARY_PORT}|${REDIS_PRIMARY_PORT}|g" \
  -e "s|\${REDIS_SENTINEL_QUORUM}|${REDIS_SENTINEL_QUORUM}|g" \
  -e "s|\${SENTINEL_ANNOUNCE_HOST}|${SENTINEL_ANNOUNCE_HOST}|g" \
  -e "s|\${REDIS_PASSWORD}|${REDIS_PASSWORD}|g" \
  "$TPL" > "$OUT"

exec redis-server "$OUT" --sentinel
