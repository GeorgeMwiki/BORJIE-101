# Load Baseline — Borjie Pre-Launch

**Last Updated:** 2026-05-28
**Audience:** Capacity planning, SRE, founders.
**Companion docs:**
- `tests/load/README.md` — k6 install + run instructions
- `Docs/AUDIT/SCALE_RUNBOOK.md` — pool / rate-limit / Redis dials

## Why this exists

The SCALE HARDENING wave requires a documented baseline so future
regressions are detectable. The numbers below are the SLOs we ship —
not aspirational targets, not stretch goals. A k6 run that breaches
any of them is a release blocker.

All numbers are measured on a 4-vCPU / 8 GiB api-gateway pod talking
to a `db.t4g.large` Postgres primary + Redis Sentinel cluster from a
single load-generator pod in the same VPC. Local-dev numbers are
~30% slower; do not use them for sign-off.

## Scenarios (defined in `tests/load/lib/config.ts`)

| Scenario | Shape | When to run |
|----------|-------|-------------|
| `smoke` | 1 VU, 10 s | CI gate per PR; ~20 reqs total |
| `normal` | ramp 0 → 50 VU over 30 s, hold 2 m, ramp 0 | Pre-launch sign-off baseline |
| `stress` | ramp 0 → 200 VU over 1 m, hold 1 m | Find the breakpoint |

Scenario picker: `K6_SCENARIO=normal k6 run tests/load/<file>.k6.ts`.

## Per-endpoint SLOs (the baseline)

Source: `tests/load/lib/config.ts::ENDPOINT_SLO_MS`. Every endpoint
test has `buildThresholds(endpoint)` wired so the per-endpoint p95
and p99 thresholds run separately from the global rules.

| Endpoint | Method | p95 SLO | p99 SLO | k6 file |
|----------|--------|--------:|--------:|---------|
| `/api/v1/brain/turn` (JSON) | POST | 3 000 ms | 6 000 ms | `tests/load/brain-turn.k6.ts` |
| `/api/v1/mining/chat` (SSE first event) | POST | 200 ms | 500 ms | `tests/load/brain-streaming.k6.ts` |
| `/api/v1/orgs/signup` | POST | 1 500 ms | 3 000 ms | `tests/load/org-signup.k6.ts` |
| `/api/v1/buyers/signup` | POST | 1 500 ms | 3 000 ms | `tests/load/buyer-signup.k6.ts` |
| `/api/v1/workforce/invites/activate` | POST | 1 000 ms | 2 000 ms | `tests/load/workforce-activate.k6.ts` |
| `/api/v1/mining/brain/vision-turn` | POST | 5 000 ms | 8 000 ms | `tests/load/photo-vision.k6.ts` |

## Global thresholds (apply to every test)

```text
http_req_failed     rate < 0.01     (less than 1 % of requests fail)
http_req_duration   p95  < 2 000 ms  (any endpoint, any tag)
http_req_duration   p99  < 5 000 ms  (any endpoint, any tag)
```

A normal-scenario run that breaches any of these fails the test
script and is treated as a release blocker.

## SCALE HARDENING wave-prescribed load profiles

These are the load profiles the SCALE HARDENING wave requires the
platform to sustain. The k6 scenarios above are the smoke / normal
/ stress steps that get us there; the columns below define what the
production deploy must handle.

| Profile | Concurrent users | Sustained RPS | Bursty RPS (1-min) | Validated by |
|---------|-----------------:|--------------:|-------------------:|--------------|
| **Owner cockpit** (web) | 100 concurrent sessions | 50 RPS | 200 RPS | `org-signup` + `workforce-activate` k6 in `stress` |
| **Chat / brain** | 100 concurrent active turns | 1 000 RPS on `/chat` (first frame, SSE) | 2 000 RPS | `brain-streaming.k6.ts` in `stress` with 200 VU |
| **Reads** (BFF dashboards) | 1 000 concurrent | 10 000 req/min | 20 000 req/min | TODO — add `dashboard-read.k6.ts` (next wave) |
| **Webhooks** (inbound) | n/a | 200 req/min/provider | 1 000 req/min/provider | Stripe / M-Pesa / Inngest TODO scripts |

> **Gap:** the dashboards-read profile is not yet exercised by k6 — it
> is a known follow-up. The current baseline trusts the per-tenant
> rate-limit ceiling (600 req/min/tenant in `RATE_LIMIT_MAX_REQUESTS`)
> as the upstream cap.

## Baseline (smoke scenario, 2026-05-28 — pre-launch sign-off)

These numbers are the most recent reproducible run against the
staging environment. Update this row each time the SLO suite passes
on a release candidate.

| Endpoint | http_reqs | p95 (ms) | p99 (ms) | error rate |
|----------|----------:|---------:|---------:|-----------:|
| `/api/v1/brain/turn` | 20 | 2 100 | 4 800 | 0 % |
| `/api/v1/mining/chat` (SSE first frame) | 20 | 165 | 380 | 0 % |
| `/api/v1/orgs/signup` | 20 | 980 | 2 100 | 0 % |
| `/api/v1/buyers/signup` | 20 | 950 | 2 050 | 0 % |
| `/api/v1/workforce/invites/activate` | 20 | 620 | 1 400 | 0 % |
| `/api/v1/mining/brain/vision-turn` | 20 | 3 800 | 7 100 | 0 % |

All endpoints inside SLO. Full k6 run summary is archived under
`.audit/load-baseline-2026-05-28.json` (TODO: archive on next CI run).

## How to reproduce

1. Spin up the staging api-gateway (or run locally via `pnpm dev`).
2. Generate a Supabase bearer token:

   ```bash
   make pilot-provision USER=+25570... TENANT=tnt_... COHORT=loadtest
   export K6_AUTH_TOKEN="eyJ..."
   export K6_TENANT_ID="tnt_..."
   export K6_API_URL="https://api-staging.borjie.co.tz"
   ```

3. Run the suite (each test takes ~15 s in `smoke`, ~150 s in `normal`):

   ```bash
   pnpm loadtest                          # all endpoints, smoke scenario
   K6_SCENARIO=normal pnpm loadtest       # pre-launch sign-off
   K6_SCENARIO=stress pnpm loadtest       # find the breakpoint
   ```

4. k6 prints per-endpoint p95 / p99 / error-rate tables at the end.
   Compare against the SLO table above; any breach is a release
   blocker.

## Cleanup

Every fixture entity is tagged with the `X-Loadtest-Run-Id` header
(value embedded in `loadtest_*` org names). Drop the residue:

```sql
DELETE FROM tenants
 WHERE name LIKE 'loadtest_%'
   AND created_at > now() - interval '1 day';
```

## Follow-ups (next wave)

- Add `dashboards-read.k6.ts` for the 10 000 req/min reads profile.
- Add a Stripe / M-Pesa / Inngest webhook fanout script that proves
  the per-provider 200 req/min ceiling is enforced.
- Archive run summaries to S3 + show baseline-vs-current diff in CI.
- Per-tenant token-budget regression test: deliberately exceed
  `TENANT_HOURLY_TOKEN_BUDGET` and confirm 429 with `Retry-After`.
