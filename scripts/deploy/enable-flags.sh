#!/bin/sh
# =============================================================================
# enable-flags.sh — LP-30 canary flag-enable ORDER (one step at a time).
#
# This script does NOT flip flags on a live environment by itself. Feature
# flags in Borjie are environment variables read at boot (e.g. by the deploy
# platform / IaC); turning one on is a config change + rolling restart that the
# operator performs. What this script gives you is the canonical ORDER and a
# verification GATE between steps, so the canary is deterministic and auditable.
#
# The order is least-blast-radius first; each later flag depends on the prior
# one having been observed healthy. See CANARY_RUNBOOK.md for the full
# watch-this-metric checklist per step and the rollback procedure.
#
#   step 0  (no flag)                           deploy all-OFF, run boot-smoke
#   step 1  BORJIE_SEMANTIC_CACHE_ENABLED=1      watch hit-rate + latency
#   step 2  BORJIE_INTENT_VERIFIER_ENABLED=1     ADVISORY — watch WOULD-block log volume
#   step 3  BORJIE_COGNITIVE_COMPOSER_ENABLED=1  watch cost + latency
#   step 4  BORJIE_INTENT_VERIFY_STRICT=1        enforce (LAST — only after advisory is clean)
#
# ROLLBACK for any step: UNSET the flag (or set =0) and roll the pods. No
# redeploy of the image is needed — the flags are read at process start, and
# every seam is fail-safe with its flag off (cache miss falls through, verifier
# permits, composer takes the fast path, router passes through).
#
# USAGE
#   sh scripts/deploy/enable-flags.sh                 # print the ordered plan
#   sh scripts/deploy/enable-flags.sh step <0..4>     # print the env + checks for one step
#   sh scripts/deploy/enable-flags.sh env  <1..4>     # print ONLY the `export FLAG=1` line(s) cumulatively
#
# It is read-only: it prints guidance + the exact env lines. It NEVER mutates
# environment, config, or any running service.
# =============================================================================

set -eu

SEMANTIC_FLAG='BORJIE_SEMANTIC_CACHE_ENABLED'
VERIFIER_FLAG='BORJIE_INTENT_VERIFIER_ENABLED'
COMPOSER_FLAG='BORJIE_COGNITIVE_COMPOSER_ENABLED'
STRICT_FLAG='BORJIE_INTENT_VERIFY_STRICT'

print_plan() {
  cat <<'PLAN'
LP-30 canary flag-enable order (verify the GATE before advancing):

  STEP 0 — lights off
    flags: ALL BORJIE_* canary flags OFF (the default)
    action: deploy to the target env, then run:
              ../../node_modules/.bin/tsx scripts/deploy/boot-smoke.ts
    gate:   boot-smoke PASS + service healthcheck green + error rate flat.

  STEP 1 — semantic cache
    set:    BORJIE_SEMANTIC_CACHE_ENABLED=1
    watch:  cache hit-rate climbs from 0; p50/p95 turn latency does NOT regress
            (a hit should be faster); zero rise in wrong-answer / refusal rate.
    gate:   >= 30 min healthy at representative traffic; hit-rate > 0 and
            latency flat-or-better. Worst case of a bad cache is a stale answer,
            so confirm answers still cite fresh evidence.
    back:   unset BORJIE_SEMANTIC_CACHE_ENABLED (cache -> permanent miss).

  STEP 2 — intent verifier (ADVISORY)
    set:    BORJIE_INTENT_VERIFIER_ENABLED=1   (leave STRICT off)
    watch:  the "advisory — tool call WOULD be blocked" warn-log VOLUME. This is
            the dry-run: NO tool call is actually blocked yet. Confirm the
            would-block rate is low and the matches are true positives (real
            SQLi / data-exfil / prompt-injection), not legitimate tool calls.
    gate:   would-block volume understood + acceptable; no false-positive spike.
    back:   unset BORJIE_INTENT_VERIFIER_ENABLED.

  STEP 3 — cognitive composer
    set:    BORJIE_COGNITIVE_COMPOSER_ENABLED=1
    watch:  per-turn LLM COST and p95 latency on the qualifying (high-stakes /
            high-ambiguity) turns the TTC router escalates to Self-Discover /
            LATS. Fast-path turns are unaffected.
    gate:   cost + latency within budget; composer error-rate (-> fail-safe
            fallback) low; answer quality non-regressed.
    back:   unset BORJIE_COGNITIVE_COMPOSER_ENABLED (composer -> fast path).

  STEP 4 — intent verifier (STRICT)  [enforce — do LAST]
    set:    BORJIE_INTENT_VERIFY_STRICT=1   (requires step 2 already on)
    watch:  blocked-tool-call rate now that permitted:false is HONOURED; confirm
            it matches the advisory would-block volume from step 2 and that no
            legitimate flow is broken.
    gate:   enforcement matches the advisory baseline; no legitimate tool call
            denied. This is the only step that can refuse a tool call.
    back:   unset BORJIE_INTENT_VERIFY_STRICT (-> advisory; matches still logged).

ROLLBACK (any step): unset the flag (or =0) and roll the pods — NO redeploy.
Every seam is fail-safe with its flag off.
PLAN
}

