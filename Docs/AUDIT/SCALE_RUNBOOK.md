# Borjie Scale Runbook

**Last Updated:** 2026-05-28
**Audience:** SRE / on-call / capacity planning.
**Companion docs:**
- `Docs/AUDIT/RLS_COVERAGE.md` — RLS posture per table
- `Docs/AUDIT/LOAD_BASELINE.md` — k6 baseline numbers
- `Docs/AUDIT/MULTI_REGION_GAPS.md` — what blocks an EU/US replica
- `tests/load/README.md` — k6 runbook

This document captures the dials, defaults, ceilings, and recovery
playbook for taking Borjie from pilot scale (~5 tenants, 100 RPS
peak) to institutional scale (1k tenants, 5k RPS peak, 100 concurrent
brain sessions).

## 1. Database — postgres + pgvector

### Pool config

Bound in `packages/database/src/client.ts` via `readPoolOptions()`.
Every value is env-overridable; defaults are tuned for a 4-vCPU
api-gateway pod talking to a primary RDS/Aurora at db.t4g.large.

| Knob | Env var | Default | Recommendation |
|------|---------|--------:|----------------|
| Connection pool max | `DATABASE_POOL_MAX` | `20` | 20–40 per pod; 40 at HPA upper bound (3 replicas × 40 = 120 → fits 200-slot pgBouncer transaction pool with headroom) |
| Idle timeout (sec) | `DATABASE_IDLE_TIMEOUT_SEC` | `30` | 30s in transaction-pooler mode; 600s in session mode |
| Max lifetime (sec) | `DATABASE_MAX_LIFETIME_SEC` | `1800` (30m) | rotate before pgBouncer's 1h `server_lifetime` to avoid mid-transaction churn |
| Connect timeout (sec) | `DATABASE_CONNECT_TIMEOUT_SEC` | `10` | keep low — a slow connect is a queue marker, fail fast |
| Statement timeout (ms) | `DATABASE_STATEMENT_TIMEOUT_MS` | `30_000` | tighten to 10s in `/api/v1` request paths via `SET LOCAL statement_timeout` per route; keep 30s for migrations |
| Lock timeout (ms) | `DATABASE_LOCK_TIMEOUT_MS` | `5_000` | keeps row-lock contention crisp; surfaces deadlocks instead of letting them queue |
| Read replica pool max | `DATABASE_READONLY_POOL_MAX` | half of primary | reporting + brain retrieval traffic |
| Read replica statement timeout (ms) | `DATABASE_READONLY_STATEMENT_TIMEOUT_MS` | `15_000` | tighter so a runaway dashboard query doesn't drag the reporting tier |

### pgBouncer (recommended for institutional scale)

| Setting | Recommendation |
|---------|----------------|
| Pool mode | `transaction` (we never use server-side cursors or `SET` outside of `SET LOCAL` inside the per-request RLS GUC binding transaction). |
| `default_pool_size` | 25 per database, per user |
| `reserve_pool_size` | 5 |
| `max_client_conn` | 1000 |
| `server_lifetime` | 3600 (matches our 30m client-side `max_lifetime` × 2) |
| `server_idle_timeout` | 600 |
| `query_wait_timeout` | 30 (drops a stuck request before the gateway times out itself) |

> **Important — RLS + transaction-mode interaction:** The
> `withTenantContext()` helper sets `app.current_tenant_id` and
> `app.tenant_id` via `set_config(name, value, true)` — the `true`
> third argument scopes the binding to the **current transaction**
> only. This is the only safe shape under transaction-mode pooling
> because the GUC dies the moment the txn commits, so the next caller
> on the same backend session starts with a fresh, unbound GUC. Any
> code that uses `SET SESSION` (without `LOCAL`) for tenant binding
> is a CRITICAL bug — it leaks the tenant id across requests on a
> pooled connection.

### Statement-level guardrails

- All session connections receive `statement_timeout` and
  `lock_timeout` GUCs on first connect (see `connection: {…}` in
  `client.ts`).
- Per-route tighten via `await db.execute(sql`SET LOCAL statement_timeout = 5000`)`
  inside `withTenantContext()` if the route's SLO is < 5s.
