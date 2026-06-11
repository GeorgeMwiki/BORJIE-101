# Scale Posture Audit — Borjie & BossNyumba

**Date:** 2026-06-08
**Scope:** Current scale posture of both repos. Every cap, bottleneck, and
single-point-of-failure where the system breaks under load.
**Method:** Evidence-based static inspection of k8s/helm manifests, the DB
connection strategy, in-memory stores, schedulers, outbox processing, SSE/rate
limiting, and ingress. Every finding cites `file:line` or a config path.

**Repos**
- Borjie: `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Borjie`
- BossNyumba (BN, parent fork): `/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101`

> **Lineage note.** BN is the parent project; Borjie was hard-forked from it.
> The k8s/infra layout is near-identical. Where they diverge, the divergence is
> called out explicitly — each repo regressed in *different* places, so neither
> is strictly safer than the other.

---

## TL;DR severity ledger

| # | Severity | Area | Breaks at | Repo |
|---|----------|------|-----------|------|
| S1 | **BLOCKER** | DB pooler vs reserved-connection pinning | Any concurrent multi-tenant load on Supabase tx-pooler `:6543` | Borjie |
| S2 | **BLOCKER** | Per-request transaction holds connection across LLM calls | ~10 concurrent long requests / replica | BN |
| S3 | **HIGH** | In-process cockpit SSE bus (EventEmitter) | >1 api-gateway replica | Both |
| S4 | **HIGH** | Unguarded `setInterval` crons on every replica (no cluster-lock) | >1 replica; 50× LLM cost + external API fan-out | Borjie |
| S5 | **HIGH** | Connection-count blow-up: N pools/process × 20 × replicas | ~5–8 replicas vs default PG `max_connections=100` | Both |
| S6 | **HIGH** | Postgres StatefulSet `replicas: 1` (base overlay) | Any node loss / AZ failure | Both |
| S7 | **HIGH** | Redis single Deployment replica (SPOF) | Redis pod restart → rate-limit + cache outage | Both |
| S8 | **HIGH** | Per-route in-memory rate limiters (`perUserRateLimit`/`customRateLimit`) | >1 replica → cap × replicas | Both |
| S9 | **MED** | `prepare: true` (default) on Supabase transaction pooler | Sustained load on `:6543` | Borjie |
| S10 | **MED** | nginx ingress buffers SSE; 60s read timeout | Long LLM streams / any SSE | Both |
| S11 | **MED** | fx-feed cron: no `ON CONFLICT`, no leader lock | >1 replica → dup rows + N× external API hits | Borjie |
| S12 | **MED** | In-memory onboarding store fallback | Multi-replica + DB-less request window | Both |
| S13 | **MED** | KEDA scale-to-zero cold start (3 portals) | First request after idle window | Both |
| S14 | **LOW** | HPA `maxReplicas` ceilings (helm 50 vs base 20 mismatch) | Traffic above the lower ceiling | Both |
| S15 | **LOW** | No read-path HTTP/response caching layer | Read-heavy dashboards hammer primary DB | Both |

---

## S1 — BLOCKER — DB reserved-connection RLS pinning is incompatible with the Supabase transaction pooler (Borjie)

**Evidence**
- `packages/database/src/client.ts:222` — `withReservedConnection()` calls
  `db.$client.reserve()` and holds ONE backend connection for the whole request,
  binding `app.current_tenant_id` on it (`services/api-gateway/src/middleware/database.ts:360`).
- `packages/database/src/client.ts:184-216` — `begin`/`savepoint` are emulated as
  raw `BEGIN`/`COMMIT`/`SAVEPOINT` statements on the reserved connection.
- Production `DATABASE_URL` targets the **transaction pooler**:
  `.env.example:75` → `...pooler.supabase.com:6543/postgres`.

**Why it breaks.** `reserve()` is a *session-level* primitive — it assumes the
client can hold the same backend connection across multiple round-trips. The
Supabase pooler on port **6543 is transaction mode**: it returns the backend to
the pool at every transaction boundary and does NOT guarantee statement-to-
statement affinity. So either (a) `reserve()` silently maps to a pooler-side
connection that is recycled between statements — re-introducing the exact cross-
tenant RLS GUC leak the pinning was written to prevent — or (b) operators must
switch to the **session** pooler (`:5432`), which is the un-pooled direct
connection and is severely connection-limited (Supabase session mode is capped
far below the transaction pooler). There is no configuration that gives BOTH
working RLS pinning AND high connection concurrency on Supabase as wired today.

