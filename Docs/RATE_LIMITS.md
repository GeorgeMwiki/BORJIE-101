# BORJIE Rate-Limit Policy

This document captures the public contract for API rate limiting. It is the
single source of truth referenced by the API-gateway middleware, the
Helm chart's HPA config, and customer-facing SLA language.

## Why We Care

The api-gateway auto-scales between 3 and 20 replicas under load. A purely
process-local limiter (our historical `Map`-backed middleware) multiplies
the intended ceiling by the replica count — a 100/min cap in intent
becomes a 2000/min cap in practice at peak scale. This breaks two
guarantees:

1. **Abuse prevention.** A single misbehaving tenant can saturate shared
   resources (LLM budget, DB connections, network egress) far beyond the
   posted cap.
2. **Fair share.** Tenants with consistent traffic experience 429s at the
   intended ceiling while noisier tenants never hit the wall — the cap
   becomes a function of the abuser's luck landing on a cold pod.

The Redis-backed limiter (`rate-limit-redis.middleware.ts`) closes both
gaps by sharing a counter across every replica.

## Policy Matrix

Six route classes. The `ai` and `default` rows describe the gateway-wide
Express limiter; the remaining rows describe the Hono per-route limiter
overrides in `services/api-gateway/src/middleware/rate-limiter.ts`.

| Route class         | Pattern / examples                                                                 | Limit (per keying unit, per 60 s window)                                                                              | Enforcement layer                                  | Rationale                                                                 |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- |
| `public-unauth`     | `GET /health`, `/healthz`, `/api/v1/public-marketing/*`, login probes, register    | `anonymous` role tier = 100 / 60 s by IP (`rate-limiter.ts:73`). `POST /auth/login` hard-capped at 10 / 60 s (line 79) | Hono role-limiter + Express global                 | Defends against scraping / credential stuffing before auth resolves      |
| `public-auth`       | RESIDENT, OWNER dashboard + portal CRUD                                            | 200 / 60 s (RESIDENT) and 300 / 60 s (OWNER) (`rate-limiter.ts:71-72`). Key: `rate:<tenantId>:<userId>`              | Hono role-limiter                                  | Per-seat usage profile — human interaction fits well under these caps     |
| `ai-chat`           | `/api/v1/ai/*`, `/ai-native/*`, `/ai-chat/*`, `/doc-chat/*`, `/brain/*`            | `RATE_LIMIT_AI_MAX` = 30 / 60 s per tenant (gateway) **plus** role-tier cap (`rate-limiter.ts:64-72`)                  | Express Redis limiter (gateway) + Hono role-limiter | LLM spend is real money; a flat 100/min burns the monthly budget in an afternoon |
| `ai-voice`          | `/api/v1/voice/*` (`routes/voice.router.ts`)                                       | Folded into `ai` class at 30 / 60 s per tenant; voice tier on the provider caps concurrent sessions                   | Express Redis limiter                              | Voice minutes bill per second; concurrent-session cap is the real limit   |
| `documents-upload`  | `POST /documents/upload`, `/api/v1/documents/*` upload endpoints                   | 20 / 60 s per key (`endpointLimits`, `rate-limiter.ts:100`); body size capped at 1 MB by `requestSizeLimiter` (line 493) | Hono endpoint-limiter + size limiter              | OCR + storage pipeline is expensive; malformed-upload loops otherwise OOM |
| `admin`             | `PUT /api/v1/feature-flags/:key`, `/api/v1/admin/*`, autonomy-toggle, refund flows | SUPER_ADMIN 10 000 / 60 s, ADMIN 5 000 / 60 s (`rate-limiter.ts:64-65`). Refunds hard-capped at 10 / 60 s (line 97)   | Hono role-limiter + endpoint overrides            | Automation (rotation scripts, rollout) needs headroom; refund path must stay tight |
| `default`           | Every other authenticated `/api/v1/*` path                                         | `RATE_LIMIT_MAX_REQUESTS` = 100 / 60 s per tenant (gateway); role-tier ceiling on top                                 | Express Redis limiter + Hono role-limiter          | Standard CRUD; 100/min × tenant scales cleanly to the 20-replica cluster |

The global Express-level limiter runs first. The Hono-level per-endpoint
limiter runs on `/api/v1/*` routes after auth. Both must allow the request
or a 429 is returned.

### Route-specific overrides (take precedence over role tier)

From `services/api-gateway/src/middleware/rate-limiter.ts:77-101`:

| Endpoint                      | Limit           | Class fit           |
| ----------------------------- | --------------- | ------------------- |
| `POST /auth/login`            | 10 / 60 s       | `public-unauth`     |
| `POST /auth/register`         | 5 / 300 s       | `public-unauth`     |
| `POST /auth/forgot-password`  | 3 / 300 s       | `public-unauth`     |
| `POST /auth/mfa/verify`       | 5 / 60 s        | `public-unauth`     |
| `POST /webhooks/*`            | 10 000 / 60 s   | `default` (fan-in)  |
| `POST /reports/generate`      | 10 / 60 s       | `admin`             |
| `GET /reports/audit-pack/*`   | 5 / 60 s        | `admin`             |
| `POST /notifications/send`    | 100 / 60 s      | `admin`             |
| `POST /notifications/broadcast` | 5 / 300 s     | `admin`             |
| `POST /payments`              | 50 / 60 s       | `public-auth`       |
| `POST /payments/*/refund`     | 10 / 60 s       | `admin`             |
| `POST /documents/upload`      | 20 / 60 s       | `documents-upload`  |

A dedicated `loginRateLimiter` tracks failed attempts at 10 / 15 min per
IP and calls `blockIP(..., 900)` once exhausted
(`rate-limiter.ts:449-484`) — subsequent traffic returns `403` via
`ipBlockMiddleware` (lines 422-437).

## Keying Scheme

- **Authenticated requests** — keyed on `X-Tenant-ID` header.
  Key shape: `rl:tenant:{tenantId}:{routeClass}:{windowStartMs}`.
- **Unauthenticated / pre-auth requests** — keyed on client IP
  (`req.ip` / `X-Forwarded-For`).
  Key shape: `rl:ip:{ip}:{routeClass}:{windowStartMs}`.

Window length: 60s (fixed-window counter).
TTL on each Redis key: window + 1s safety margin. `INCR` + `PEXPIRE`
pipelined for atomicity.

## Degraded-Mode Behaviour

| Condition                       | Behaviour                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `REDIS_URL` unset               | Falls back to the in-memory limiter. Acceptable in dev / tests. **NEVER deploy to prod this way.** |
| Redis pipeline raises (outage)  | Falls back to in-memory on a per-request basis. Logs one warn line per process lifetime.   |
| Redis ALTOGETHER unreachable on boot | Express logs the init failure and serves traffic with the in-memory limiter.           |

The degraded path intentionally never returns 500 — a broken limiter must
never hard-fail a request. Operators watch the warn logs + the
`rate-limit: redis unavailable` metric to catch degradation.

## Response Contract

- **Allowed**: request proceeds. Response carries:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset` (epoch seconds)
  - `X-RateLimit-Class` (`ai` or `default`)
- **Denied**: HTTP `429 Too Many Requests` with:
  - `Retry-After` header (seconds)
  - JSON body: `{ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message, routeClass, retryAfter } }`

## Environment Variables

| Variable                   | Default  | Purpose                                  |
| -------------------------- | -------- | ---------------------------------------- |
| `REDIS_URL`                | (unset)  | Connection string; enables distributed limiter. |
| `RATE_LIMIT_WINDOW_MS`     | `60000`  | Window length in ms.                     |
| `RATE_LIMIT_MAX_REQUESTS`  | `100`    | Default-class ceiling per window.        |
| `RATE_LIMIT_AI_MAX`        | `30`     | AI-class ceiling per window.             |

## Change Management

Policy changes require PR review from platform + product. Bump the numeric
caps in a single commit that also updates this table. Do not raise the
`ai` class cap without confirming the monthly LLM budget can absorb the
worst-case spike (per-tenant max × active tenants × window-count).

Route additions land in three places:

1. The endpoint map at `services/api-gateway/src/middleware/rate-limiter.ts:77-101`.
2. This matrix (keep route classes in the fixed six-row order).
3. A test case in `services/api-gateway/src/middleware/__tests__/` that
   asserts the limit fires.

Loosening a tier requires a capacity-planning review against the
baseline in `Docs/OPERATIONS.md:124-136`. Tightening requires a consumer
audit — customer / owner apps retry aggressively and may surface 429s.

## Cross-links

- Incident response when 429 rate spikes (cache fills, DLQ feedback loop):
  [`./RUNBOOKS/incident-response.md`](./RUNBOOKS/incident-response.md)
- Tenant onboarding (per-tenant limits apply from first request):
  [`./RUNBOOKS/tenant-onboarding.md`](./RUNBOOKS/tenant-onboarding.md)
- SLO budgets backing these caps: `Docs/KPIS_AND_SLOS.md:63-81`