print_step() {
  case "$1" in
    0)
      printf 'STEP 0 — lights off (no flag). Deploy all-OFF then:\n'
      printf '  ../../node_modules/.bin/tsx scripts/deploy/boot-smoke.ts\n'
      printf 'GATE: boot-smoke PASS + healthcheck green + error rate flat.\n'
      ;;
    1)
      printf 'STEP 1 — semantic cache\n'
      printf '  export %s=1\n' "$SEMANTIC_FLAG"
      printf 'WATCH: hit-rate climbs from 0; latency flat-or-better; no wrong-answer rise.\n'
      printf 'BACK:  unset %s\n' "$SEMANTIC_FLAG"
      ;;
    2)
      printf 'STEP 2 — intent verifier (ADVISORY; STRICT stays off)\n'
      printf '  export %s=1\n' "$VERIFIER_FLAG"
      printf 'WATCH: "advisory WOULD be blocked" warn-log volume; confirm true positives.\n'
      printf 'BACK:  unset %s\n' "$VERIFIER_FLAG"
      ;;
    3)
      printf 'STEP 3 — cognitive composer\n'
      printf '  export %s=1\n' "$COMPOSER_FLAG"
      printf 'WATCH: per-turn LLM cost + p95 latency on escalated turns; error-rate low.\n'
      printf 'BACK:  unset %s\n' "$COMPOSER_FLAG"
      ;;
    4)
      printf 'STEP 4 — intent verifier STRICT (enforce; LAST)\n'
      printf '  export %s=1   # requires %s=1 from step 2\n' "$STRICT_FLAG" "$VERIFIER_FLAG"
      printf 'WATCH: blocked-tool-call rate == advisory baseline; no legit flow broken.\n'
      printf 'BACK:  unset %s   (-> advisory)\n' "$STRICT_FLAG"
      ;;
    *)
      printf 'enable-flags: unknown step "%s" (valid: 0 1 2 3 4)\n' "$1" >&2
      exit 1
      ;;
  esac
}

# Print the CUMULATIVE export lines up to and including step N (so an operator
# can paste the full intended flag-set for a given canary stage).
print_env() {
  n="$1"
  case "$n" in
    1|2|3|4) : ;;
    *) printf 'enable-flags: env target must be 1..4 (got "%s")\n' "$n" >&2; exit 1 ;;
  esac
  [ "$n" -ge 1 ] && printf 'export %s=1\n' "$SEMANTIC_FLAG"
  [ "$n" -ge 2 ] && printf 'export %s=1\n' "$VERIFIER_FLAG"
  [ "$n" -ge 3 ] && printf 'export %s=1\n' "$COMPOSER_FLAG"
  [ "$n" -ge 4 ] && printf 'export %s=1\n' "$STRICT_FLAG"
}

# --- Dispatch ---------------------------------------------------------------

cmd="${1:-plan}"
case "$cmd" in
  plan)
    print_plan
    ;;
  step)
    [ "$#" -ge 2 ] || { printf 'usage: enable-flags.sh step <0..4>\n' >&2; exit 1; }
    print_step "$2"
    ;;
  env)
    [ "$#" -ge 2 ] || { printf 'usage: enable-flags.sh env <1..4>\n' >&2; exit 1; }
    print_env "$2"
    ;;
  *)
    printf 'usage: enable-flags.sh [plan | step <0..4> | env <1..4>]\n' >&2
    exit 1
    ;;
esac
