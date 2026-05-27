# Borjie k6 Load Tests

Pre-launch load probes for the critical Borjie endpoints. Local-dev
focused but every script reads its configuration from environment
variables so the same files run unchanged against staging / prod.

## Install

k6 is an external binary, not a pnpm dep:

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

Verify: `k6 version`.

## Run

The repo exposes two entry points:

```bash
# All endpoints at once (default scenario = smoke):
pnpm loadtest

# Or via make (equivalent):
make loadtest

# Single endpoint:
k6 run tests/load/brain-turn.k6.ts

# Switch scenario:
K6_SCENARIO=normal k6 run tests/load/org-signup.k6.ts
K6_SCENARIO=stress k6 run tests/load/buyer-signup.k6.ts
```

## Environment variables

| Variable                       | Default                   | Used by                |
| ------------------------------ | ------------------------- | ---------------------- |
| `K6_API_URL`                   | `http://localhost:4000`   | All tests              |
| `K6_AUTH_TOKEN`                | unset → 401 path          | brain-turn, brain-streaming, photo-vision |
| `K6_TENANT_ID`                 | unset                     | Auth-required tests    |
| `K6_SCENARIO`                  | `smoke`                   | All tests              |
| `K6_LOADTEST_RUN_ID`           | ISO-timestamp             | All tests (tagged on every entity) |
| `K6_WORKFORCE_FIXTURE_JSON`    | `[]`                      | workforce-activate     |
| `K6_SUPABASE_URL`              | unset                     | reserved for future token mint |
| `K6_SUPABASE_ANON_KEY`         | unset                     | reserved for future token mint |
| `K6_SUPABASE_SERVICE_ROLE_KEY` | unset                     | reserved for future token mint |

### Generating a bearer token

The brain endpoints require a verified Supabase JWT. Reuse the same
helper that `scripts/pilot-provision.ts` uses to seed pilot users
locally:

```bash
make pilot-provision USER=+25570... TENANT=tnt_... COHORT=loadtest
# The script prints the access token at the end — export it:
export K6_AUTH_TOKEN="eyJ..."
```

## Scenarios

| Name     | Shape                                  | Use when                       |
| -------- | -------------------------------------- | ------------------------------ |
| `smoke`  | 1 VU, 10s                              | Quick CI / pre-merge gate      |
| `normal` | ramp 0→50 VU over 30s, hold 2m, ramp 0 | Pre-launch baseline (default)  |
| `stress` | ramp 0→200 VU over 1m, hold 1m         | Find the breakpoint            |

## SLO targets

Defined in `lib/config.ts` → `ENDPOINT_SLO_MS`. Per-endpoint p95 /
p99 are tagged thresholds (k6 reports them separately from the
global rule).

| Endpoint                                                | p95 SLO  | p99 SLO  |
| ------------------------------------------------------- | -------- | -------- |
| `POST /api/v1/brain/turn` (JSON)                        | 3 000 ms | 6 000 ms |
| `POST /api/v1/mining/chat` (SSE → first `turn.accepted`) |   200 ms |   500 ms |
| `POST /api/v1/orgs/signup`                              | 1 500 ms | 3 000 ms |
| `POST /api/v1/buyers/signup`                            | 1 500 ms | 3 000 ms |
| `POST /api/v1/workforce/invites/activate`               | 1 000 ms | 2 000 ms |
| `POST /api/v1/mining/brain/vision-turn`                 | 5 000 ms | 8 000 ms |

Global thresholds (apply to every test):

```
http_req_failed              rate < 0.01    (less than 1% of requests fail)
http_req_duration            p95  < 2000ms  (any endpoint, any tag)
http_req_duration            p99  < 5000ms  (any endpoint, any tag)
```

## What to do when an SLO is breached

1. **Identify the slow endpoint.** k6 prints per-tag stats at the end
   of a run; the failing threshold is at the bottom of the summary.
2. **Reproduce locally with `K6_SCENARIO=smoke`** to confirm it is
   not infra noise (e.g. saturated CI runner, Docker on Mac).
3. **Pull traces.** Every request carries `X-Loadtest-Run-Id`. In the
   OTel collector / Jaeger UI, filter by that header value to see
   the slow spans. The api-gateway emits one root span per request
   plus child spans for `brain.orchestrator.*`, `database.query.*`,
   `ledger.post`, etc.
4. **Map the root cause** (typical culprits):
    - Brain endpoints — LLM provider latency, persona-cold-start
      compile time, missing prompt cache.
    - Signup endpoints — Supabase admin SDK round trip, audit-chain
      hash computation, RLS GUC bind cost.
    - Workforce activate — `workforceInvitations` index missing or
      bloated. `EXPLAIN ANALYZE` the lookup.
    - Vision — base64 decoding on the request thread.
5. **Re-run after the fix.** The same `K6_SCENARIO` value must pass
   to mark the SLO as recovered.

## Test data hygiene

Every entity created during a load run is tagged with the
`X-Loadtest-Run-Id` header (and the value is embedded in fixture
names: org names + buyer org names start with `loadtest_`). A
cleanup job can sweep them:

```sql
DELETE FROM tenants
 WHERE name LIKE 'loadtest_%'
   AND created_at > now() - interval '1 day';
```

The signup tests are idempotent on uniqueness — they mint a fresh
suffix per iteration so re-runs never collide. The workforce
activate test consumes its `K6_WORKFORCE_FIXTURE_JSON` pool
read-only; a separate seeder must re-create the rows between runs
(or use a script that resets `status='pending'` on the rows the
test consumed).

## TypeScript compile

The scripts are `.k6.ts` files. k6 has no native TypeScript loader
(yet), but `tsc --noEmit` validates them against the same
`tsconfig.base.json` the rest of the repo uses:

```bash
pnpm exec tsc --noEmit --target es2022 --module esnext \
  --moduleResolution bundler tests/load/*.k6.ts tests/load/lib/*.ts
```

For actual k6 execution we pass the `.ts` file directly — k6 strips
types via its built-in esbuild step (>= v0.50).

## Files

- `lib/config.ts` — base URL, scenarios, thresholds, helpers.
- `lib/auth.ts` — bearer / public / SSE header builders.
- `brain-turn.k6.ts` — `POST /api/v1/brain/turn`.
- `brain-streaming.k6.ts` — `POST /api/v1/mining/chat` SSE first-frame.
- `org-signup.k6.ts` — `POST /api/v1/orgs/signup`.
- `buyer-signup.k6.ts` — `POST /api/v1/buyers/signup`.
- `workforce-activate.k6.ts` — `POST /api/v1/workforce/invites/activate`.
- `photo-vision.k6.ts` — `POST /api/v1/mining/brain/vision-turn`.