**Breaks at.** Any concurrent multi-tenant traffic in production while pointed at
`:6543`. The failure is silent (wrong-tenant rows, not an error) which makes it a
security + correctness blocker, not just a perf cap.

**Fix.** Pick one coherent model:
1. **Session-mode + bounded pool:** point `DATABASE_URL` at the session pooler,
   keep `reserve()` pinning, and cap `DATABASE_POOL_MAX` so `pools × max ×
   replicas` stays under the session-mode ceiling (see S5). Accept fewer
   replicas, or
2. **Transaction-mode + tx-scoped GUC:** drop `reserve()`, bind the tenant GUC
   with `SET LOCAL` inside a short transaction per DB operation (the
   `withTenantContext` path already does this — `packages/database/src/rls/with-tenant-context.ts:69`),
   and never hold a connection across an external call. This is pooler-safe and
   is the model BN's `withTenantContext` uses (but see S2 for BN's misuse of it).
   Requires `prepare: false` (S9).

---

## S2 — BLOCKER — BN holds a DB transaction (and its connection) across the ENTIRE request, including LLM calls (BossNyumba)

**Evidence**
- `services/api-gateway/src/middleware/database.ts:374` `runInTenantTx(...)`
  wraps the request in `withTenantContext(database, tenantId, async (tx) => { ...
  await next(); })` — the handler runs at **line 411, inside the transaction**.
- There is **no streaming-exclusion variant**: a repo-wide search for
  `databaseMiddlewareNoPin` in BN returns nothing. Every route (including LLM
  chat/streaming) takes the tx path.
- BN pool size is the postgres-js **default of 10**: `packages/database/src/client.ts:51`
  → `postgres(connectionString)` with **no `max:` option**.

