#!/usr/bin/env bash
# =============================================================================
# BORJIE — Prometheus SLO compliance gate
# =============================================================================
# Called from .github/workflows/cd.yml after the canary smoke step. Queries
# the Prometheus instant API for three SLO indicators over the last 5 min
# and exits non-zero (-> triggers the rollback step) if ANY breaches.
#
# Indicators (override via env vars):
#   p99_latency_ms        — gateway p99 latency. Threshold 1500 ms.
#   error_rate_5xx        — 5xx rate over total. Threshold 0.01 (= 1%).
#   success_rate_payments — payments success rate. Threshold 0.99 (= 99%).
#
# Environment:
#   PROMETHEUS_URL                  required, e.g. https://prom.borjie.io
#   PROMETHEUS_BEARER_TOKEN         optional, if Prom is behind auth
#   SLO_WINDOW                      optional, default "5m"
#   SLO_P99_LATENCY_MS_THRESHOLD    optional, default 1500
#   SLO_ERROR_RATE_5XX_THRESHOLD    optional, default 0.01
#   SLO_PAYMENTS_SUCCESS_THRESHOLD  optional, default 0.99
#
# Exit codes:
#   0  all indicators within budget
#   1  one or more SLOs breached
#   2  configuration or query error (treat as a breach by the caller)
#
# Dependencies: curl, jq. (Both available on GitHub-hosted ubuntu-latest.)
# =============================================================================

set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly PROM_URL="${PROMETHEUS_URL:-}"
readonly WINDOW="${SLO_WINDOW:-5m}"
readonly P99_THRESHOLD="${SLO_P99_LATENCY_MS_THRESHOLD:-1500}"
readonly ERR_THRESHOLD="${SLO_ERROR_RATE_5XX_THRESHOLD:-0.01}"
readonly PAY_THRESHOLD="${SLO_PAYMENTS_SUCCESS_THRESHOLD:-0.99}"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*" >&2
}

fail_config() {
  log "config error: $*"
  exit 2
}

if [[ -z "$PROM_URL" ]]; then
  fail_config "PROMETHEUS_URL is unset"
fi

if ! command -v curl >/dev/null 2>&1; then
  fail_config "curl is not installed"
fi

if ! command -v jq >/dev/null 2>&1; then
  fail_config "jq is not installed"
fi

# -----------------------------------------------------------------------------
# query_prometheus PROMQL
# Echoes the scalar value of the first sample, or the literal string "NaN" if
# Prometheus returned no data. Fails with exit 2 on transport / parse error.
# -----------------------------------------------------------------------------
query_prometheus() {
  local promql="$1"
  local url="${PROM_URL%/}/api/v1/query"
  local response
  local -a curl_args=(
    -sS
    --fail
    --max-time 15
    --get
    --data-urlencode "query=${promql}"
  )

  if [[ -n "${PROMETHEUS_BEARER_TOKEN:-}" ]]; then
    curl_args+=(-H "Authorization: Bearer ${PROMETHEUS_BEARER_TOKEN}")
  fi

  if ! response="$(curl "${curl_args[@]}" "$url")"; then
    log "query failed (transport): ${promql}"
    return 2
  fi

  local status
  status="$(printf '%s' "$response" | jq -r '.status // "error"')"
  if [[ "$status" != "success" ]]; then
    log "query failed (api status=$status): ${promql}"
    return 2
  fi

  local value
  value="$(printf '%s' "$response" | jq -r '.data.result[0].value[1] // "NaN"')"
  printf '%s' "$value"
}

# -----------------------------------------------------------------------------
# Threshold check helpers. Use awk for floating-point compare — POSIX-safe.
# -----------------------------------------------------------------------------
is_lte() {
  # is_lte VALUE THRESHOLD -> exit 0 if VALUE <= THRESHOLD
  awk -v v="$1" -v t="$2" 'BEGIN { exit !(v <= t) }'
}

is_gte() {
  # is_gte VALUE THRESHOLD -> exit 0 if VALUE >= THRESHOLD
  awk -v v="$1" -v t="$2" 'BEGIN { exit !(v >= t) }'
}

is_nan() {
  [[ "$1" == "NaN" || "$1" == "null" || -z "$1" ]]
}

# -----------------------------------------------------------------------------
# Indicator queries. These reference recording rules in
# infra/observability/prometheus/recording-rules.yaml so the canary path is
# cheap (no high-cardinality ad-hoc queries).
# -----------------------------------------------------------------------------

# p99 latency in milliseconds, computed by recording rule
# `borjie:api_gateway:p99_latency_ms:5m`.
readonly PROMQL_P99="borjie:api_gateway:p99_latency_ms:${WINDOW}"

# 5xx error rate (0..1) computed by
# `borjie:api_gateway:error_rate_5xx:5m`.
readonly PROMQL_ERR="borjie:api_gateway:error_rate_5xx:${WINDOW}"

# Payments success rate (0..1) computed by
# `borjie:payments_ledger:success_rate:5m`.
readonly PROMQL_PAY="borjie:payments_ledger:success_rate:${WINDOW}"

# -----------------------------------------------------------------------------
# Run the three checks. Accumulate breaches so the operator sees every
# breach at once instead of a single fail-fast message.
# -----------------------------------------------------------------------------
breaches=0

log "querying Prometheus at ${PROM_URL} (window=${WINDOW})"

p99_value="$(query_prometheus "$PROMQL_P99")" || exit 2
err_value="$(query_prometheus "$PROMQL_ERR")" || exit 2
pay_value="$(query_prometheus "$PROMQL_PAY")" || exit 2

# p99 latency (lower is better, threshold = ms)
if is_nan "$p99_value"; then
  log "BREACH p99_latency_ms: no data returned (recording rule missing?)"
  breaches=$((breaches + 1))
elif is_lte "$p99_value" "$P99_THRESHOLD"; then
  log "OK     p99_latency_ms=${p99_value}ms (threshold ${P99_THRESHOLD}ms)"
else
  log "BREACH p99_latency_ms=${p99_value}ms (threshold ${P99_THRESHOLD}ms)"
  breaches=$((breaches + 1))
fi

# 5xx error rate (lower is better, threshold = fraction)
if is_nan "$err_value"; then
  log "BREACH error_rate_5xx: no data returned (recording rule missing?)"
  breaches=$((breaches + 1))
elif is_lte "$err_value" "$ERR_THRESHOLD"; then
  log "OK     error_rate_5xx=${err_value} (threshold ${ERR_THRESHOLD})"
else
  log "BREACH error_rate_5xx=${err_value} (threshold ${ERR_THRESHOLD})"
  breaches=$((breaches + 1))
fi

# Payments success rate (higher is better, threshold = fraction)
if is_nan "$pay_value"; then
  log "BREACH success_rate_payments: no data returned (recording rule missing?)"
  breaches=$((breaches + 1))
elif is_gte "$pay_value" "$PAY_THRESHOLD"; then
  log "OK     success_rate_payments=${pay_value} (threshold ${PAY_THRESHOLD})"
else
  log "BREACH success_rate_payments=${pay_value} (threshold ${PAY_THRESHOLD})"
  breaches=$((breaches + 1))
fi

if [[ "$breaches" -gt 0 ]]; then
  log "SLO gate FAILED: ${breaches} indicator(s) breached over last ${WINDOW}"
  exit 1
fi

log "SLO gate PASSED: all indicators within budget over last ${WINDOW}"
exit 0