- Slow-query logger in `packages/database/src/slow-query-logger.ts`
  emits a Pino `warn` for any query > 1s with the full plan via
  `EXPLAIN ANALYZE` — operators see the SQL + plan + bound tenant id
  scrubbed of PII.

### Migration safety at scale

- `pnpm migrate` runs forward-only. Migrations are immutable per
  `CLAUDE.md`.
- A migration that adds an index must use `CREATE INDEX CONCURRENTLY`
  to avoid taking an `ACCESS EXCLUSIVE` lock. The pattern is in
  `0179_missing_tenant_indexes.sql`.
- A migration that adds a `NOT NULL` to an existing column must
  back-fill in a prior migration, then ALTER with the constraint in
  the next.
- CI gate: `borjie-db-migrations-check.yml` lint + dry-run on a fresh
  Postgres container.

## 2. Cache / queue / pub-sub — Redis

| Use site | Library | Default ceiling | Notes |
|----------|---------|----------------:|-------|
| Per-route rate limit (Express-level) | `middleware/rate-limit-redis.middleware.ts` | 100/min default; 30/min AI-class | Falls back to in-memory on Redis outage. Logs degradation once per process. |
| Per-tenant hourly token budget | `middleware/per-tenant-rate-budget.ts` | 1,000,000 tokens / hour / tenant | Lua-atomic INCRBY + EXPIRE; fails CLOSED with 503 in prod, fails open in dev. |
| Sign-in IP throttle | `routes/auth/public-auth.hono.ts::createInMemorySignInLimiter` | 5 attempts / 10 min → 15 min lockout | In-memory by default; swap with Redis variant at scale. |
| Idempotency cache (JWT path) | `middleware/idempotency.ts` | 24h TTL, 2xx only | In-memory default; Redis store via `createRedisIdempotencyStore`. |
| Idempotency cache (webhook path) | `middleware/webhook-idempotency.middleware.ts` | 24h TTL, 2xx only, per-provider scope | Fails CLOSED with 503 on Redis outage (never silently re-runs). |
| Outbox + saga queues | `services/outbox-processor` | bounded by Redis stream length | Backoff on conflict; max-attempts via env. |

### Redis HA recommendation

- Redis Sentinel for in-place HA (config under `infrastructure/`).
- For multi-AZ: Redis Cluster mode or ElastiCache Redis Cluster.
- Connection: single shared `ioredis` client per pod, lazy-connected.
  See bootstrap in `services/api-gateway/src/index.ts` lines 520–559.
- Failure mode by middleware:
  - Express-level rate limit → degrade to in-memory + WARN once.
  - Per-tenant token budget → 503 in prod (fail-closed).
  - Webhook idempotency → 503 in prod (fail-closed).
  - Auth IP throttle → degrade to in-memory.
  - Idempotency cache → degrade to in-memory.

## 3. Rate-limit ceilings — final mapping

The SCALE HARDENING wave defines the canonical ceiling matrix. The
table below maps each ceiling to the file that implements it. Every
429 response includes `Retry-After` (seconds) and a structured error
envelope `{ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' | 'TENANT_TOKEN_BUDGET_EXCEEDED', retryAfter, ... } }`.

| Endpoint class | Ceiling | Implementation | Key |
|----------------|--------:|----------------|-----|
| Public endpoints (no auth) | 60 req/min/IP | `rate-limit-redis.middleware.ts` (Express-level, default class) | `rl:ip:<ip>:default:<window>` |
| Authenticated owner endpoints | 600 req/min/tenant | same, default class with tenant key | `rl:tenant:<tenantId>:default:<window>` |
| Admin endpoints | 120 req/min/admin | same, default class — set via `X-Tenant-ID` admin header | `rl:tenant:<tenantId>:default:<window>` (admin = its own tenant) |
| Chat / brain (request floor) | 20 req/min/tenant | same, AI class (`RATE_LIMIT_AI_MAX`) | `rl:tenant:<tenantId>:ai:<window>` |
| Chat / brain (token ceiling) | 100,000 tokens / hour / tenant per surface | `per-tenant-rate-budget.ts` (`TENANT_HOURLY_TOKEN_BUDGET`) | `rate-budget:<tenantId>:<windowStart>` |
| Sign-in attempts | 5 per IP per 10 min → 15 min lockout | `public-auth.hono.ts::createInMemorySignInLimiter` | per-IP |
| MFA challenge | 5-min TTL, single-use challenge id | `routes/auth-mfa.ts` | per challenge |