**Why it breaks.** A request that calls an LLM (5–20 s), payment provider, or
calendar OAuth holds its single pooled connection open for that entire duration
because the connection is bound to the open transaction. With `max: 10` per
process, the pool is exhausted at **~10 concurrent long requests per replica**;
the 11th request blocks on `connect_timeout` (also unset → postgres-js default)
and then errors. Borjie's own code comments document exactly this hazard
(`packages/database/src/client.ts:137-139`: "a request-wide transaction would
hold the connection across those round-trips and exhaust the pool").

**Breaks at.** ~10 concurrent in-flight LLM/long requests per gateway replica.
For an AI-native product where most requests hit the brain, this is the dominant
ceiling.

**Fix.** Adopt Borjie's split: a `databaseMiddlewareNoPin` for streaming/long-
external-call routers that binds tenant context per DB op via `withTenantContext`
and keeps the external call OUTSIDE any transaction. Set an explicit `max:` and
`connect_timeout` on BN's pool (`packages/database/src/client.ts:51`).

---

## S3 — HIGH — Cockpit SSE event bus is an in-process EventEmitter; cross-replica delivery is impossible (Both)

**Evidence**
- `services/api-gateway/src/services/cockpit-events/bus.ts:36` —
  `const emitter = new EventEmitter();` (module-level singleton).
- `bus.ts:52` `publishCockpitEvent` → `emitter.emit(...)`; `bus.ts:65`
  `subscribeCockpitEvents` → `emitter.on(...)`.
- Consumed by the SSE route: `services/api-gateway/src/routes/cockpit-stream.hono.ts:96`
  `subscribeCockpitEvents(tenantId, ...)`.
- The file's own header admits it: `bus.ts:5-12` — "Borjie api-gateway runs
  single-node in MVP; horizontal scale comes later... the only seam to swap for a
  PG-LISTEN / Redis-pubsub fan-out."
- Identical in BN: `BOSSNYUMBA101/services/api-gateway/src/services/cockpit-events/bus.ts:31` (`EventEmitter`).

**Why it breaks.** The api-gateway HPA scales **3→50 replicas** (Borjie helm
`k8s/helm/borjie/values.yaml:141`; base HPA `infra/k8s/base/api-gateway-hpa.yaml:11-12`
caps at 20). A mutation handled by replica A calls `publishCockpitEvent`, but the
owner's SSE stream is held open on replica B. The event is emitted to A's
in-process emitter and **never reaches B's subscriber**. Roughly `(replicas-1)/
replicas` of all real-time events are silently dropped — at 10 replicas that is
90% of cockpit events lost.

**Breaks at.** The instant api-gateway runs more than 1 replica (i.e. always, in
prod — `minReplicas: 3`).

**Fix.** Replace the EventEmitter seam with Postgres `LISTEN/NOTIFY` or Redis
pub/sub fan-out (the header already names this as the intended swap). Keep the
`publish`/`subscribe` signatures identical. Redis must be HA first (S7).

---

## S4 — HIGH — 27 `setInterval` crons/workers start in-process on EVERY api-gateway replica with NO leader election (Borjie)

**Evidence**
- `services/api-gateway/src/index.ts` contains **27 `.start()` cron/worker
  invocations** (grep count), e.g. `index.ts:3261` learningAmplificationCron,
  `:3286` executiveBriefCron, `:3291` dailyBriefCron, `:3300` complianceDeadlineScan,
  `:3304` entityIndexerWorker, `:3307` fxFeedCron, `:3334` mwikilaAutonomousWorker,
  `:3335` proactiveScheduler.
- **No `cluster-lock` helper exists in Borjie**: `find services/api-gateway/src
  -name 'cluster-lock*'` → empty; grep for `withClusterLock`/`pg_advisory` across
  the gateway returns only `wake-loop-cron.ts` and `durable/*`.
- The mwikila autonomous worker — which walks **every active tenant** and runs
  **5 LLM-backed handlers per tenant** every 15 min — has no lock:
  `services/api-gateway/src/composition/mwikila-autonomous-wiring.ts` (grep for
  `advisory|lock|leader|cluster` → no guard), tenant fan-out at
  `mwikila-autonomous-wiring.ts:142 listActiveTenantsWithOwner`,
  documented at `index.ts:3329-3334` "walks every active tenant, runs all 5
  handlers".
- **Contrast — BN HAS the guard:** `BOSSNYUMBA101/services/api-gateway/src/composition/cluster-lock.ts`
  implements `pg_try_advisory_lock` (`cluster-lock.ts:136`) / `withClusterLock`
  (`:175`), used by ~10 workers incl. `mwikila-autonomous-worker.ts`,
  `executive-brief-cron.ts`, `outcome-reconciliation-worker.ts`,
  `cases-sla-supervisor.ts`. Borjie lost this in the fork.

**Why it breaks.** Row-level guards (`FOR UPDATE SKIP LOCKED`, UNIQUE idempotency
keys) prevent *duplicate side-effects* for the workers that have them, but every
replica still:
1. Wakes on its own timer and runs the scan query → **N× DB poll load** (e.g.
   reminders poll every 30s × 50 replicas = a scan every 0.6s).
2. For the mwikila autonomous worker (no row-guard on the LLM call itself), runs
   the full per-tenant 5-handler LLM sweep → **50× LLM cost + 50× tenant
   fan-out** at max scale, directly burning the `LLM_DAILY_COST_CAP_USD`
   (`k8s/helm/borjie/values.yaml:379`).

**Breaks at.** >1 replica. Cost and DB-poll pressure scale linearly with replica
count up to maxReplicas (20–50).

**Fix.** Port BN's `cluster-lock.ts` into Borjie and wrap each cron tick in
`withClusterLock(<stable-lock-id>)`, OR move the crons out of the gateway into
the existing k8s CronJobs (`k8s/wake-loop-cron.yaml`,
`k8s/consolidation-worker-cron.yaml`) / a single-replica worker Deployment.

---

## S5 — HIGH — Connection-count blow-up: multiple pools per process × `max:20` × replicas overruns Postgres `max_connections` (Both)

**Evidence**
- `packages/database/src/client.ts:75` — `max: parsePositiveInt(DATABASE_POOL_MAX, 20)`
  (Borjie default 20; BN default 10 via no-option `postgres()`).
- **Multiple independent pools per process.** Despite `db-client.ts:13` claiming
  "we never open two connection pools in the same process," there are ≥5 distinct
  `createDatabaseClient(...)` call sites, each opening its own postgres-js pool:
  - `services/api-gateway/src/middleware/database.ts:93`
  - `services/api-gateway/src/composition/db-client.ts:51`
  - `services/api-gateway/src/routes/brain.hono.ts:97`
  - `services/api-gateway/src/routes/brain-voice.hono.ts:294`
  - `services/api-gateway/src/routes/ai-chat.router.ts:74`
  plus the read-replica pool (`db-client.ts:92`) and the migration/seed pools.
- Self-hosted Postgres ships with **no `max_connections` tuning**: grep of
  `infra/k8s/base/postgres-statefulset.yaml` and helm values finds none →
  Postgres default **100**.

**Why it breaks.** Worst-case per-process connection demand ≈ `pools × max`. With
5 pools × 20 = **100 connections per single replica**. Borjie HPA scales api-
gateway to 20–50 replicas → demand of **2,000–5,000 connections** against a
backend whose default ceiling is 100. The Supabase transaction pooler raises the
*client-facing* ceiling, but each pooler-side server connection still counts; and
on the in-cluster StatefulSet (S6) there is no pooler at all. Connections are
refused (`FATAL: too many connections`) far below target replica count.

**Breaks at.** ~5–8 replicas against an untuned in-cluster Postgres; sooner if
all 5 pools warm up. Even one replica can exhaust a 100-connection backend under
brain + chat + voice load.

**Fix.** (1) Consolidate to a single shared pool per process (honour the
db-client.ts contract — route brain/voice/chat through `getDb()`). (2) Put
PgBouncer (transaction mode) in front of the in-cluster Postgres. (3) Size
`DATABASE_POOL_MAX` from a budget: `pool_max ≤ backend_max / (replicas × pools)`.
Document in `Docs/AUDIT/SCALE_RUNBOOK.md` (referenced at `client.ts:59`).

---

## S6 — HIGH — Postgres StatefulSet is `replicas: 1` with an RWO volume in the base overlay — single point of failure (Both)

**Evidence**
- `infra/k8s/base/postgres-statefulset.yaml:31` → `replicas: 1`.
- `infra/k8s/base/postgres-statefulset.yaml:78` → `accessModes: ["ReadWriteOnce"]`
  (single-node attach; cannot fail over to another node).
- The helm chart *claims* HA (`k8s/helm/borjie/values.yaml:212` `replicas: 3`,
  `:228` `antiAffinity: required`, `:231` `pdb.minAvailable: 2`) and a full
  Sentinel/Patroni-style HA bundle exists at `k8s/ha/postgres-statefulset.yaml`,
  but the **actual kustomize base that gets deployed** ships the single replica.
- Identical in BN: `BOSSNYUMBA101/infra/k8s/base/postgres-statefulset.yaml:31`
  `replicas: 1`.

**Why it breaks.** A single Postgres pod with an RWO PVC: node drain, AZ outage,
or pod crash takes the entire OLTP store offline with no standby. The
`readOnlyRootFilesystem: false` (line 61) and lack of WAL-archiving config also
mean no point-in-time recovery from the manifest alone.

**Breaks at.** Any single node/AZ failure or pod restart → full write outage.

**Fix.** Either deploy the managed offering the file header recommends (RDS /
Cloud SQL / Supabase with a standby — `postgres-statefulset.yaml:4-9`), or switch
the overlay to the `k8s/ha/` bundle with streaming replication + automated
failover. Wire `DATABASE_URL_READONLY` (`db-client.ts:83`) to the replica so
reads offload (currently unused → falls back to primary, `db-client.ts:86`).

---

## S7 — HIGH — Redis is a single Deployment replica — SPOF for rate-limiting and cache (Both)

**Evidence**
- `infra/k8s/base/redis-deployment.yaml:17` → `replicas: 1` (a `Deployment`, not
  even a StatefulSet — restart loses all in-memory state).
- Same in BN: `BOSSNYUMBA101/infra/k8s/base/redis-deployment.yaml:17` `replicas: 1`.
- The HA Sentinel cluster exists (`k8s/ha/redis-sentinel-statefulset.yaml`) but
  is not in the base overlay.

**Why it breaks.** Redis is the cluster-wide rate-limit backend
(`services/api-gateway/src/index.ts:959-996`) and (per S3's fix) would be the SSE
fan-out bus. A Redis restart drops every rate-limit counter (burst of unthrottled
traffic) and, in degraded mode, the limiter silently falls back to per-replica
in-memory (`rate-limit-redis.middleware.ts:27-32`) — re-opening the S8 hole.

**Breaks at.** Any Redis pod restart / node loss.

**Fix.** Deploy the `k8s/ha/redis-sentinel-statefulset.yaml` bundle (or managed
Upstash/ElastiCache — the chart already supports `redis.external.enabled`,
`values.yaml:237`). Enable persistence (`values.yaml:247` is `false`).

---

## S8 — HIGH — Per-route rate limiters use a process-local Map; the cap multiplies by replica count (Both)

**Evidence**
- `services/api-gateway/src/middleware/rate-limiter.ts:103-107` — "In-Memory
  Store (Replace with Redis in production)", `class RateLimitStore { private
  store = new Map(); }`.
- Module-level singletons: `rate-limiter.ts:144` `new RateLimitStore()`,
  `:245` `new TokenBucketRateLimiter()`.
- Still wired on real routes via `perUserRateLimit`/`customRateLimit`:
  - `services/api-gateway/src/routes/memory-declare.router.ts:66`
    `perUserRateLimit({ windowMs: 60_000, max: 30 })`
  - `services/api-gateway/src/routes/parity-capability-dashboard.router.ts:238`
    `customRateLimit({...})`
  - (BN has 7 such usages; Borjie 6.)
- Only the **global** Express limiter is Redis-backed (`index.ts:945-1005`); the
  per-route Hono limiters are NOT.

**Why it breaks.** Each replica keeps its own counter Map. The effective cap is
`max × replicas` — a 30/min per-user limit becomes 600/min at 20 replicas. The
Redis middleware's own header (`rate-limit-redis.middleware.ts:6-10`) flags this
exact class of bug as HIGH. Abuse prevention and per-tenant SLA fairness are both
defeated on these routes.

**Breaks at.** >1 replica.

**Fix.** Route `perUserRateLimit`/`customRateLimit` through the same Redis
fixed-window limiter used globally, or a Redis token-bucket. Delete the
in-memory store once migrated.

---

## S9 — MED — `prepare: true` (postgres-js default) against the Supabase transaction pooler (Borjie)

**Evidence**
- `packages/database/src/client.ts:73-101 readPoolOptions()` sets `max`,
  timeouts, and session GUCs but **never sets `prepare: false`** → postgres-js
  defaults to named prepared statements.
- Production URL is the transaction pooler: `.env.example:75` `:6543`.
- The migration runner *does* disable it (`run-migrations.ts:285 prepare: false`)
  and the corpus CLI does (`borjie-corpus-cli-direct.ts:60`), so the awareness
  exists — it just isn't applied to the request-path pool.

**Why it breaks.** Transaction-mode poolers do not keep a stable backend session,
so named prepared statements created on one transaction are gone on the next →
`prepared statement "s1" does not exist` errors, or postgres-js thrashing on
re-prepare. Surfaces under sustained throughput, not at low volume.

**Breaks at.** Sustained concurrent load on `:6543`.

**Fix.** Set `prepare: false` in `readPoolOptions()` (and the readonly variant)
when the URL is a transaction pooler. Tie this to the S1 decision.

---

## S10 — MED — nginx ingress buffers SSE responses and caps read at 60s (Both)

**Evidence**
- `infra/k8s/base/ingress.yaml:19` → `proxy-read-timeout: "60"` only. **No**
  `nginx.ingress.kubernetes.io/proxy-buffering: "off"`,
  `proxy-request-buffering: "off"`, or `X-Accel-Buffering` annotation.
- SSE routes rely on byte-at-a-time flush: `cockpit-stream.hono.ts:62 streamSSE`,
  `mcp-public.hono.ts` SSE queue (`:248`), `cross-portal-subscribe.router.ts`,
  `mining/chat-orchestrator.ts:240`.
- The helm ingress template sets `proxyReadTimeout: 180` (`values.yaml:297`) but
  the deployed base overlay uses 60.

**Why it breaks.** nginx default `proxy_buffering on` accumulates the SSE body
before forwarding, so clients receive events in bursts (or only on disconnect) —
defeating real-time streaming. A 60s read timeout severs any LLM stream or idle
SSE that exceeds it (cockpit heartbeat is 25s so it survives, but long brain
streams do not).

**Breaks at.** Every SSE connection (buffering); any stream/idle >60s (timeout).

**Fix.** Add `nginx.ingress.kubernetes.io/proxy-buffering: "off"` and raise
`proxy-read-timeout` to ≥180 on the SSE/stream ingress paths (split the ingress
or annotate per-path).

---

## S11 — MED — fx-feed cron hits external APIs and inserts with no `ON CONFLICT` and no leader lock (Borjie)

**Evidence**
- `services/api-gateway/src/workers/fx-feed-cron.ts:99-100` fetches
  `bot.go.tz/api/exchangerates/today` and `prices.lbma.org.uk/api/v1/gold` every
  5 min (`fx-feed-cron.ts:33`).
- Writes: `fx-feed-cron.ts:221 INSERT INTO fx_rates` and `:251 INSERT INTO
  external_benchmarks` — **neither has `ON CONFLICT`** (grep confirms none).
- No advisory/leader guard (it is one of the unguarded 27 from S4).

**Why it breaks.** On N replicas, the BoT and LBMA endpoints get **N× the
requests every 5 min** (rate-limit / IP-ban risk on a third-party gov endpoint),
and each insert with no conflict handling writes **N duplicate rows** per tick,
polluting `fx_rates`/`external_benchmarks` used by the money path.

**Breaks at.** >1 replica.

**Fix.** Gate with `withClusterLock` (S4 fix) and add `ON CONFLICT (ts, pair) DO
UPDATE`/`DO NOTHING` for idempotent ticks.

---

## S12 — MED — In-memory onboarding store is used whenever a request reaches the router without a DB handle (Both)

**Evidence**
- `services/api-gateway/src/routes/onboarding.router.ts:70` — module-level
  `sharedInMemoryStore = createInMemoryOnboardingStore()`.
- `onboarding.router.ts:161-167 resolveStore()` returns the Drizzle store **only
  if `c.get('db') != null`**, else the in-memory singleton.
- The store holds credentials + verification tokens in process Maps:
  `onboarding-store.ts:150-159` (`emailToTenantId`, `tenantIdToCredential`,
  `sessions`, `sessionsByToken`, `pendingVerifications`).

**Why it breaks.** Onboarding spans multiple requests (create → email-verify →
complete). On >1 replica, a verification request that lands on a replica whose
`db` wasn't set (degraded/mock window, or a route mounted without the DB
middleware) reads a *different* in-process Map than the one that stored the
token → "token not found" / duplicate-email false negatives. State is also lost
on any pod restart/rollout.

**Breaks at.** Multi-replica onboarding, or any rollout mid-onboarding.

**Fix.** Make the Drizzle store the only production path; treat a missing `db` as
a hard 503 in onboarding rather than falling back to the in-memory singleton.

---

## S13 — MED — KEDA scale-to-zero on 3 portals → cold-start latency on first request after idle (Both)

**Evidence**
- `k8s/keda/scaledobject-owner-portal.yaml:20 minReplicaCount: 0`,
  `:19 cooldownPeriod: 900` (15 min). Same pattern for estate-manager
  (`maxReplicaCount: 20`, cooldown 600) and admin (cooldown 1800).
- Only customer-app stays warm (`scaledobject-customer-app.yaml:21
  minReplicaCount: 2`).

**Why it breaks.** After the idle window the portal scales to 0; the next user
eats a full cold start (image pull if not cached + Next.js boot + first DB pool
warm-up). For owner/admin personas this is a multi-second first-byte penalty.

**Breaks at.** First request after each idle/cooldown window.

**Fix.** Acceptable for admin; for the owner portal consider `minReplicaCount: 1`
or a KEDA `idleReplicaCount: 1` warm-pool, or a synthetic keep-warm probe.

---

## S14 — LOW — HPA ceiling mismatch between helm (50) and the deployed base overlay (20) (Both)

**Evidence**
- Helm: `k8s/helm/borjie/values.yaml:141 maxReplicas: 50` (apiGateway).
- Deployed base: `infra/k8s/base/api-gateway-hpa.yaml:12 maxReplicas: 20`.

**Why it matters.** The capacity you *think* you have (50) is not what ships (20).
Above ~20 replicas of demand the gateway can't scale further and queues/sheds.
(Also: which value ships changes the S5 connection math — 20 vs 50 replicas.)

**Fix.** Reconcile the two; make the kustomize base the source of truth or render
from helm. Size against the S5 connection budget either way.

---

## S15 — LOW — No read-path response/HTTP caching; dashboards hit the primary DB directly (Both)

**Evidence**
- Only ~16 `Cache-Control`/cache references across all gateway routes (grep), and
  no shared Redis read-through cache for hot read endpoints (corpus chunks,
  dashboards, currency rates). `currency-rates.hono.ts` builds queries per request
  with no cache layer.
- `getDbReadonly()` exists (`db-client.ts:73`) but defaults to the primary pool
  when `DATABASE_URL_READONLY` is unset (`db-client.ts:86`) — which it is in the
  examples.

**Why it matters.** Read-heavy owner/admin dashboards and the marketplace put
full read load on the single primary (S6), amplifying the connection pressure of
S5.

**Fix.** Add a short-TTL Redis read-through cache for hot, tenant-scoped read
endpoints; wire `DATABASE_URL_READONLY` to a replica so reads offload.

---

## What's actually solid (so the fixes stay targeted)

- **Outbox / event processing is concurrency-safe.** Both the payouts drainer
  (`services/api-gateway/src/services/payouts/payouts-worker.ts:196-201` —
  `FROM event_outbox ... LIMIT n FOR UPDATE SKIP LOCKED`) and the notification
  dispatcher (`dispatcher-worker.ts:218-219` same pattern) claim rows safely
  across replicas. The *trigger cadence* is the problem (S4), not the claim.
- **Borjie closed the RLS cross-connection leak** that BN still has at the code
  level — `withReservedConnection` (`client.ts:222`) + per-request pinning
  (`database.ts:360`) is the right idea; it's only undermined by the pooler
  mismatch (S1).
- **Borjie split streaming routes onto `databaseMiddlewareNoPin`**
  (`mcp-public.hono.ts:192`, `mining/chat.hono.ts:37`, `owner/docs.hono.ts:162`)
  so LLM streams don't hold a reserved connection — the exact thing BN is missing
  (S2).
- **BN has `cluster-lock.ts`** (`pg_try_advisory_lock`, `cluster-lock.ts:136`)
  gating ~10 of its crons — the exact thing Borjie is missing (S4).
- HPA behavior tuning is sane (`api-gateway-hpa.yaml:22-32` — fast scale-up,
  slow scale-down), PDBs and anti-affinity are configured, and pod security is
  hardened (read-only rootfs, non-root, dropped caps).

## Cross-repo summary

The two repos **regressed in opposite directions** from the same baseline:

| Concern | Borjie | BN |
|---|---|---|
| RLS cross-connection leak | **Fixed** (reserve pinning) but breaks the tx-pooler (S1) | **Present** (no pinning, S2 path masks it via full-request tx) |
| Connection held across LLM call | Avoided via `NoPin` (good) | **Holds it** for whole request (S2 BLOCKER) |
| Cron leader-election | **Missing** (S4 HIGH) | **Has `cluster-lock`** |
| Pool defaults | `max:20` + timeouts | **No options** (`max:10`, no timeouts) |

Shared (both): in-process SSE bus (S3), single Postgres (S6), single Redis (S7),
per-route in-memory limiters (S8), N-pools-per-process (S5), no SSE-safe ingress
(S10).

**Recommended order:** S2 + S1 (DB connection model — pick one coherent pooler
strategy), then S6/S7 (HA the data tier), then S5 (pool budget + PgBouncer),
then S3 + S8 (move real-time + rate-limit off process memory to HA Redis), then
S4 (re-introduce cluster-lock in Borjie).
