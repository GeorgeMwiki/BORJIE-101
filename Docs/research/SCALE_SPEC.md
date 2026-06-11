# Infinite-Scale + Unbounded-Capability Spec

Source: infinite-scale-unbounded-capability-sota workflow (cited dossiers in this dir).

## unboundedCapability
GOAL: there is no surface/tool/ability the MD cannot create for any context, but synthesis can never touch its own gate/audit/test machinery (the Darwin-Gödel cautionary tale).

THE STACK ALREADY EXISTS — wire it into one closed loop. Map SOTA to the real packages:

1. CODE-AS-ACTION LANE (CodeAct keystone). The MD's universal action space is executable code, not JSON tool-calls. Borjie already has the JS execution lane: `packages/central-intelligence/src/kernel/sandbox/js-sandbox.ts` (isolated-vm V8 isolate) + `sandbox-policy.ts` (tier caps: free 500ms/2KB → sovereign 5000ms/5KB, clamped to MAX_TIMEOUT_MS/MAX_CODE_BYTES). Promote this from a leaf power-tool to the unified action representation: the orchestrator emits a code body, runs it in the isolate, feeds error messages back for self-debug, and revises across turns. Loops/conditionals/multi-tool composition come for free. This is "no ability it cannot express."

2. RUNTIME TOOL SYNTHESIS (ToolMaker). Add `power_tool.synthesize_tool` to `packages/central-intelligence/src/kernel/power-tools/` alongside `self-modification.ts`. Closed loop: MD writes a tool body → CodeShield static-scan (LlamaFirewall) → run in isolated-vm against

## infiniteScale
PRINCIPLE: the gateway must be 100% STATELESS so HPA/KEDA can run N replicas with no per-replica truth. Today four things hide state in-process (SSE EventEmitter, 27 unguarded crons, per-route rate-limit Maps, onboarding in-memory store) — these are the real ceilings, not CPU.

HORIZONTAL/STATELESS ARCHITECTURE:
1. CELL-BASED (AWS Well-Architected). Partition the whole workload into shared-nothing CELLS behind a thin cell-router that routes by tenant_id. 10 cells ⇒ a bad deploy or poison-pill request hits ≤10% of tenants instead of 100%. Composes with wave deploys and shuffle sharding; same hosts, just routed — no infra multiplication. This is the only pattern that CONTAINS otherwise-uncontainable failure classes.
2. SHUFFLE SHARDING (Route 53 model). Give each tenant a random k-of-N cell subset so almost no two tenants share a full subset — blast radius collapses from 1/N to 1/C(N,k). A DDoS/poison-pill against one tenant spikes only its few cells; combined with bounded retries, blast radius → ~0.

