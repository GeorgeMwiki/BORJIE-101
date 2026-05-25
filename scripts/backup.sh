#!/usr/bin/env bash
# backup.sh — encrypted Postgres + Redis snapshot to S3-compatible storage.
#
# Retention: 30 days daily + monthly archive on the 1st of each month.
# Encryption: AES-256-CBC, key read from BACKUP_ENCRYPTION_KEY (raw bytes
#             or hex-encoded 32-byte). Key is NEVER written to disk.
#
# Env:
#   DATABASE_URL              required   — postgres connection string
#   REDIS_URL                 optional   — if unset, Redis snapshot is skipped
#   BACKUP_BUCKET             required   — s3://bucket-name
#   BACKUP_ENCRYPTION_KEY     required   — 32-byte key for AES-256 (hex or raw)
#   BACKUP_PREFIX             optional   — path prefix (default 'borjie')
#   AWS_ENDPOINT_URL_S3       optional   — for R2/B2 compatibility
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  required for upload
#
# Exit codes: 0 success, 1 error, 2 precondition failed.
set -euo pipefail

die() { printf 'backup: error: %s\n' "$1" >&2; exit "${2:-1}"; }

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found" 2
command -v gzip    >/dev/null 2>&1 || die "gzip not found" 2
command -v openssl >/dev/null 2>&1 || die "openssl not found" 2

if [ "${BORJIE_TEST_MODE:-}" = "true" ]; then
  # Test mode short-circuits the S3 leg so the script is exercised in CI
  # without real credentials. The dump file is still produced locally.
  UPLOAD_ENABLED=false
else
  command -v aws >/dev/null 2>&1 || die "aws CLI not found (set BORJIE_TEST_MODE=true to skip)" 2
  UPLOAD_ENABLED=true
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"
if [ "$UPLOAD_ENABLED" = "true" ]; then
  : "${BACKUP_BUCKET:?BACKUP_BUCKET is required}"
fi
BACKUP_PREFIX="${BACKUP_PREFIX:-borjie}"

# Day / month keys
TODAY="$(date -u +%Y-%m-%d)"
MONTH_ID="$(date -u +%Y-%m)"
DAY_OF_MONTH="$(date -u +%d)"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"

WORKDIR="$(mktemp -d -t borjie-backup.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

PG_RAW="$WORKDIR/postgres.dump"
PG_GZ="$WORKDIR/postgres.dump.gz"
PG_ENC="$WORKDIR/postgres.dump.gz.enc"

printf 'backup: dumping postgres...\n' >&2
pg_dump --format=custom --no-owner --no-privileges --compress=0 \
  --file="$PG_RAW" "$DATABASE_URL"
gzip -c "$PG_RAW" >"$PG_GZ"

printf 'backup: encrypting (AES-256-CBC)...\n' >&2
# Use `-pass env:VAR` so the key never appears on the command line / ps output.
export BACKUP_ENC_PASS="$BACKUP_ENCRYPTION_KEY"
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt \
  -in "$PG_GZ" -out "$PG_ENC" -pass env:BACKUP_ENC_PASS
unset BACKUP_ENC_PASS

if [ -n "${REDIS_URL:-}" ] && command -v redis-cli >/dev/null 2>&1; then
  printf 'backup: snapshotting redis...\n' >&2
  redis-cli -u "$REDIS_URL" --no-auth-warning SAVE >/dev/null
  # Redis writes dump.rdb on the server side. We rely on the server-side
  # dump making it into durable storage — capturing it here requires SSH
  # access to the node, which is out of scope for the scripted path.
  printf 'backup: redis SAVE issued (server-side persistence assumed)\n' >&2
fi

DAILY_KEY="$BACKUP_PREFIX/daily/$TODAY/postgres-$TIMESTAMP.dump.gz.enc"
MONTHLY_KEY="$BACKUP_PREFIX/monthly/$MONTH_ID/postgres-$TIMESTAMP.dump.gz.enc"

if [ "$UPLOAD_ENABLED" = "true" ]; then
  AWS_ARGS=()
  if [ -n "${AWS_ENDPOINT_URL_S3:-}" ]; then
    AWS_ARGS=(--endpoint-url "$AWS_ENDPOINT_URL_S3")
  fi
  printf 'backup: uploading daily → %s/%s\n' "$BACKUP_BUCKET" "$DAILY_KEY" >&2
  aws "${AWS_ARGS[@]}" s3 cp "$PG_ENC" "$BACKUP_BUCKET/$DAILY_KEY" --sse AES256
  if [ "$DAY_OF_MONTH" = "01" ]; then
    printf 'backup: uploading monthly archive\n' >&2
    aws "${AWS_ARGS[@]}" s3 cp "$PG_ENC" "$BACKUP_BUCKET/$MONTHLY_KEY" --sse AES256
  fi
  # Retention — delete daily dumps older than 30 days. Monthly archives are kept.
  aws "${AWS_ARGS[@]}" s3 ls "$BACKUP_BUCKET/$BACKUP_PREFIX/daily/" 2>/dev/null \
    | awk '{print $4}' \
    | while read -r path; do
        [ -z "$path" ] && continue
        age_day="${path%%/*}"
        if [ -n "$age_day" ] && [ "$(( $(date -u +%s) - $(date -u -j -f %Y-%m-%d "$age_day" +%s 2>/dev/null || echo 0) ))" -gt $((30 * 86400)) ]; then
          aws "${AWS_ARGS[@]}" s3 rm "$BACKUP_BUCKET/$BACKUP_PREFIX/daily/$path" 2>/dev/null || true
        fi
      done
fi

SIZE="$(wc -c <"$PG_ENC" | tr -d ' ')"
printf 'backup: ok bytes=%s key=%s\n' "$SIZE" "$DAILY_KEY"
