#!/usr/bin/env bash
# restore-smoke-test.sh — post-restore verification queries.
#
# Runs a small set of structural + row-count probes against a database
# that has just been restored from an encrypted backup. Exits 0 if every
# probe passes, 1 with a per-probe failure summary otherwise.
#
# Designed to be called by .github/workflows/backup-restore-test.yml
# after pg_restore completes.
#
# Usage:
#   scripts/restore-smoke-test.sh --db-url postgres://... [--min-rows-tenants 1]
#
# Flags:
#   --db-url URL              required — connection string to verify
#   --min-rows-tenants N      optional — default 1
#   --min-rows-users N        optional — default 1
#   --min-rows-properties N   optional — default 1
#   --min-rows-leases N       optional — default 0  (leases may be empty in early-stage tenants)
#   --min-rows-payments N     optional — default 0
#   --summary-file PATH       optional — write a markdown summary to this path (for GH job summary)
#
# Exit codes: 0 success, 1 a probe failed, 2 precondition failed.
set -euo pipefail

die() { printf 'smoke: error: %s\n' "$1" >&2; exit "${2:-1}"; }
log() { printf 'smoke: %s\n' "$1" >&2; }

command -v psql >/dev/null 2>&1 || die "psql not found" 2

DB_URL=""
MIN_TENANTS=1
MIN_USERS=1
MIN_PROPERTIES=1
MIN_LEASES=0
MIN_PAYMENTS=0
SUMMARY_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --db-url)              DB_URL="$2"; shift 2 ;;
    --min-rows-tenants)    MIN_TENANTS="$2"; shift 2 ;;
    --min-rows-users)      MIN_USERS="$2"; shift 2 ;;
    --min-rows-properties) MIN_PROPERTIES="$2"; shift 2 ;;
    --min-rows-leases)     MIN_LEASES="$2"; shift 2 ;;
    --min-rows-payments)   MIN_PAYMENTS="$2"; shift 2 ;;
    --summary-file)        SUMMARY_FILE="$2"; shift 2 ;;
    -h|--help)             sed -n '2,30p' "$0" >&2; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
done

[ -n "$DB_URL" ] || die "--db-url is required"

# psql settings: terse output, no header, no pager, no padding.
PSQL_ARGS=(-X -A -t -v ON_ERROR_STOP=1)

run_query() {
  # echo only the value, suppress NOTICE chatter.
  psql "${PSQL_ARGS[@]}" "$DB_URL" -c "$1" 2>/dev/null | tr -d ' \r\n'
}

START="$(date +%s)"
FAILURES=()
declare -a TABLE_NAMES=(tenants users properties leases payments)
declare -a TABLE_MINS=("$MIN_TENANTS" "$MIN_USERS" "$MIN_PROPERTIES" "$MIN_LEASES" "$MIN_PAYMENTS")
declare -a TABLE_COUNTS=()

log "verifying connectivity to db..."
SERVER_VERSION="$(run_query 'SHOW server_version;' || true)"
[ -n "$SERVER_VERSION" ] || { FAILURES+=("could not connect / SHOW server_version returned nothing"); SERVER_VERSION="unknown"; }
log "server_version=$SERVER_VERSION"

# Existence probe: every required table must be in information_schema.
log "probing required tables exist..."
for t in "${TABLE_NAMES[@]}"; do
  exists="$(run_query "SELECT to_regclass('public.${t}') IS NOT NULL;" || true)"
  if [ "$exists" != "t" ]; then
    FAILURES+=("table public.${t} is missing")
  fi
done

# Row-count probe (only run if the table exists — avoids cascading errors).
log "counting rows..."
for i in "${!TABLE_NAMES[@]}"; do
  t="${TABLE_NAMES[$i]}"
  min="${TABLE_MINS[$i]}"
  exists="$(run_query "SELECT to_regclass('public.${t}') IS NOT NULL;" || true)"
  if [ "$exists" = "t" ]; then
    count="$(run_query "SELECT count(*) FROM public.${t};" || echo "")"
    if [ -z "$count" ]; then
      FAILURES+=("could not count rows in ${t}")
      count="?"
    elif [ "$count" -lt "$min" ]; then
      FAILURES+=("${t}: ${count} rows < min ${min}")
    fi
    TABLE_COUNTS+=("${t}=${count}")
  else
    TABLE_COUNTS+=("${t}=missing")
  fi
done

# Structural integrity probes that catch a partial / aborted restore.
log "checking primary-key uniqueness on tenants..."
DUP_PK="$(run_query "
  SELECT count(*) FROM (
    SELECT id, count(*) AS c FROM public.tenants GROUP BY id HAVING count(*) > 1
  ) d;
" 2>/dev/null || echo "0")"
if [ -n "$DUP_PK" ] && [ "$DUP_PK" != "0" ]; then
  FAILURES+=("tenants has $DUP_PK duplicate id rows — PK constraint lost?")
fi

# Schema-migration table presence (ensures the dump captured the migration ledger).
MIG_TABLE="$(run_query "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL;" || true)"
if [ "$MIG_TABLE" != "t" ]; then
  FAILURES+=("drizzle.__drizzle_migrations missing — migration ledger not in backup")
fi

END="$(date +%s)"
DURATION=$((END - START))

# Emit a human summary to stdout AND optionally to GH job-summary file.
emit_summary() {
  local out="$1"
  {
    printf '## Backup restore smoke test\n\n'
    printf '- Server: %s\n' "$SERVER_VERSION"
    printf '- Duration: %ss\n' "$DURATION"
    printf '- Probes: %s\n\n' "$([ "${#FAILURES[@]}" -eq 0 ] && echo PASS || echo FAIL)"
    printf '### Row counts\n\n'
    printf '| Table | Count | Min required |\n'
    printf '| --- | ---: | ---: |\n'
    for i in "${!TABLE_NAMES[@]}"; do
      local t="${TABLE_NAMES[$i]}"
      local min="${TABLE_MINS[$i]}"
      local kv="${TABLE_COUNTS[$i]:-${t}=?}"
      printf '| %s | %s | %s |\n' "$t" "${kv#*=}" "$min"
    done
    if [ "${#FAILURES[@]}" -gt 0 ]; then
      printf '\n### Failures\n\n'
      for f in "${FAILURES[@]}"; do
        printf '- %s\n' "$f"
      done
    fi
  } >"$out"
}

if [ -n "$SUMMARY_FILE" ]; then
  emit_summary "$SUMMARY_FILE"
fi

# Always print a compact stdout line for log greppability.
JOINED="$(IFS=, ; printf '%s' "${TABLE_COUNTS[*]}")"
if [ "${#FAILURES[@]}" -eq 0 ]; then
  printf 'smoke: ok duration=%ss counts=%s\n' "$DURATION" "$JOINED"
  exit 0
fi

printf 'smoke: FAILED duration=%ss counts=%s\n' "$DURATION" "$JOINED" >&2
for f in "${FAILURES[@]}"; do
  printf 'smoke:   - %s\n' "$f" >&2
done
exit 1
