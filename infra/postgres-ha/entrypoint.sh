#!/usr/bin/env bash
# =============================================================================
# Patroni node entrypoint — renders patroni.yml from template + execs patroni
# =============================================================================
# Required env (set per-node in docker-compose.ha.yml):
#   PATRONI_NAME, PATRONI_SCOPE, PATRONI_NAMESPACE
#   PATRONI_RESTAPI_LISTEN, PATRONI_RESTAPI_CONNECT_ADDRESS
#   PATRONI_POSTGRESQL_LISTEN, PATRONI_POSTGRESQL_CONNECT_ADDRESS
#   PATRONI_POSTGRESQL_DATA_DIR
#   PGHA_ETCD_HOSTS
#   PATRONI_SUPERUSER_PASSWORD, PATRONI_REPLICATION_PASSWORD, PATRONI_REWIND_PASSWORD
#   WAL_S3_BUCKET, WAL_S3_PREFIX, WAL_ENCRYPTION_KEY, AWS_REGION
# =============================================================================
set -euo pipefail

TEMPLATE_PATH="${TEMPLATE_PATH:-/etc/patroni/patroni.yml.tpl}"
OUTPUT_PATH="${OUTPUT_PATH:-/etc/patroni/patroni.yml}"

required_vars=(
  PATRONI_NAME
  PATRONI_SCOPE
  PATRONI_NAMESPACE
  PATRONI_RESTAPI_LISTEN
  PATRONI_RESTAPI_CONNECT_ADDRESS
  PATRONI_POSTGRESQL_LISTEN
  PATRONI_POSTGRESQL_CONNECT_ADDRESS
  PATRONI_POSTGRESQL_DATA_DIR
  PGHA_ETCD_HOSTS
  PATRONI_SUPERUSER_PASSWORD
  PATRONI_REPLICATION_PASSWORD
  PATRONI_REWIND_PASSWORD
)

for v in "${required_vars[@]}"; do
  if [[ -z "${!v:-}" ]]; then
    echo "FATAL: required env var $v is empty" >&2
    exit 1
  fi
done

# Render template (envsubst-safe — only ${VAR} forms are substituted).
envsubst < "$TEMPLATE_PATH" > "$OUTPUT_PATH"

# Stage wal-g env (used by archive_command via envdir).
mkdir -p /run/etc/wal-env
: "${WAL_S3_BUCKET:?WAL_S3_BUCKET required for WAL archive}"
: "${WAL_S3_PREFIX:?WAL_S3_PREFIX required for WAL archive}"
: "${AWS_REGION:?AWS_REGION required for WAL archive}"
printf '%s' "s3://${WAL_S3_BUCKET}/${WAL_S3_PREFIX}" > /run/etc/wal-env/WALG_S3_PREFIX
printf '%s' "$AWS_REGION" > /run/etc/wal-env/AWS_REGION
if [[ -n "${WAL_ENCRYPTION_KEY:-}" ]]; then
  printf '%s' "$WAL_ENCRYPTION_KEY" > /run/etc/wal-env/WALG_S3_SSE_KMS_ID
  printf '%s' 'aws:kms' > /run/etc/wal-env/WALG_S3_SSE
fi

chown -R postgres:postgres "$PATRONI_POSTGRESQL_DATA_DIR" /run/etc/wal-env || true
chmod 700 "$PATRONI_POSTGRESQL_DATA_DIR" || true

exec patroni "$OUTPUT_PATH"
