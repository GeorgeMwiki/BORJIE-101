# DESIGN SPEC — Lane `scale-dbclient-pooler-ha`

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Lane scope:** RSS-03, RSS-04, RSS-05, RSS-06, RSS-08, RSS-10 + the
per-request-tx-held-across-LLM-call hazard. THE highest-blast-radius lane:
it changes how *every* request talks to Postgres. Designed to be applied as
small, independently-revertible steps behind env flags so the build pass is
safe.
**Author:** lane spec pass over `client.ts`, `middleware/database.ts`,
`composition/db-client.ts`, `with-tenant-context.ts`, `wake-loop-cron.ts`,
`cockpit-events/bus.ts`, `cross-portal-bus.ts`, `rate-limit-redis.middleware.ts`,
`rate-limiter.ts`, `index.ts` cron block, `infra/k8s/overlays/prod`, `k8s/ha/`.
Grounded in current (June 2026) SOTA — sources inline.

> **This is a SPEC, not code.** No source file is edited by this document.
> Exact paths, functions, line anchors, migration numbering, test plan, and a
> staged reversible rollout follow. Every Borjie hard-rail is honoured:
> RLS-FORCE never weakened, canonical `app.current_tenant_id` GUC, money path
> still through `LedgerService.post`, append-only migrations, Pino-only (no
> `console.*`) in services, `formatCurrency` multi-currency untouched, EN/SW
> toggle untouched.

---

## 0. The core finding (why this lane is the keystone of Wave A scale)

The prod `DATABASE_URL` is the Supabase **transaction-mode** pooler (`:6543`).
Two structural incompatibilities exist today:

1. **`withReservedConnection` (`packages/database/src/client.ts:222-247`)** pins
   ONE backend connection per request and binds the RLS tenant GUC with
   `set_config('app.current_tenant_id', t, false)` (session scope, `false` =
   not transaction-local). This is **correct on a SESSION pooler** but on the
   transaction pooler statement affinity is NOT guaranteed across the
   pooler↔backend boundary: the reserved handle is a *client→pooler* lease, not
   a *pooler→backend* pin. A session-scoped GUC set on backend A can be read by
   a later statement that the pooler routes to backend B (whose GUC was last
   set by a different tenant) → **silent cross-tenant row leak**, OR you are
   forced onto the connection-starved session pooler (`:5432`) and hit the
   active-connection ceiling.

2. **`readPoolOptions()` (`client.ts:73-101`)** never sets `prepare:false`.
   postgres-js defaults to named prepared statements; the transaction pooler
   rebinds you to a different backend mid-session → `prepared statement "s_x"
   does not exist` under load. The codebase already knows this — the migration
   runner sets it (`packages/database/src/run-migrations.ts:285 prepare:false`).

The fix is the SOTA-canonical model for "RLS + transaction pooler": **drop the
per-request connection pin; bind the tenant GUC with `SET LOCAL` inside a short
per-DB-operation transaction; set `prepare:false`.** `SET LOCAL` is scoped to
the enclosing transaction, so the pooler's per-transaction backend affinity (a
transaction is never split across backends) makes the GUC correct *by
construction* — and the connection is released to the pool the instant the
transaction commits, so it is never held across an LLM/payment/calendar round
trip. This is exactly the "acquire-late / release-early" unit-of-work boundary.

Borjie **already has** the correct primitive: `withTenantContext(db, tenantId,
fn)` (`packages/database/src/rls/with-tenant-context.ts:38-85`) opens a
transaction and issues `set_config('app.current_tenant_id', tenantId, true)` —
the `true` third arg = transaction-local = `SET LOCAL` semantics. The lane's
job is to make that the ONLY production RLS path and retire the reserve()-pin.