Tune via env:

```
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=600
RATE_LIMIT_AI_MAX=20
TENANT_HOURLY_TOKEN_BUDGET=100000
```

The 100k/h chat-token ceiling is the SCALE HARDENING wave's prescribed
default; production scale tier override per `tenants.scale_tier` is a
follow-up wave (TODO: per-tenant override row in `tenants` table).

## 4. CORS

Implemented in `services/api-gateway/src/index.ts` lines 449–502.

- **Allowlist exact-match only.** No wildcard, no regex matching, no
  reflective origin echo.
- **Production:** `ALLOWED_ORIGINS` env var required at boot or the
  service refuses to start.
- **Development:** localhost + 127.0.0.1 × dev-port matrix
  (3000/3010/3020/3030/3040/5173/8081/8082) is unioned with the
  explicit `ALLOWED_ORIGINS` value (if any), so on-device mobile
  tunnels work without disabling the allowlist.
- `credentials: true`, `maxAge: 86400` (24h preflight cache).
- Allowed headers: `Content-Type`, `Authorization`, `X-Tenant-ID`,
  `Idempotency-Key`. Exposed: `X-Request-Id`, `X-RateLimit-Remaining`.

## 5. Auth hardening — supabase JWT

| Property | Verified by | Location |
|----------|-------------|----------|
| `iss` matches Supabase project URL | `auth-core.ts::verifyJwt` | `services/api-gateway/src/middleware/auth-core.ts` |
| `aud = "authenticated"` | same | same |
| `exp` not past, `iat` not future | same | same |
| Signature against JWKS | same (`jose` library with JWKS endpoint) | same |
| Tenant id from `app_metadata.tenant_id` (NEVER body) | `auth.middleware.ts` | bound on `c.set('auth', { tenantId, userId, role })` |
| MFA TOTP for admin tenants | `routes/auth-mfa.ts` | challenge → verify with stored secret (never body-supplied) |
| Brute-force lockout | `routes/auth/public-auth.hono.ts::createInMemorySignInLimiter` | 5/10min → 15min lockout |
| Audit on success/failure | `recordAuditEvent` injected by `public-auth-wiring.ts` | hash-chained `ai_audit_chain` |

Refresh token rotation: Supabase rotates per call by default; our
session cookie stores the latest refresh token encrypted (see
`auth/public/session-cookie.ts`).

Password reset: handled by Supabase `auth.resetPasswordForEmail`;
single-use tokens via Supabase magic-link config (15-min TTL, audited).

## 6. Idempotency

Mandatory `Idempotency-Key` on every webhook receiver + payment
endpoint. Two middlewares:

| Use site | File | Failure mode |
|----------|------|--------------|
| Authenticated mutations | `middleware/idempotency.ts` | Skip caching on missing tenant/JWT; cache 2xx only; in-memory fallback in dev. |
| Webhook receivers | `middleware/webhook-idempotency.middleware.ts` | **Fails CLOSED with 503 on Redis outage** (never re-runs a duplicate). Per-provider `scope`. Header allowlist restricted to safe replay headers (no `Set-Cookie` / `Location` / CORS bytes). |

Routes that MUST mount one of the above:

- Payments (`POST /payments`, `POST /payments/:id/process`)
- Webhook receivers (Inngest, Twilio, Meta, Africa's Talking, Stripe,
  M-Pesa, GePG, sentry-webhook, supabase-webhook)
- All `/admin/sovereign-ledger/*` endpoints (irreversible)
- Letter dispatch, KYC submission, document destroy

CI gate: `borjie-audit-coverage.yml` includes a check that any
`*-webhook.hono.ts` or `*-webhook.router.ts` mounts the webhook
idempotency middleware.

