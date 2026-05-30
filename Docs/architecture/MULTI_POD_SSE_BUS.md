# Multi-Pod SSE Bus

**Status:** Design accepted, implementation pending
**Author:** architect agent (#L)
**Date:** 2026-05-31
**Closes:** in-process EventEmitter single-node ceiling in
`services/api-gateway/src/services/cockpit-events/bus.ts`

## 1. Problem statement

The cockpit SSE bus is an in-process `node:events` EventEmitter (see
`services/api-gateway/src/services/cockpit-events/bus.ts:36`). It works
because today api-gateway runs as a single pod. The moment a second
pod is added (rolling deploy, HPA-driven scale-out, regional
multi-AZ), a `publishCockpitEvent` call inside pod-1 is invisible to
the SSE subscriber attached to pod-2 — that subscriber simply never
sees the event. With 2 pods, ~50% of publishes are silently dropped
for any given subscriber. There is also no replay buffer, so a client
that loses its socket during a 5-second cellular blip misses every
event in that window. This blocks horizontal scaling and breaches the
RT-1 200 ms cross-actor SLO under any non-trivial load.

## 2. Constraints

- **RLS / tenant isolation.** No event may leak across `tenantId`
  boundaries. The current bus enforces this via channel naming
  (`cockpit:${tenantId}`); the replacement must preserve that
  guarantee structurally, not by review.
- **No new managed service.** Supabase Postgres (`postgres` driver) is
  already in use. `ioredis` is already declared in
  `services/api-gateway/package.json`. A REDIS_URL env var is already
  wired through `validate-env.ts` and the existing `cross-portal-bus.ts`
  composition. Anything beyond these two is a new dep.
- **Drop-in compatibility.** The 49 Borjie publisher call sites (30
  files) and 28 BN publisher call sites (11 files) must remain
  unchanged. The exported surface from
  `services/api-gateway/src/services/cockpit-events/index.ts`
  (`publishCockpitEvent`, `subscribeCockpitEvents`,
  `__resetCockpitBusForTests`, plus the type exports) is the API
  contract.
- **Single-region first.** Multi-region replication is out of scope for
  v1. We optimise for one region, multiple pods.
- **CLAUDE.md hard rules carried over.** No reflective CORS, no
  `console.log` in services (pino only), no reading `process.env`
  outside bootstrap, RLS GUC bound by middleware untouched.
- **Replay window K seconds.** Default 60 s. Configurable via
  `COCKPIT_EVENT_REPLAY_SECONDS`. Replay must respect tenant scope.
- **pnpm monorepo Docker deploys.** No native bindings that require
  custom Dockerfile changes.

## 3. Two candidate designs

### Design A — PG LISTEN/NOTIFY + per-pod replay cache

**Backend:** PostgreSQL channel per tenant (`cockpit_${tenant_hash}`)
via `LISTEN`/`NOTIFY`. The `postgres` (postgres-js) driver already in
`services/api-gateway/package.json:134` supports `sql.listen(channel,
handler)` natively. One dedicated long-lived connection per pod runs
`LISTEN` for every tenant the pod has at least one subscriber for.
Publishes go through `SELECT pg_notify(channel, payload::text)`.

**Replay buffer:** A new append-only table
`cockpit_event_replay(tenant_id uuid, kind text, payload jsonb,
emitted_at timestamptz default now(), id bigserial primary key)` with
RLS-FORCE, plus a partial index on `(tenant_id, emitted_at desc)`. A
cron job (extend existing
`services/api-gateway/src/workers/`) prunes rows older than
`COCKPIT_EVENT_REPLAY_SECONDS * 2`. On client (re)connect, the SSE
handler reads `Last-Event-ID` header and replays everything strictly
newer for that tenant. New events use `Last-Event-ID = id` from the
table.

**Per-pod cache:** Subscribers register against an in-process
`EventEmitter` per tenant exactly as today — the LISTEN handler is the
sole publisher into it. This preserves the cheap O(subscribers) fan-out
inside each pod and means the existing SSE route handler does not
change.

**Tenant isolation:** The channel name is a deterministic
`'cockpit_' + sha1(tenantId).slice(0,16)` to stay inside Postgres'
63-byte NAMEDATALEN limit. Publish takes the raw `tenantId`, hashes
it, calls `pg_notify`. The receive path validates the payload's
`tenantId` matches the expected channel before fan-out — defence in
depth in case of a hash collision (probability < 2^-32 across the
realistic tenant cardinality).

**Failure modes:** PG LISTEN payload limit is 8000 bytes. We already
respect this (cockpit events are <2 KB; the tab-spawn config validator
caps at 4 KB). The LISTEN connection is supervised by a watcher that
re-`LISTEN`s on socket error.

### Design B — Redis pubsub + Redis Streams replay

**Backend:** ioredis pub/sub channel per tenant
(`borjie:cockpit:${tenantId}:event`), modelled exactly on the existing
`services/api-gateway/src/composition/cross-portal-bus.ts` Redis bus.
Two long-lived ioredis connections per pod (one publisher, one
subscriber, per ioredis convention).

**Replay buffer:** Redis Streams (`XADD` on publish, `XRANGE` on
reconnect with `Last-Event-ID`). Stream is capped via `XADD MAXLEN
~5000` per tenant key. A second key per tenant
(`borjie:cockpit:${tenantId}:replay`) holds the trimmed stream.

**Per-pod cache:** Same in-process EventEmitter as today, fed by the
Redis subscribe handler.

**Tenant isolation:** Identical to A — channel name carries the
tenant, validated on receive.

## 4. Recommendation — Design A (PG LISTEN/NOTIFY)

Adopt **Design A** in v1. Move to B only when the data tells us to.

Reasons:

1. **Volume budget.** `Docs/OPS/REALTIME_NETWORK.md` measures
   3.2 events/sec globally at 100 tenants, projecting to ~32 ev/sec at
   1 000 tenants. Postgres LISTEN/NOTIFY comfortably handles 10 000+
   events/sec on a single primary — we have three orders of magnitude
   of headroom before we hit the well-documented `AccessExclusiveLock`
   contention on `pg_notify` at very high publish rates.
2. **No new operational surface.** Borjie already runs Supabase
   Postgres with RLS-FORCE on every tenant table. Adding one more
   table (`cockpit_event_replay`) with the same RLS template is
   zero-marginal-cost ops. Redis Streams add a new persistent failure
   domain we must monitor, back up, and tune `maxmemory-policy` on.
3. **Replay buffer is intrinsically transactional.** When the publisher
   does `INSERT INTO cockpit_event_replay ... ; SELECT pg_notify(...)`
   inside the same transaction as the business mutation (the rule
   stated in `REALTIME_NETWORK.md` — "publish runs AFTER DB commit"),
   we get a single atomic write. With Redis the replay buffer and the
   pub-sub fan-out are independent failure modes — we can lose one or
   the other.
4. **RLS already enforced on PG side.** The replay table inherits the
   same `app.current_tenant_id` GUC pattern. Redis enforcement is
   namespace-only and relies on code discipline.
5. **Existing ioredis bus is for cross-portal traffic, different
   semantics.** `cross-portal-bus.ts` is for HQ-to-tenant announcements
   (low volume, mixed criticality). The cockpit bus is per-tenant
   firehose; the access patterns differ enough that sharing the Redis
   instance is not the obvious win it appears.
6. **Reversibility.** The factory pattern (below) makes B a 1-week swap
   if PG hits a wall. We are not boxing ourselves in.

Design B becomes the recommendation if any of these hit:
- Sustained publish > 5 000 events/sec/region
- PG primary CPU > 60% during publish bursts
- LISTEN connection counts exceed 70% of `max_connections`

## 5. Migration plan (3-step roll-out)

### Step 1 — Add the seam (no behaviour change)

Refactor `services/api-gateway/src/services/cockpit-events/bus.ts` to
delegate to a `CockpitBusBackend` interface initialised once at
bootstrap. Default backend is the existing in-process EventEmitter
(`InProcessCockpitBus`). All 49 + 28 call sites are unaffected —
they continue to call `publishCockpitEvent(event)`. Ship and bake for
72 h. This is a pure refactor with the same test suite.

### Step 2 — Dual-publish behind a flag

Add `MultiPodCockpitBus` implementing the same interface using PG
LISTEN/NOTIFY + replay table. Add env flags:

- `COCKPIT_BUS_BACKEND=in_process|multi_pod|dual` (default `in_process`)
- `COCKPIT_EVENT_REPLAY_SECONDS=60`

When `dual`, every publish goes to BOTH the in-process emitter AND the
LISTEN/NOTIFY backend. Subscribers receive each event twice — the SSE
route handler deduplicates by `event.emittedAt + event.kind +
event.tenantId + secondary key` inside a 1000-entry LRU per
connection. Run `dual` in staging with 2 pods, measure latency parity
(should be PG-LISTEN < 30 ms additional vs in-process), measure
delivery to the second pod.

### Step 3 — Cut over and remove the dual path

Flip `COCKPIT_BUS_BACKEND=multi_pod` in production. After 7 days of
green, remove the in-process backend code path and the dedup LRU.
Keep the `CockpitBusBackend` interface — it remains the seam for
future Redis swap.

## 6. Code-level changes required (file paths + signatures)

No publisher call site changes. The 49 Borjie + 28 BN sites stay byte-
identical.

### New files

- `services/api-gateway/src/services/cockpit-events/backend.ts`
  - `export interface CockpitBusBackend { publish(event: CockpitEvent): Promise<number>; subscribe(tenantId: string, handler: (event: CockpitEvent) => void): () => void; replay(tenantId: string, afterId: string | null): Promise<CockpitEvent[]>; close(): Promise<void>; }`
- `services/api-gateway/src/services/cockpit-events/backends/in-process.ts`
  - `export function createInProcessCockpitBus(): CockpitBusBackend`
  - Wraps today's EventEmitter; `replay()` returns `[]`.
- `services/api-gateway/src/services/cockpit-events/backends/multi-pod-pg.ts`
  - `export function createMultiPodPgCockpitBus(deps: { sql: postgres.Sql; logger: Logger; replaySeconds: number }): CockpitBusBackend`
  - One `sql.listen()` per tenant on first subscribe; publishes via `sql\`INSERT INTO cockpit_event_replay ... RETURNING id\`` then `sql\`SELECT pg_notify(${channel}, ${payload})\``.
- `services/api-gateway/src/services/cockpit-events/backends/dual.ts`
  - `export function createDualCockpitBus(primary: CockpitBusBackend, secondary: CockpitBusBackend): CockpitBusBackend`
  - Publishes to both; subscribers receive from both (dedup is the consumer's job).

### Modified files

- `services/api-gateway/src/services/cockpit-events/bus.ts`
  - Replace module-level emitter with a module-level `backend: CockpitBusBackend` bound once by `setCockpitBusBackend(backend)`.
  - `publishCockpitEvent(event)` becomes a thin delegate. Signature unchanged at the call-site (still synchronous from the caller's POV — the backend returns a promise the caller ignores, matching today's fire-and-forget contract).
  - `subscribeCockpitEvents(tenantId, handler)` delegates.
  - `__resetCockpitBusForTests()` resets the in-process backend.
- `services/api-gateway/src/composition/service-registry.ts`
  - In bootstrap, read `COCKPIT_BUS_BACKEND`, instantiate the chosen backend, call `setCockpitBusBackend(backend)`. Register `backend.close()` in the shutdown handler.
- `services/api-gateway/src/routes/cockpit-stream.hono.ts`
  - On connect, read `Last-Event-ID` header. If present, call `backend.replay(tenantId, lastEventId)` and flush results to the wire BEFORE registering the live subscription. Update the SSE write to include `id: ${event.replayId}` so the browser sets `Last-Event-ID` automatically on reconnect.
  - Optionally add the per-connection dedup LRU for the `dual` window.
- `services/api-gateway/src/config/validate-env.ts`
  - Add `COCKPIT_BUS_BACKEND: z.enum(['in_process','multi_pod','dual']).default('in_process')` and `COCKPIT_EVENT_REPLAY_SECONDS: z.coerce.number().int().min(0).max(600).default(60)`.

### New migration (Borjie example path — BN mirrors with its own number)

- `packages/database/src/migrations/NNNN_cockpit_event_replay.sql`
  - `CREATE TABLE cockpit_event_replay (id bigserial primary key, tenant_id uuid not null, kind text not null, payload jsonb not null, emitted_at timestamptz not null default now())`
  - `CREATE INDEX cockpit_event_replay_tenant_emitted_idx ON cockpit_event_replay (tenant_id, emitted_at DESC)`
  - `ALTER TABLE cockpit_event_replay ENABLE ROW LEVEL SECURITY; ALTER TABLE cockpit_event_replay FORCE ROW LEVEL SECURITY;`
  - Policy: `USING (tenant_id::text = current_setting('app.current_tenant_id', true))`
  - **Immutable migration rule applies** — once shipped, edits go in a new file.

### New worker

- `services/api-gateway/src/workers/cockpit-replay-prune.worker.ts`
  - Hourly cron: `DELETE FROM cockpit_event_replay WHERE emitted_at < now() - interval ...` (interval = `replaySeconds * 2`).

### Tests

- Adapt `services/api-gateway/src/services/cockpit-events/__tests__/bus.test.ts` to run against both backends via a parameterised describe (`describe.each([{name: 'in-process', factory: ...}, {name: 'multi-pod-pg', factory: ...}])`).
- New integration test: 2 simulated pods sharing one PG, publish on pod A, assert delivery on pod B inside 50 ms.
- New integration test: subscriber disconnects, publish 5 events, reconnect with `Last-Event-ID`, assert all 5 are replayed in order.

## 7. Operator runbook — verifying multi-pod after deploy

1. **Pod count check.** `kubectl get pods -l app=api-gateway -o name | wc -l` (or Cloud Run equivalent). Confirm ≥ 2.
2. **LISTEN connections.** `SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'LISTEN%';` — expect one per pod per tenant with an active SSE subscriber.
3. **Two-pod publish/receive smoke test.** Use the new admin endpoint `POST /admin/cockpit-stream/smoke-publish` (added in Step 2) that emits a synthetic event tagged with the responding pod id. Subscribe an `EventSource` and assert events from BOTH pod ids arrive within 30 s.
4. **Replay smoke test.** Open SSE, capture an event with `id: <X>`. Kill the connection. Wait 10 s. Reconnect with `Last-Event-ID: <X>`. Assert the events emitted during the gap arrive immediately.
5. **Latency badge.** The owner cockpit's "Live sync" badge (see `apps/owner-web/src/lib/realtime-latency-reporter.ts`) should stay green. P95 should remain < 200 ms.
6. **Replay table size.** `SELECT pg_size_pretty(pg_total_relation_size('cockpit_event_replay'));` — expect < 50 MB at steady state.
7. **Prune worker liveness.** `pg_stat_user_tables` `n_dead_tup` on `cockpit_event_replay` should stay bounded; check Pino logs for `cockpit-replay-prune.worker` heartbeats every hour.

Rollback: set `COCKPIT_BUS_BACKEND=in_process` and redeploy. The
replay table is harmless on its own; the prune worker keeps it bounded.

## 8. Cost & latency expectations

### Design A — PG LISTEN/NOTIFY

- **Cost:** ~0. One extra table, one bigserial sequence, one
  partial index, one cron worker. No new infra line item.
- **Storage:** at 32 events/sec sustained with 60 s replay window, the
  table never exceeds ~5 MB hot data (~2 000 rows × ~2 KB).
- **Latency added vs in-process:**
  - Publish: +15-25 ms (one INSERT + one pg_notify, both fast)
  - Receive: +5-15 ms (LISTEN delivery is essentially a TCP roundtrip
    from the connection pool to the pod)
  - Total expected P50: ~165 ms (was ~146 ms). Still well inside the
    200 ms SLO.
- **PG impact:** publish path adds one INSERT per event. At 32
  events/sec that is below noise.

### Design B — Redis pubsub + Streams

- **Cost:** if reusing the existing Upstash/Railway Redis already
  bound to `REDIS_URL`, marginal. If a separate instance is provisioned
  for streams workload isolation, est. $30-80/month.
- **Latency added vs in-process:**
  - Publish: +3-8 ms
  - Receive: +3-8 ms
  - Total expected P50: ~155 ms. Marginally faster than A.
- **Failure footprint:** new dependency on Redis persistence (RDB +
  AOF) for the replay guarantee. If Redis goes down, replay is lost
  for the duration of the outage.

Design A trades ~10-20 ms of P50 latency for zero new infra and
better failure semantics. At our target volume the trade is clearly
worth it.

## 9. Implementation effort

**Estimated: 5-7 engineering days**

- 1 d — refactor `bus.ts` into `CockpitBusBackend` seam (Step 1)
- 2 d — PG backend + migration + prune worker
- 1 d — SSE replay wiring + `Last-Event-ID` handling
- 1 d — test parameterisation + 2-pod integration test
- 1-2 d — staged dual-publish bake-in and cutover (Step 2 → 3)