SOTA confirmation (June 2026): Supabase docs — pooler `:6543` for app queries,
direct `:5432` for migrations only, and **disable prepared statements in the
ORM** (`prepare:false`) for transaction mode; PgBouncer rejects named prepared
statements in transaction mode unless `max_prepared_statements>0`, which
Supavisor/shared pooler does not guarantee. Sources:
[Supabase — Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Supabase — Disabling Prepared statements](https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL),
[Supavisor — Pool Modes](https://supabase.github.io/supavisor/configuration/pool_modes/),
[Production Postgres Pooling: PgBouncer + Supavisor 2026](https://nerdleveltech.com/production-postgres-pooling-pgbabcer-supabase-supavisor-tutorial).
Acquire-late/release-early unit-of-work doctrine:
[SQLAlchemy — Transactions & Connection Management](https://docs.sqlalchemy.org/en/20/orm/session_transaction.html),
[Avoiding idle-in-transaction](https://www.gorgias.com/blog/prevent-idle-in-transaction-engineering).

---

## 1. RSS-03 + tx-across-LLM hazard — RLS on the transaction pooler

### 1.1 The `SET LOCAL` correctness proof (the security argument)

**Claim:** binding the tenant GUC with `SET LOCAL` (`set_config(..., true)`)
inside a transaction, on a `prepare:false` client, against the transaction
pooler, can NEVER read another tenant's rows.

**Proof sketch (must be captured verbatim as the doc-comment on the new
`databaseMiddlewareNoPin` contract + as the assertion comment in the
cross-tenant leak test):**

1. The transaction pooler guarantees one invariant: a single SQL **transaction**
   is served end-to-end by one backend (it only multiplexes *between*
   transactions). [Supavisor pool modes, above.]
2. `withTenantContext` runs `BEGIN; SET LOCAL app.current_tenant_id = $t; …
   queries …; COMMIT/ROLLBACK` as one transaction (`with-tenant-context.ts:69-84`).
3. Therefore the `SET LOCAL` and every query that reads it execute on the
   **same** backend, and `SET LOCAL` is discarded at transaction end — it cannot
   bleed onto the next transaction the pooler routes to that backend.
4. FORCE-RLS policies read `current_setting('app.current_tenant_id', true)`
   (migration 0172 `public.current_app_tenant_id()`); with no value set the
   `missing_ok=true` second arg returns `''`/NULL → policy matches **zero**
   tenant rows (fail-closed), never "all rows".
5. `prepare:false` removes the only remaining cross-backend failure mode
   (a prepared plan handle that does not exist on the rebind target).

∎ The reserve()-pin is therefore **unnecessary** on the transaction pooler and
**unsafe** (its session-scoped GUC outlives the logical request boundary on a
rebind). Removing it is a net security improvement, not a relaxation.

### 1.2 File-level changes

**`packages/database/src/client.ts`**
- `readPoolOptions()` (line 73): add `prepare: process.env.DATABASE_PREPARE === 'true' ? true : false` — **default `false`** (transaction-pooler-safe). An operator on a dedicated session pooler can opt back into prepared statements via env, but prod defaults safe. Also add `fetch_types: false` adjacent (postgres-js issues a type-introspection round-trip on connect that also breaks under aggressive transaction rebinding) gated the same way.
- `readReadonlyPoolOptions()` (line 258): same `prepare`/`fetch_types` treatment (replica is also behind the pooler).
- **Deprecate but DO NOT yet delete** `withReservedConnection` (lines 222-247) and `reservedToDrizzle` (173-220). Add a doc-comment marking them `@deprecated — transaction-pooler-unsafe; retained only for the session-pooler opt-in path (DATABASE_POOL_MODE=session)`. Deleting them is a separate final step (§7 Stage 5) after the no-pin path is proven in prod, so the change is reversible.

**`services/api-gateway/src/middleware/database.ts`**
- This file's `databaseMiddleware` (line 328) is the reserve()-pin path. The lane makes `databaseMiddlewareNoPin` (line 439) the default for **all** tenant-scoped routers. Concretely:
  - Introduce a single env switch read once at module load: `const RLS_MODE = process.env.DATABASE_POOL_MODE === 'session' ? 'pin' : 'set-local'` (default `set-local`).
  - In `databaseMiddleware`, when `RLS_MODE === 'set-local'`, **delegate to the no-pin body** (inject db+repos+mock-gate, do NOT reserve, do NOT bind a session GUC). When `'pin'`, keep today's reserve path verbatim. This keeps one mount point for routers (no route churn) while flipping the engine underneath behind a flag.
  - The per-operation tenant binding then happens where it already should: repositories and brain tools already wrap their queries in `withTenantContext(...)` (e.g. `brain-thread.repository.ts:89,130,174`, `data-analysis-tools.ts:177`, `drizzle-memory-tool.ts:120`, `chat-conformal-confidence.ts:75`). The audit gap is routes that issue **raw** `c.get('db')` queries assuming the middleware already bound the GUC. Those must be wrapped. See §1.3.

**`services/api-gateway/src/middleware/person-context.ts`** (lines 191-203 doc-comment) — update the comment: the request `db` is no longer a reserved-connection client; `app.current_person_id` must be bound per-operation via the same `withTenantContext` transaction (extend `withTenantContext` to optionally accept `personId`, see §1.4) rather than `set_config(..., false)` on a held connection.

### 1.3 The route-audit sub-task (the real work of RSS-03)

Removing the pin means any route that runs a **bare** `c.get('db')` query
*outside* a `withTenantContext` wrapper would run with NO tenant GUC → RLS
returns zero rows (fail-closed: a correctness/empty-result bug, NOT a leak —
the proof in §1.1 step 4 guarantees we fail safe). The lane must therefore
sweep every tenant-scoped route and ensure its DB access is wrapped.

- **Detection (CI-enforced, not manual):** add an ESLint rule
  `require-tenant-context` (mirror the existing `require-csrf-headers` rule
  surfaced in `.github/workflows/csrf-eslint-rule.yml`) that flags any
  `c.get('db')` / `ctx.db` usage in `services/api-gateway/src/routes/**` that is
  not lexically inside a `withTenantContext(` / `withServiceRoleContext(`
  callback. Run it in `pr-check.yml`. This makes the invariant
  machine-checkable and prevents regressions for the lifetime of the codebase.
- **Remediation:** wrap the flagged sites. The common shape is a one-line
  `return withTenantContext(db, auth.tenantId, (tx) => …existing query on tx…)`.
- **Helper for ergonomics:** add `getTenantDb(c)` to `middleware/database.ts`
  returning `{ tenantId, run: <T>(fn) => withTenantContext(db, tenantId, fn) }`
  so route authors have one obvious path.

### 1.4 `withTenantContext` extension (person + service GUCs in one tx)

`with-tenant-context.ts:38` already sets `app.current_tenant_id`,
`app.tenant_id` (legacy mirror), `app.is_service_role`. Extend the opts to also
accept an optional `personId` → emit `SET LOCAL app.current_person_id = $p`
inside the same transaction. This replaces the person-context middleware's
reliance on a held connection. No new GUC names; all transaction-local (`true`).

### 1.5 Reversibility

`DATABASE_POOL_MODE=session` + `DATABASE_PREPARE=true` restores the exact
prior behaviour (reserve-pin + prepared statements) with zero code change —
the deprecated functions are retained until Stage 5. The ESLint rule is the
only thing that cannot be env-reverted, but it is additive (lint-only).

---

## 2. RSS-04 — collapse N pools/process → one shared bounded pool

**Today:** ≥5 `createDatabaseClient(...)` sites each open an independent
postgres-js pool (`max:20`), multiplied by replicas → overruns the pooler's
client ceiling. Sites:
- `services/api-gateway/src/middleware/database.ts:93` (`getDatabase()`)
- `services/api-gateway/src/composition/db-client.ts:51` (`getDb()` — the
  canonical singleton, already memoised)
- `services/api-gateway/src/routes/ai-chat.router.ts:74` (`dbCache`)
- `services/api-gateway/src/routes/brain.hono.ts:97` (`dbCache`)
- `services/api-gateway/src/routes/brain-voice.hono.ts` (dedicated pool)

**Change:** make `composition/db-client.ts:getDb()` the **single** pool factory
of record for the api-gateway process.
- `middleware/database.ts:getDatabase()` (line 86) → return `getDb()` from
  `../composition/db-client.js` instead of calling `createDatabaseClient`
  directly. (Today they are two pools in the same process despite the
  `db-client.ts` header claiming they share one — they do NOT; this closes that
  drift.)
- `ai-chat.router.ts`, `brain.hono.ts`, `brain-voice.hono.ts` → replace the
  module-local `dbCache = createDatabaseClient(...)` with `getDb()`. These
  routers use `databaseMiddlewareNoPin` already (they hold connections across
  LLM streams), so they were correct to avoid the pinned middleware — but they
  must share the one pool, not open their own.
- **Sizing:** `DATABASE_POOL_MAX` (already env-driven, `client.ts:75`) becomes
  a budget knob: `pool_max × replica_count ≤ pooler_client_limit × 0.8`. Document
  the formula in `Docs/AUDIT/SCALE_RUNBOOK.md` (already referenced from
  `client.ts:59`). With the pooler in front, a small `max` (e.g. 8-10) per
  replica is correct because the pooler — not the app pool — owns backend
  multiplexing.
- **Worker processes** (consolidation-worker, etc.) keep their own single pool;
  this lane is scoped to the api-gateway process. Note in the spec that workers
  must ALSO ship `prepare:false` (they share `@borjie/database`'s `client.ts`,
  so §1.2's default fixes them for free).

**Reversibility:** each call-site swap is independent; revert one file to
restore its dedicated pool. No schema, no data.

---

## 3. RSS-06 — leader-elect the 27 in-process crons

**Today:** `services/api-gateway/src/index.ts:3252-3361` starts ~27 cron/worker
supervisors. Only `wakeLoopCron` self-guards with `pg_try_advisory_lock`
(`wake-loop-cron.ts:203-226`). The other ~26 run on **every** replica → 50×
duplicate LLM spend, duplicate gov-endpoint hits (fx-feed ban risk), duplicate
notification fan-out.

**Decision — PG advisory lock, not k8s Lease.** SOTA notes both are valid; the
k8s `Lease` (coordination.k8s.io/v1) is the "native" recommendation, but Borjie
already has the advisory-lock pattern in-tree (`wake-loop-cron.ts`), every cron
already has the DB handle in scope, and a DB-backed lock needs no RBAC /
ServiceAccount / API-server watch. The one SOTA caveat — "Postgres becomes a
critical coordination dependency" — is already true (the crons do nothing
without the DB anyway), and HA-Postgres (§6) removes the SPOF. Use a
**session-level** `pg_advisory_lock` held for the supervisor's lifetime (one
leader per lock-id cluster-wide), not the per-tick `try`/`unlock` the wake-loop
uses (per-tick is correct for *idempotent* sweeps; long-lived crons want a
stable single leader to avoid leader-flapping mid-run).
Sources: [Kubernetes — Leases](https://kubernetes.io/docs/concepts/architecture/leases/),
[Implement Kubernetes Leader Election (2026)](https://oneuptime.com/blog/post/2026-01-30-kubernetes-leader-election/view).

**New file:** `services/api-gateway/src/composition/cluster-lock.ts`
- `export async function withClusterLeader(db, lockId: bigint, supervisor: { start(): void; stop(): void }, logger): Promise<{ start, stop }>` — a wrapper that, on `start()`, opens a **dedicated** single connection (NOT from the request pool — a held session lock must not consume a pooled backend; open via `db.$client.reserve()` on the session-pooler side OR a tiny dedicated `postgres(url,{max:1})` lock pool), runs `pg_advisory_lock(lockId)`, and only then calls the wrapped supervisor's `.start()`. A background renewal/health-check re-checks `pg_advisory_lock_shared` ownership; on connection loss the lock auto-releases (session locks release on disconnect) and another replica acquires it. `stop()` calls supervisor `.stop()` then `pg_advisory_unlock` + closes the lock connection.
- Provide a **stable lock-id allocator**: `export function lockIdFor(name: string): bigint` = `sha256(name) → BIGINT` (mirror `WAKE_LOCK_ID = 7321946218472901` in `wake-loop-cron.ts:104`). Each cron gets a deterministic id from its stable name (e.g. `lockIdFor('fx-feed')`).
- **Important pooler nuance:** advisory-lock connections MUST go through the **session** pooler (`:5432` / `DATABASE_SESSION_URL`) or a direct connection, because a session-held lock on the transaction pooler would be released the moment that transaction-multiplexed backend is handed to another client. Add `DATABASE_SESSION_URL` env (falls back to `DATABASE_URL` when the operator runs a single session pooler). Document this as the one place that legitimately needs a session connection.

**`services/api-gateway/src/index.ts` (3252-3361):** wrap each cron `.start()`
in `withClusterLeader(db, lockIdFor('<stable-name>'), supervisor, logger)`.
Crons that are **already idempotent and cheap** (e.g. ones writing through
`ON CONFLICT` ledgers) MAY stay multi-replica, but the default is leader-only.
Add a per-cron allow-list constant `MULTI_REPLICA_SAFE_CRONS` so the choice is
explicit and reviewable. fx-feed (RSS-07 sibling) MUST be leader-only AND get
`ON CONFLICT (ts,pair) DO UPDATE` (out of lane scope but cross-referenced).

**Reversibility:** the wrapper is opt-in per cron. Setting
`CLUSTER_LEADER_DISABLED=true` makes `withClusterLeader` a pass-through
(`start()` → `supervisor.start()` directly) restoring run-on-every-replica.

---

## 4. RSS-08 — distributed rate limiter (process-local Map → Redis token bucket)

**Today — two limiters:**
1. `middleware/rate-limit-redis.middleware.ts` — **already Redis-backed**
   (fixed-window INCR+PEXPIRE), wired at `index.ts:971`. Good, but fixed-window
   allows a 2× boundary burst, and it has an in-memory fallback that re-opens
   the cross-replica cap when Redis is down.
2. `middleware/rate-limiter.ts:106-245` — `TokenBucketRateLimiter` over a
   **process-local `Map`** (`rateLimitStore`, line 144). `perUserRateLimit` /
   `customRateLimit` (lines 399-418) are the per-route limiters → effective cap
   = `max × replicas`. THIS is the RSS-08 gap.

**Change — make the per-route token bucket Redis-backed and atomic via a Lua
script.** SOTA: the refill-check-consume cycle MUST be one atomic `EVAL` (read
hash, compute tokens from elapsed time, conditionally decrement) — otherwise
two replicas race the read-modify-write. Sources:
[Redis — rate limiting howtos](https://redis.io/tutorials/howtos/ratelimiting/),
[Rate limiting for distributed systems with Redis + Lua (Callr)](https://blog.callr.tech/rate-limiting-for-distributed-systems-with-redis-and-lua/),
[Hidden complexity of distributed rate limiting (2026)](https://bnacar.dev/2025/10/23/hidden-complexity-of-rate-limiting.html).

- **New file:** `services/api-gateway/src/middleware/redis-token-bucket.ts` —
  a `RedisTokenBucket` that takes an ioredis client and runs a single
  `EVAL`/`EVALSHA` Lua script implementing token-bucket
  (`{capacity, refillRatePerSec}` → `{allowed, remaining, retryAfter}`), keyed
  `tb:{scope}:{key}`. Per-key `PEXPIRE` set to `capacity/refillRate × 2` so idle
  keys self-evict.
- **`middleware/rate-limiter.ts`:** keep the public `perUserRateLimit` /
  `customRateLimit` signatures unchanged; swap the `TokenBucketRateLimiter`
  internals to call `RedisTokenBucket` when a shared ioredis client is present,
  falling back to the existing in-memory `TokenBucketRateLimiter` ONLY when
  `REDIS_URL` is unset (dev) — and in production, when Redis is genuinely down,
  **fail-closed-ish**: reuse the degrade/Sentry signal pattern already in
  `rate-limit-redis.middleware.ts:292-317` so on-call is paged rather than the
  cap silently widening. The shared ioredis client is the same one the
  cross-portal-bus / webhook-idempotency already construct; resolve it from the
  service registry, do not open another.
- **Optional consolidation:** fold the fixed-window `rate-limit-redis.middleware`
  into the token-bucket too (one algorithm, burst-tolerant) — but that is a
  cleanup, not required for the gap; keep both initially to minimise blast
  radius.

**Reversibility:** `REDIS_URL` unset → in-memory fallback (today's behaviour).
The Lua script is pure-additive; revert the `rate-limiter.ts` internal swap to
restore the Map.

---

## 5. RSS-05 — cross-replica SSE bus (in-process EventEmitter → Redis pub/sub)

**Today:** `services/api-gateway/src/services/cockpit-events/bus.ts:36` is a
singleton `EventEmitter`. At N replicas, an event published on replica A reaches
only the SSE clients connected to A → ~(N-1)/N of subscribers miss it. The
file's own header (lines 5-12) names the exact seam to swap.

**Key reuse finding:** Borjie **already ships** the Redis pub/sub fan-out the
cockpit bus needs — `services/api-gateway/src/composition/cross-portal-bus.ts`
(`createCrossPortalBus`, Redis-backed with in-memory dev fallback, per-tenant
topic isolation, payload validation). RSS-05 should **not** build a new Redis
bus; it should back the cockpit bus with this one.

- **`cockpit-events/bus.ts`:** convert the two functions to a port. Keep the
  exact public signatures (`publishCockpitEvent(event): number`,
  `subscribeCockpitEvents(tenantId, handler): () => void`) — ~35 call sites
  depend on them (grep showed routes across mining/workforce/marketplace plus
  workers; signature stability is mandatory to keep blast radius zero). Internally:
  - On publish: in addition to (or instead of) the local `emitter.emit`, call
    `crossPortalBus.publish(tenantTopic(event.tenantId), …)` with a
    `kind:'state-mutation'`-shaped envelope (extend `CrossPortalEventShape`
    union with a `'cockpit-event'` kind, or wrap the cockpit event in `payload`).
  - On the SSE route side (`routes/cockpit-stream.hono.ts`): each replica's
    `subscribeCockpitEvents` registers a `crossPortalBus.subscribe(tenantTopic(...))`
    handler that re-emits onto the local EventEmitter, so the existing local
    fan-out to that replica's SSE clients is preserved. Net: publish on any
    replica → Redis → every replica → its local SSE clients. Local-only emit is
    retained as the dev/no-Redis path.
- **Wiring:** resolve the singleton `CrossPortalBus` from the composition root
  (it is already built there) and inject it into the cockpit bus module via an
  `initCockpitBus(bus)` setter called once at boot — do not import the bus
  factory inside `bus.ts` (keeps the module testable and avoids a Redis dep in
  unit tests; the `__resetCockpitBusForTests` helper at line 77 stays).

**Reversibility:** `REDIS_URL` unset → `createCrossPortalBus` already returns
the in-memory bus → behaviour identical to today (single-replica). The
`initCockpitBus` injection is the only new wire; not calling it leaves the local
EventEmitter as the sole path.

---

## 6. RSS-10 — Postgres + Redis SPOF → HA

**Today:**
- `infra/k8s/base/postgres-statefulset.yaml:31` → `replicas:1`, line 78 RWO PVC
  → single Postgres pod, no standby.
- `infra/k8s/base/redis-deployment.yaml:17` → `replicas:1` → single Redis.
- The **HA bundle already exists** at `k8s/ha/` (per its README: Patroni
  Postgres ×3 + etcd ×3 + HAProxy ×2 + Redis primary/replica ×3 + Redis
  Sentinel ×3, all bundled by `k8s/ha/kustomization.yaml`) — but
  `infra/k8s/overlays/prod/kustomization.yaml` references `../../base`, NOT the
  HA bundle. It is dead infrastructure.

**Decision — prefer MANAGED HA, keep the self-hosted bundle as the fallback.**
Because prod already runs against **Supabase** (managed Postgres with built-in
HA + read replicas) per the live-DB memory and the `:6543` pooler, the
production-correct move is NOT to deploy the in-cluster Patroni bundle but to:
1. **Postgres:** rely on Supabase's managed primary + add a Supabase **read
   replica**, and wire `DATABASE_URL_READONLY` (already consumed by
   `composition/db-client.ts:getDbReadonly()` at lines 73-102 — the HA wire is
   built, just unconfigured). Route hot read-only dashboard queries through
   `getDbReadonly()`. The self-hosted `k8s/ha/` bundle is the documented path
   for self-hosted / air-gapped deploys only.
2. **Redis:** deploy HA Redis. Two acceptable targets, pick per environment:
   (a) managed (Upstash / ElastiCache with replica + automatic failover), or
   (b) the in-cluster `k8s/ha/redis-sentinel-statefulset.yaml` + Sentinel ×3.
   ioredis must be constructed in **Sentinel-aware** mode (or pointed at the
   managed failover endpoint) so a primary failover is transparent to the
   cross-portal-bus / rate-limiter / token-bucket clients.

**File-level:**
- `infra/k8s/overlays/prod/kustomization.yaml` — add the HA Redis resource
  (and, for self-hosted, the `k8s/ha/` Postgres bundle) to `resources:`, OR
  document the managed endpoints in the prod `ExternalSecret` (the base
  statefulset header at `postgres-statefulset.yaml:9` already says prod points
  `DATABASE_URL` at a managed endpoint via ExternalSecret — extend that to add
  `DATABASE_URL_READONLY`, `DATABASE_SESSION_URL`, `REDIS_URL` to the
  ExternalSecret). DO NOT commit any secret value.
- Reconcile the base→overlay so prod no longer ships `replicas:1` self-hosted
  Postgres/Redis when managed endpoints are configured (gate the base
  statefulsets behind a `selfHosted` component so the overlay can exclude them).
- RSS-24 sibling (HPA ceiling 50 vs 20) is out of lane but cross-referenced:
  the pool-sizing formula in §2 depends on the true `maxReplicas`; reconcile it
  in the same PR-adjacent infra pass.

**Reversibility:** purely a kustomize/ExternalSecret change. Revert the overlay
to `../../base` to restore single-instance. No app code, no data migration. The
`getDbReadonly()` fallback (lines 86-89) already aliases the primary when
`DATABASE_URL_READONLY` is unset, so unconfiguring it is safe.

---

## 7. Migrations

This lane is **almost entirely runtime/infra**; the only schema-touching piece
is the index that makes RLS-at-scale cheap (the SCALE_SPEC P1 RLS-at-scale item,
folded here because it directly protects the new SET-LOCAL hot path from
sequential scans on the tenant predicate).

**New append-only migration: `packages/database/src/migrations/0313_rls_tenant_id_indexes.sql`**
(latest shipped is `0312_memory_v2_durable_stores.sql`; this lane appends 0313).

Contents (idempotent, re-runnable — match the existing 0310 style with
`IF NOT EXISTS` and `DO $$` guards):
- `CREATE INDEX CONCURRENTLY IF NOT EXISTS … ON <table> (tenant_id)` for every
  high-traffic tenant-scoped table whose RLS `USING` predicate filters on
  `tenant_id` and which currently lacks a leading-`tenant_id` index (enumerate
  from `packages/database/src/schemas/*`; ledger, bids, KYC, threads, corpus,
  notifications are the hot ones). `CONCURRENTLY` so it does not lock writes —
  which means this migration must be flagged as **non-transactional** for the
  runner (the runner wraps each file in a tx by default; add the established
  `-- borjie:no-transaction` pragma / split-file convention used elsewhere, or
  document that 0313 runs outside the wrapper).
- **No RLS policy change. No table change. No `WITH CHECK` change.** This is
  purely an access-path index migration — it cannot alter row visibility, so it
  cannot weaken isolation.
- **Migration-safety:** indexes are additive and reversible (`DROP INDEX
  CONCURRENTLY` in the `down/` companion). No NOT NULL backfill, so the
  `migration-safety-check.yml` NOT-NULL hazard validator passes trivially.

> Note: the `WITH CHECK` corpus-write hardening (DP-02) and the unique
> upsert-key (KI-05) already shipped as `0310`/`0311` — they are NOT this lane.
> This lane adds only the access-path indexes the SET-LOCAL path needs.

---

## 8. Test plan

**Unit (Vitest, `packages/database` + `services/api-gateway`):**
1. `client.ts`: assert `readPoolOptions()` returns `prepare:false` by default
   and `prepare:true` only when `DATABASE_PREPARE==='true'`; same for
   `fetch_types`. (No DB needed — pure option assertion.)
2. `with-tenant-context.ts`: extend existing tests to assert the new `personId`
   opt emits exactly one `set_config('app.current_person_id', $p, true)` inside
   the transaction and nothing leaks outside it (assert against the recording
   stub db).
3. `cluster-lock.ts`: with a fake db, assert `withClusterLeader` calls
   `pg_advisory_lock(id)` before `supervisor.start()`, calls `unlock` + close on
   `stop()`, and pass-through when `CLUSTER_LEADER_DISABLED==='true'`. Assert
   `lockIdFor('fx-feed')` is deterministic and in BIGINT range.
4. `redis-token-bucket.ts`: with `ioredis-mock`, assert the Lua script
   allows up to `capacity` then 429s, and refills at `refillRatePerSec`. Assert
   two `RedisTokenBucket` instances sharing one redis enforce ONE shared cap
   (the cross-replica property).
5. `cockpit-events/bus.ts`: with an injected in-memory `CrossPortalBus`, assert
   `publishCockpitEvent` reaches a subscriber registered through a *second*
   bus-backed handler (simulating a second replica), and that tenant isolation
   holds (tenant A publish never reaches tenant B subscriber).

**Integration (real Postgres in CI — reuse `migration-apply-check.yml`'s
PG17+pgvector service, behind the transaction pooler if available, else direct):**
6. **The cross-tenant leak test (the crown jewel — gates the merge).** Two
   concurrent "requests" interleaved on the shared pool: request-T1 binds tenant
   A via `withTenantContext`, request-T2 binds tenant B; assert each only ever
   reads its own rows across 1000 interleaved iterations with `prepare:false`.
   Run it in BOTH modes (`set-local` and the deprecated `pin`) to prove parity.
   Capture the §1.1 proof as the test's doc-comment.
7. With the GUC unset (no `withTenantContext`), a tenant-scoped `SELECT` returns
   **zero** rows (fail-closed), never all rows.
8. `0313` indexes: `EXPLAIN` a representative RLS-filtered query shows an
   index scan on `(tenant_id)` not a seq scan.

**Load / resilience (extend `sandbox-load-test.yml` or add a k6 job — SCALE_SPEC
P2 gate, stubbed here as the acceptance bar):**
9. k6 breakpoint against `/health` + one read route at the target replica count:
   assert active backend connections at the pooler stay under the configured
   ceiling (proves RSS-04 sizing) and p99 does not collapse (graceful-at-limit).
10. Cron leader test: boot 3 gateway processes against one DB; assert each
    leader-only cron's lock is held by exactly one process and that killing the
    leader promotes another within the renewal interval.

**E2E (Playwright, existing harness):** smoke the cockpit SSE stream against a
2-replica deploy (or a single process with two bus instances) and assert an
event published "elsewhere" arrives at the connected client (RSS-05 end-to-end).

---

## 9. Staged, reversible rollout (the safety contract)

Each stage is independently deployable and independently revertible. No stage
deletes a fallback until the next stage has proven the new path in prod.

| Stage | Change | Flag / revert | Risk |
|---|---|---|---|
| **0** | Ship `prepare:false`+`fetch_types:false` defaults (§1.2) | `DATABASE_PREPARE=true` reverts | Low — already proven in run-migrations |
| **1** | Add `withTenantContext.personId`, `getTenantDb` helper, ESLint `require-tenant-context` (warn-only first) (§1.3-1.4) | Additive; rule warn→error later | Low |
| **2** | Flip `databaseMiddleware` to `set-local` default; wrap audited raw-db routes (§1.2-1.3). **Gate behind `DATABASE_POOL_MODE`** | `DATABASE_POOL_MODE=session` reverts to pin | **Highest** — run leak test #6 in CI as the gate; canary one cell first |
| **3** | Consolidate pools to `getDb()` (§2) | per-file revert | Low-Med |
| **4** | `cluster-lock.ts` + wrap crons (§3); Redis token-bucket (§4); cockpit bus over cross-portal-bus (§5) | `CLUSTER_LEADER_DISABLED`, `REDIS_URL` unset, no `initCockpitBus` each revert | Med — needs HA Redis (Stage 5) for full benefit |
| **5** | Wire prod overlay to managed HA + `DATABASE_URL_READONLY`/`DATABASE_SESSION_URL`/`REDIS_URL` ExternalSecret (§6); apply `0313` indexes; **then** delete deprecated `withReservedConnection`/`reservedToDrizzle` | overlay→`../../base` reverts infra; index has `down/`; function deletion is the final, separate commit | Med |

**Promote `require-tenant-context` from warn to error only after Stage 2 is
green in prod** — that is the durable guarantee that no future route silently
re-introduces an unbound-GUC empty-result bug.

---

## 10. Hard-rail compliance checklist

- **RLS never weakened:** §1.1 proves SET-LOCAL is *stronger* than the
  session-GUC pin on the transaction pooler; `0313` is index-only (no policy
  change); fail-closed (zero rows) on unbound GUC. ✓
- **Canonical `app.current_tenant_id`:** the only GUC name set; legacy
  `app.tenant_id` mirror retained exactly as `with-tenant-context.ts` does. ✓
- **Money path:** untouched — ledger writes still go through
  `LedgerService.post`; this lane only changes *how the connection carrying that
  write gets its tenant GUC* (now per-tx SET LOCAL), never the ledger logic. ✓
- **Append-only migrations:** new `0313` only; no shipped file edited. ✓
- **No `console.*` in services:** all new code uses Pino (`logger`/
  `createPinoLikeLogger`), matching `wake-loop-cron.ts` / `cross-portal-bus.ts`. ✓
- **`formatCurrency` / multi-currency:** untouched. ✓
- **EN/SW toggle:** untouched (no user-facing copy). ✓
- **Kill-switch fail-closed / no reflective CORS / no raw HTML:** untouched. ✓
- **No `process.env` outside bootstrap:** the new env reads
  (`DATABASE_POOL_MODE`, `DATABASE_PREPARE`, `DATABASE_SESSION_URL`,
  `CLUSTER_LEADER_DISABLED`) follow the existing `client.ts`/`db-client.ts`
  pattern (read at module load / factory, not per-request); `DATABASE_SESSION_URL`
  is read in the cluster-lock factory, consistent with how `db-client.ts` reads
  `DATABASE_URL_READONLY`. ✓

---

## 11. Files this lane will change (for the build pass)

**Edit:**
- `packages/database/src/client.ts` (prepare/fetch_types defaults; deprecate reserve helpers)
- `packages/database/src/rls/with-tenant-context.ts` (optional personId GUC)
- `services/api-gateway/src/middleware/database.ts` (set-local default; getTenantDb helper)
- `services/api-gateway/src/middleware/person-context.ts` (doc + per-op person GUC)
- `services/api-gateway/src/middleware/rate-limiter.ts` (Redis token-bucket internals)
- `services/api-gateway/src/composition/db-client.ts` (single shared pool of record)
- `services/api-gateway/src/routes/ai-chat.router.ts`, `routes/brain.hono.ts`, `routes/brain-voice.hono.ts` (use `getDb()`)
- `services/api-gateway/src/services/cockpit-events/bus.ts` + `routes/cockpit-stream.hono.ts` (back with cross-portal-bus)
- `services/api-gateway/src/index.ts` (wrap crons in `withClusterLeader`)
- `infra/k8s/overlays/prod/kustomization.yaml` (+ prod ExternalSecret) (HA + replica/session/redis URLs)
- audited tenant-scoped routes flagged by the new ESLint rule (wrap raw `c.get('db')`)

**New:**
- `services/api-gateway/src/composition/cluster-lock.ts`
- `services/api-gateway/src/middleware/redis-token-bucket.ts`
- `packages/database/src/migrations/0313_rls_tenant_id_indexes.sql` (+ `down/` companion)
- ESLint rule `require-tenant-context` (+ `.github/workflows` wire into pr-check)
- tests per §8

**Reference-only (NOT changed — reused as-is):**
- `services/api-gateway/src/composition/cross-portal-bus.ts` (the Redis pub/sub of record)
- `services/api-gateway/src/composition/wake-loop-cron.ts` (the advisory-lock pattern to mirror)
- `services/api-gateway/src/middleware/rate-limit-redis.middleware.ts` (the degrade/Sentry pattern to mirror)
- `packages/database/src/run-migrations.ts` (the `prepare:false` precedent)