## 7. Observability + tracing

| Concern | Source | Notes |
|---------|--------|-------|
| OTel bootstrap | `services/api-gateway/src/observability/otel-bootstrap.ts` invoked at `index.ts:25` BEFORE any other import | `bootstrapOTel({})` is idempotent and no-ops when `OTEL_ENABLED=false` |
| Sentry server | `services/api-gateway/src/observability/sentry-bootstrap.ts` | wired right after OTel |
| Sentry client | `apps/{owner-web,admin-web}/src/lib/sentry.ts` | DSN per-app via NEXT_PUBLIC_SENTRY_DSN |
| Pino redaction | `services/api-gateway/src/index.ts:375..400` | `authorization`, `cookie`, `x-api-key`, `password`, `token`, `tokenHash`, `mfaSecret`, `apiKey`, `api_key`, `secret`, `bankAccount`, `iban`, `nationalId`, `creditCard`, `ssn`, `webhookSecret` |
| Audit hash-chain | `packages/observability/src/audit/` | append-only; SHA-256 chain; integrity verified by `evals/audit-chain-integrity.ts` |
| Slow-query log | `packages/database/src/slow-query-logger.ts` | warn on > 1s; full plan |
| Metrics | `packages/observability/src/tracing/` | Prometheus exporter wired in OTel bootstrap |

## 8. Kill-switch fail-closed

Implementation in `services/api-gateway/src/middleware/kill-switch.middleware.ts`.

Behaviour, per the `CLAUDE.md` hard rule "Kill-switch fail-closed":

- Flag OFF → pass-through.
- Flag ON → 503 `KILL_SWITCH_ACTIVE` + audit emit.
- Flags service missing (degraded boot, no DB) → pass-through, no
  audit. (Operators see the missing-service signal elsewhere.)
- Flag lookup throws (DB blip, RLS denial) in **production** →
  503 `KILL_SWITCH_LOOKUP_FAILED`. Never silently bypasses.
- Flag lookup throws in **dev/test** → pass-through + WARN.

Test coverage: `services/api-gateway/src/middleware/__tests__/kill-switch.middleware.test.ts`.

Guarded operations: `eviction`, `payment-reversal`, `account-deletion`,
`refund`, `data-export`, `monthly-close-reverse`, `sublease-cancel`,
`sovereign-ledger-override`.

## 9. Graceful shutdown

`index.ts` flips `isShuttingDown = true` on SIGTERM so `/health` and
`/healthz` start returning 503 immediately. The load balancer drains
in-flight requests for `SHUTDOWN_DRAIN_MS` (default 15s) before the
server closes. Long-running brain streams are signalled via the
shared `AbortController` so SSE clients see a clean end-of-stream
rather than a half-flushed chunk.

## 10. Recovery playbook (when it's on fire)

1. **API gateway 5xx surge** → check `borjie_api_gateway_http_5xx`
   Prometheus metric, then traces filtered on `error=true`.
2. **Rate-limit breakage** → check `redis_up`. If Redis is down the
   in-memory limiter is on (logs `rate-limit: redis unavailable —
   falling back to in-memory limiter`). Token budget will 503 — that
   is the expected fail-closed behaviour.
3. **Tenant token-budget DoS** → bump
   `TENANT_HOURLY_TOKEN_BUDGET` for the specific tenant via env at
   the affected pod, then plan the persistent fix in a `tenants`-table
   override row.
4. **DB connections exhausted** → check pgBouncer `SHOW POOLS` for
   `cl_waiting`. Scale `DATABASE_POOL_MAX` down (counter-intuitive
   but reduces pgBouncer pressure), or scale pgBouncer's
   `default_pool_size` up.
5. **Hash-chain divergence** → halt all writes via the
   `sovereign-ledger-override` kill switch, run
   `pnpm exec tsx packages/observability/scripts/verify-audit-chain.ts`
   from the last known-good checkpoint.

## Owner

SRE rotation. Updates land via PR; the CI gate
`borjie-audit-coverage.yml` checks the matrices in this doc against
the code.
