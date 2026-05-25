#!/usr/bin/env bash
# restore.sh — interactive restore from a backup.sh-produced archive.
#
# Destructive. Confirms TWICE and refuses to run unless
# BORJIE_ALLOW_RESTORE=true. After double-confirm, the current DB is
# restored from a downloaded, decrypted, decompressed pg_dump archive.
#
# Usage:
#   BORJIE_ALLOW_RESTORE=true scripts/restore.sh \
#     --key borjie/daily/2026-04-19/postgres-20260419T080000Z.dump.gz.enc \
#     [--from-local path/to/file.dump.gz.enc]
#
# Exit codes: 0 success, 1 error, 3 refused (guard not set).
set -euo pipefail

die() { printf 'restore: error: %s\n' "$1" >&2; exit "${2:-1}"; }

if [ "${BORJIE_ALLOW_RESTORE:-}" != "true" ]; then
  die "set BORJIE_ALLOW_RESTORE=true to confirm restore" 3
fi

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"

KEY=""
LOCAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY="$2"; shift 2 ;;
    --from-local) LOCAL="$2"; shift 2 ;;
    *) die "unknown flag: $1" ;;
  esac
done

if [ -z "$KEY" ] && [ -z "$LOCAL" ]; then
  die "--key or --from-local required"
fi

WORKDIR="$(mktemp -d -t borjie-restore.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

ENC="$WORKDIR/dump.gz.enc"
GZ="$WORKDIR/dump.gz"
RAW="$WORKDIR/dump"

if [ -n "$LOCAL" ]; then
  [ -f "$LOCAL" ] || die "local file not found: $LOCAL"
  cp "$LOCAL" "$ENC"
else
  : "${BACKUP_BUCKET:?BACKUP_BUCKET is required for remote key}"
  command -v aws >/dev/null 2>&1 || die "aws CLI required"
  AWS_ARGS=()
  if [ -n "${AWS_ENDPOINT_URL_S3:-}" ]; then
    AWS_ARGS=(--endpoint-url "$AWS_ENDPOINT_URL_S3")
  fi
  printf 'restore: downloading s3://%s/%s\n' "$BACKUP_BUCKET" "$KEY" >&2
  aws "${AWS_ARGS[@]}" s3 cp "$BACKUP_BUCKET/$KEY" "$ENC"
fi

printf '\nYou are about to OVERWRITE the database at:\n  %s\n\n' "$DATABASE_URL" >&2
printf 'Type the word RESTORE to proceed: ' >&2
read -r first
[ "$first" = "RESTORE" ] || die "aborted (first confirmation failed)"
printf 'Type the key/filename suffix as a second confirm: ' >&2
read -r second
EXPECT_SUFFIX="$(basename "${KEY:-$LOCAL}")"
case "$EXPECT_SUFFIX" in
  *"$second"*) : ;;
  *) die "second confirmation did not match expected suffix" ;;
esac

export BACKUP_ENC_PASS="$BACKUP_ENCRYPTION_KEY"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENC" -out "$GZ" -pass env:BACKUP_ENC_PASS
unset BACKUP_ENC_PASS
gunzip -c "$GZ" >"$RAW"

printf 'restore: applying pg_restore (clean + create)...\n' >&2
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname "$DATABASE_URL" "$RAW"

printf 'restore: ok\n'