3. AUTOSCALING ON LEADING SIGNALS (KEDA, CNCF-graduated). CPU/memory (raw HPA) are LAGGING — they react only after latency degrades and never reach zero. Borjie already runs KEDA (`k8s/

## dataLayer
THE TRUE SCARCITY IS ACTIVE+IDLE CONNECTIONS, NOT ROWS. Citus/Microsoft (Freund) proved idle connections degrade throughput: 48 active + 0 idle = 1.03M TPS; + 10k idle = 521k TPS (49% loss) because ~50% CPU goes to snapshot building. So pooling is non-negotiable.

THE CORE BLOCKER (fix first): `withReservedConnection` (`packages/database/src/client.ts:222`) pins ONE connection per request to bind the RLS tenant GUC (`set_config('app.current_tenant_id', …, false)`) so per-statement connection check-out can't leak rows across tenants. This is correct on a SESSION pooler but BREAKS on Supabase's transaction pooler (:6543, the prod DATABASE_URL): statement affinity isn't guaranteed → silent cross-tenant GUC leak, OR you're forced onto the connection-starved session pooler. Also `readPoolOptions()` (client.ts:73) never sets `prepare:false`, so :6543 throws "prepared statement does not exist" under load (the code already knows this — run-migrations.ts sets prepare:false). PICK ONE COHERENT MODEL:
  (a) session-mode pooler + keep reserve() pinning + cap pools so pools×max×replicas < session ceiling; OR
  (b) DROP reserve(); bind the tenant GUC with `SET LOCAL` per DB op via `databaseMiddl

## reliability
DOCTRINE: "reject early beats time out late"; measure capacity in resources not QPS; bound retry amplification by construction; degrade gracefully, never collapse. Prove it with a failing CI gate, not a slide.

1. BACKPRESSURE / ADMISSION CONTROL.
- Netflix adaptive concurrency limits per gateway instance: self-tune the in-flight limit from Little's Law + TCP-congestion gradient (RTT_noload/RTT_actual) — no static magic numbers that go stale on every deploy/autoscale. Under stress, shed lowest-priority first (progressive), not an on/off circuit break.
- Google SRE adaptive client-side throttling between internal services: P(reject)=max(0,(requests−2·accepts)/requests) over 2min — clients self-throttle BEFORE hammering a stressed backend (kills thundering herds with zero coordination).
- CoDel/Adaptive-LIFO on the request queue: drop by sojourn timeout (5ms standing / 100ms interval) and flip FIFO→LIFO under load to serve the freshest requests whose clients still wait — sheds exactly the deadline-breached set.

2. RATE LIMITING (Stripe four-layer; today it's broken at scale). Per-route limiters use a process-local Map (`services/api-gateway/src/middleware/rate-limiter.ts:103`, wired

## Remediation lanes (prioritized)
- [P0/L] Switch RLS to SET LOCAL per-op (drop reserve()) + prepare:false for :6543 transaction pooler  <packages/database/src/client.ts:73,222; services/api-gateway/src/middleware/database.ts:328,439 (use databaseMiddlewareNoPin + withTenantContext on all routes)>
- [P0/M] Consolidate to one shared DB pool per process + put Supavisor/PgBouncer transaction-mode in front; size DATABASE_POOL_MAX from budget  <packages/database/src/client.ts:111; routes/brain.hono.ts:97, brain-voice.hono.ts:294, ai-chat.router.ts:74, composition/db-client.ts:51 → route through getDb()>
- [P0/M] Port BN cluster-lock.ts (pg_try_advisory_lock) into Borjie and wrap all 27 crons in withClusterLock(stable-id)  <new services/api-gateway/src/composition/cluster-lock.ts (from ../Cursor Projects/BOSSNYUMBA101/.../cluster-lock.ts); services/api-gateway/src/index.ts:3252-3361>
- [P0/M] Replace in-process cockpit EventEmitter bus with Postgres LISTEN/NOTIFY (or Redis pub/sub) cross-replica fan-out  <services/api-gateway/src/services/cockpit-events/bus.ts:36 (seam named in header); consumed at routes/cockpit-stream.hono.ts>
- [P0/L] Deploy HA Postgres (managed standby or k8s/ha streaming bundle) — remove replicas:1 RWO SPOF  <infra/k8s/base/postgres-statefulset.yaml:31,78 → k8s/ha/postgres-statefulset.yaml + DATABASE_URL_READONLY to replica>
- [P0/M] Deploy HA Redis (Sentinel/Upstash) + route per-route rate-limiters through shared Redis token-bucket; delete in-memory Map  <infra/k8s/base/redis-deployment.yaml:17 → k8s/ha/redis-sentinel-statefulset.yaml; middleware/rate-limiter.ts:103,144>
- [P0/S] Make Drizzle onboarding store the only production path; 503 (not in-memory) when db missing  <services/api-gateway/src/routes/onboarding.router.ts:70,161>
- [P0/L] Build the autonomy-controller meta-rail (Shield trigger→check→enforce outside the agent loop) wrapping policy-gate + inviolable; keep gate/audit/test immutable to the agent  <packages/central-intelligence/src/kernel/policy-gate.ts, inviolable.ts; new kernel/autonomy-controller/>
- [P1/L] Add power_tool.synthesize_tool (ToolMaker loop): write→CodeShield scan→sandbox unit-test→register in power-tools registry with capability manifest  <new packages/central-intelligence/src/kernel/power-tools/synthesize-tool.ts; registry.ts; sandbox/js-sandbox.ts>
- [P1/XL] Build the ever-growing skill library (Voyager+Agent Skills): pgvector-retrieved, composable, on-disk SKILL.md with progressive disclosure  <new packages/skill-library/; intelligence_corpus_chunks (pgvector); power-tools/compose.ts>
- [P1/L] Add LlamaFirewall defence-in-depth (CodeShield static-scan every synth body; AlignmentCheck on chain-of-thought; PromptGuard inbound)  <new packages/central-intelligence/src/kernel/firewall/; called from synthesize-tool + js-sandbox entry>
- [P1/M] Wire transactional-outbox relay as leader-elected single-replica worker (or Debezium CDC)  <services/api-gateway/src/workers/outbox-worker.ts; packages/database/src/schemas/outbox.schema.ts; cluster-lock>
- [P1/S] SSE survival: proxy-buffering off + proxy-read-timeout>=180 on stream paths  <infra/k8s/base/ingress.yaml:19>
- [P1/M] RLS-at-scale: index all tenant_id RLS columns, wrap GUC read in (select), ensure current_app_tenant_id() is STABLE SECURITY DEFINER  <packages/database/src/schemas/*; migration 0172 current_app_tenant_id()>
- [P1/S] Reconcile HPA ceiling (base maxReplicas:20 vs helm 50) and add KEDA RPS/queue-depth scalers for api-gateway + warm owner portal (minReplicaCount:1)  <infra/k8s/base/api-gateway-hpa.yaml:12; k8s/helm/borjie/values.yaml:141; k8s/keda/scaledobject-owner-portal.yaml:20>
- [P1/L] Adaptive concurrency limits + token-bucket retry budget + Resilience4j-style bulkheads on LLM/payment/OCR calls  <new services/api-gateway/src/middleware/admission-control.ts; brain-llm-router rate-limit-preflight>
- [P1/S] fx-feed cron: gate with cluster-lock + add ON CONFLICT(ts,pair) DO UPDATE for idempotent ticks  <services/api-gateway/src/workers/fx-feed-cron.ts:99-100,221,251>
- [P2/L] Upgrade portal-genui generator to spec->flow-graph->FSM->HTML IR with rubric refinement loop for novel interaction patterns  <packages/portal-genui/src/generator/generator.ts; engine.ts; packages/genui/sandboxed-surface.ts>
- [P2/M] Add short-TTL Redis read-through cache + DATABASE_URL_READONLY for hot dashboard reads (stale-while-revalidate / stale-if-error)  <services/api-gateway/src/composition/db-client.ts:73,86; currency-rates.hono.ts>
- [P2/L] Time-partition append-heavy tables (event_outbox, audit chain, sovereign ledger, journal) via declarative RANGE + ATTACH/DETACH CONCURRENTLY  <packages/database/src/schemas/outbox.schema.ts, audit/ledger schemas; new migrations>
- [P2/M] pgvector scale: adopt halfvec, raise maintenance_work_mem for HNSW build, tune m/ef_search  <intelligence_corpus_chunks schema + migration; postgres tuning>
- [P2/XL] Cell-based + shuffle-sharding cell router by tenant_id to bound blast radius  <new infra cell-router layer; k8s overlays; ties to HPA/KEDA>
- [P2/L] Argo Rollouts SLO-gated canary + MWMBR burn-rate auto-rollback; expand/contract for all schema changes  <.github/workflows/cd-production.yml; k8s/ argo manifests; prometheus AnalysisTemplate>
- [P2/M] k6 breakpoint/soak load-proof as failing CI gate asserting graceful-at-the-limit  <.github/workflows/ (extend sandbox-load-test.yml); new k6/ gateway tests with Thresholds>
- [P2/XL] Add E2B/Firecracker microVM lane for OS-touching synthesized code (ephemeral spin->run->harvest->destroy)  <new packages/central-intelligence/src/kernel/sandbox/microvm-lane.ts; gVisor runtimeclass already at infra/k8s/base/runtimeclass-gvisor.yaml>

## Verdict
SHIP-READY ARCHITECTURE, NOT GREENFIELD: every capability primitive the brief demands already exists in the tree — isolated-vm CodeAct lane (sandbox/js-sandbox.ts + sandbox-policy.ts), the 4-guard power-tool registry, self-modification reflexion, portal-genui/genui/system-graph surface synthesis, policy-gate + inviolable + high-risk-literal-only, the eventOutbox table + worker, KEDA, gVisor RuntimeClass, read-replica factory, and the HA bundle. The ceilings are NOT missing features — they are (1) in-process STATE on a horizontally-scaled gateway (EventEmitter bus, 27 unguarded crons, per-route rate-limit Maps, onboarding fallback), (2) a DB connection model (reserve()-pinning + 5 pools/process + prepare:true) that is fundamentally incompatible with the transaction pooler that is the actual Postgres scaling ceiling, and (3) the absence of one closed synthesis loop + an external meta-rail to make unbounded capability SAFE.

UNBOUNDED CAPABILITY is achievable by wiring the existing pieces into the CodeAct→synthesize_tool→skill-library loop with the LlamaFirewall+Shield meta-rail and the DGM immutability invariant (the agent can grow capability but can never touch its own gate/audit/test machinery). INFINITE SCALE is achievable by making the gateway truly stateless (cross-replica fan-out, leader-elected crons, Redis-backed limits, Drizzle-only onboarding) behind a cell-based + shuffle-sharded router on KEDA leading-signal autoscaling. The DATA LAYER scales via transaction-mode Supavisor pooling + SET LOCAL RLS + indexed initPlans + read replicas + time-partitioning, with Citus-by-tenant_id held as the last lever (near-zero app change because everything is already tenant-scoped). RELIABILITY holds under load via reject-early admission control, bounded-by-construction retries, bulkheads, prioritized shedding, stale-if-error degradation, and SLO-gated auto-rollback — proven by a k6 breakpoint CI gate.

EXECUTE THE 8 P0 LANES FIRST — they are disjoint and remove every BLOCKER/HIGH from the audit: the RLS/pooler model, pool consolidation, cluster-lock, cross-replica bus, HA Postgres, HA Redis + Redis rate-limits, stateless onboarding, and the autonomy-controller meta-rail. After P0, the system signs up and serves users without a structural ceiling and synthesizes any surface/tool/ability safely. P1 turns on the growth loop + firewall + observability; P2 adds cell isolation, microVM lane, partitioning, and the load-proof gate. These steps remove the ceilings; nothing in the brief requires a rewrite.