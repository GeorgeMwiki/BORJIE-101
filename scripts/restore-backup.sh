#!/usr/bin/env bash
# restore-backup.sh — non-interactive companion to scripts/restore.sh.
#
# Downloads an encrypted backup from S3 (or copies from a local file),
# decrypts it with AES-256-CBC, decompresses the gzip layer, and writes a
# raw pg_dump custom-format archive to --output.
#
# Designed for automated restore drills (see
# .github/workflows/backup-restore-test.yml) where there is no human to
# answer the interactive prompts in restore.sh. This script DOES NOT
# touch a database — it only materialises the dump file.
#
# Usage:
#   scripts/restore-backup.sh \
#     --s3-uri s3://bucket/borjie/daily/2026-05-20/postgres-...dump.gz.enc \
#     --output /tmp/restored.dump
#
#   scripts/restore-backup.sh \
#     --from-local /tmp/snapshot.dump.gz.enc \
#     --output /tmp/restored.dump
#
#   # Auto-pick the most recent daily backup in the bucket
#   scripts/restore-backup.sh \
#     --latest \
#     --bucket s3://bucket \
#     --prefix borjie \
#     --output /tmp/restored.dump
#
# Env:
#   BACKUP_ENCRYPTION_KEY     required   — same key used by backup.sh
#   AWS_ENDPOINT_URL_S3       optional   — for R2/B2 compatibility
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  required when downloading
#
# Exit codes: 0 success, 1 error, 2 precondition failed.
set -euo pipefail

die() { printf 'restore-backup: error: %s\n' "$1" >&2; exit "${2:-1}"; }
log() { printf 'restore-backup: %s\n' "$1" >&2; }

command -v openssl >/dev/null 2>&1 || die "openssl not found" 2
command -v gzip    >/dev/null 2>&1 || die "gzip not found" 2

S3_URI=""
LOCAL=""
OUTPUT=""
LATEST=false
BUCKET=""
PREFIX="borjie"

while [ $# -gt 0 ]; do
  case "$1" in
    --s3-uri)     S3_URI="$2"; shift 2 ;;
    --from-local) LOCAL="$2"; shift 2 ;;
    --output)     OUTPUT="$2"; shift 2 ;;
    --latest)     LATEST=true; shift ;;
    --bucket)     BUCKET="$2"; shift 2 ;;
    --prefix)     PREFIX="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "$0" >&2
      exit 0
      ;;
    *) die "unknown flag: $1" ;;
  esac
done

[ -n "$OUTPUT" ] || die "--output is required"

# Resolve source: explicit --s3-uri / --from-local / --latest discovery.
if $LATEST; then
  [ -n "$BUCKET" ] || die "--bucket is required with --latest"
  command -v aws >/dev/null 2>&1 || die "aws CLI required for --latest" 2

  AWS_ARGS=()
  if [ -n "${AWS_ENDPOINT_URL_S3:-}" ]; then
    AWS_ARGS=(--endpoint-url "$AWS_ENDPOINT_URL_S3")
  fi

  log "discovering latest daily under $BUCKET/$PREFIX/daily/"
  # `aws s3 ls --recursive` prints "date time size key". Newest at the
  # bottom by date+time. Pick the last .dump.gz.enc.
  LATEST_KEY="$(
    aws "${AWS_ARGS[@]}" s3 ls --recursive "$BUCKET/$PREFIX/daily/" 2>/dev/null \
      | awk '{print $4}' \
      | grep -E '\.dump\.gz\.enc$' \
      | sort \
      | tail -n1 || true
  )"
  [ -n "$LATEST_KEY" ] || die "no daily backups found under $BUCKET/$PREFIX/daily/"
  S3_URI="$BUCKET/$LATEST_KEY"
  log "resolved latest: $S3_URI"
fi

if [ -z "$S3_URI" ] && [ -z "$LOCAL" ]; then
  die "--s3-uri, --from-local, or --latest required"
fi

: "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is required}"

WORKDIR="$(mktemp -d -t borjie-restore-backup.XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

ENC="$WORKDIR/dump.gz.enc"
GZ="$WORKDIR/dump.gz"

if [ -n "$LOCAL" ]; then
  [ -f "$LOCAL" ] || die "local file not found: $LOCAL"
  cp "$LOCAL" "$ENC"
  log "loaded local: $LOCAL"
else
  command -v aws >/dev/null 2>&1 || die "aws CLI required to fetch s3 uri" 2
  AWS_ARGS=()
  if [ -n "${AWS_ENDPOINT_URL_S3:-}" ]; then
    AWS_ARGS=(--endpoint-url "$AWS_ENDPOINT_URL_S3")
  fi
  log "downloading $S3_URI"
  aws "${AWS_ARGS[@]}" s3 cp "$S3_URI" "$ENC" >&2
fi

ENC_SIZE="$(wc -c <"$ENC" | tr -d ' ')"
[ "$ENC_SIZE" -gt 0 ] || die "encrypted archive is empty"
log "encrypted bytes=$ENC_SIZE"

log "decrypting (AES-256-CBC, pbkdf2, 200000 iter)..."
export BACKUP_ENC_PASS="$BACKUP_ENCRYPTION_KEY"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$ENC" -out "$GZ" -pass env:BACKUP_ENC_PASS
unset BACKUP_ENC_PASS

log "decompressing gzip..."
gunzip -c "$GZ" >"$OUTPUT"

OUT_SIZE="$(wc -c <"$OUTPUT" | tr -d ' ')"
[ "$OUT_SIZE" -gt 0 ] || die "decompressed dump is empty"

# pg_dump custom-format archives start with "PGDMP". A sanity check here
# catches the case where the wrong key was used but openssl exited 0
# (rare with pbkdf2+iter, but cheap to verify).
HEADER="$(head -c 5 "$OUTPUT" 2>/dev/null || true)"
if [ "$HEADER" != "PGDMP" ]; then
  die "decrypted output does not start with PGDMP magic — wrong key or corrupt backup?"
fi

printf 'restore-backup: ok output=%s bytes=%s source=%s\n' \
  "$OUTPUT" "$OUT_SIZE" "${S3_URI:-$LOCAL}"
