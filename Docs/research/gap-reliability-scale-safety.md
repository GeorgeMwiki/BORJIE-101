# Gap Dossier — Reliability, Scale & Safety (production-AGI-readiness)

**Dimension:** RELIABILITY, SCALE & SAFETY
**Date:** 2026-06-08
**Auditor:** subagent (grounded in source — both repos + the research specs)
**AGI target:** unbounded users + zero breakage; provably-safe autonomy;
trustworthy under adversarial conditions; always-on.
**Verdict score:** **2 / 5** vs the domain-AGI target.

---

## How to read this

This is an honest, file:line-grounded audit of the CURRENT system against
the AGI target — NOT a restatement of the specs. The specs
(`SCALE_SPEC.md`, `EXECUTION_SPEC_WAVES23.md`, `ORCHESTRATION_SPEC.md`,
`ORCHESTRATION_FRONTIER_ADDENDUM.md`, `scale-reliability-resilience-sota.md`,
`borjie-bn-scale-audit.md`) are accurate and the primitives they cite
mostly exist in the tree. The point of THIS dossier is: of the 8 SCALE_SPEC
P0 lanes and the safety/eval/calibration lanes, **which are still open in
the deployed code today**, with proof. I verified each against current
source on branch `integration/parity-final` (not the spec's snapshot).

**Scoring rationale (2/5).** The defense moat exists and is real
(FORCE-RLS, hash-chained audit, inviolable+policy-gate, four-eye, isolated-vm
sandbox, 4-pattern base-connector, OTel-first bootstrap, canary→SLO-gate→
rollback CD, nightly apollo-gauntlet/defection/sycophancy probe CronJobs).
But the system is **NOT always-on** (single Postgres + single Redis SPOF in
the deployed overlay), **NOT unbounded** (in-process state on a 3→50-replica
gateway: SSE bus, ~26 unguarded crons, rate-limit Maps, onboarding fallback;
a DB connection model incompatible with the tx-pooler), the **money path is
NOT at-least-once** (ledger publishes events into an in-memory array AFTER
the tx — Borjie lost BN's `DurableEventPublisher` in the fork), autonomy is
**NOT provably-safe** (no forced simulate-before-act, no autonomy-controller
meta-rail, cap-evaluator unwired & confidence-blind, kill-switch fails OPEN,
probes nightly-only not inline), and trust is **NOT calibrated** (the brain
hard-stamps confidence=1/gates=pass on every orchestrator answer).

---

## What is genuinely solid (so the gaps stay honest)

- **4-pattern base-connector resilience** — `packages/connectors/src/base-connector.ts:37,135-136,194` ships circuit-breaker (`errorThreshold:5`, `halfOpenAfterMs:30_000`), token-bucket rate limit (`refillBucket`), retry with backoff, and idempotency-key passthrough. Best-in-class for the per-connector hop.
- **OTel bootstrap runs first** — `services/api-gateway/src/index.ts:15-19` (`bootstrapOTel({})` before any span-emitting import). Hard rule honored.
- **Outbox CLAIM is concurrency-safe** for the workers that have it — `payouts-worker.ts` / `dispatcher-worker.ts` use `FOR UPDATE SKIP LOCKED`. The problem is the trigger cadence (no leader lock) + the ledger publisher, not the claim.
- **Workflow durable repos partially landed** — `workflow-engine-wiring.ts:281-289` now wires Drizzle Run/RunEvent/AuditChain/FlowAutonomy when `db` is present (migration `0307_workflow_engine_durable_repos.sql`). This is real progress vs the EXECUTION_SPEC.
- **Spawn handler + subagent executor wired** — `brain-kernel-wiring.ts:919,948-950` (`createSubMdSpawnHandler`), `md-agentic.hono.ts:230` (`kickSubagentExecutor` → `runSubagentTeam`). The EXECUTION_SPEC "no-op spawn ack" / "dead-end pending" blockers are closed.
- **Safety probes deployed as nightly CronJobs** — `infra/k8s/apollo-gauntlet-runner/base/cronjob.yaml:18` (`0 2 * * *` scheming-detection); `defection-probe.yml`, `sycophancy-probe.yml`, `red-team.yml`, `borjie-redteam.yml` workflows exist.
- **CD has canary→SLO-gate→rollback** — `cd-production.yml` (blue/green + rollback), `scripts/check-prometheus-slo.sh` (p99≤1500ms, 5xx≤1%, payments≥99%).
- **Conformal-calibration + probe packages physically exist** — `packages/conformal-calibration-online/src/aci.ts`, `packages/sae-probe/src/`, `packages/autonomy-governance/src/probes/{defection,alignment-faking}-probe.ts`. The gap is wiring, not greenfield.

---

## GAPS (every one buildable)

### Money-path / at-least-once

**RSS-1 [BLOCKER] Ledger event publisher is in-memory; money-path at-least-once is aspirational, not real.**
- **Evidence:** `services/payments-ledger/src/server.ts:316` wires `new InMemoryEventPublisher()`; `services/payments-ledger/src/events/event-publisher.ts:92-112` — `publish()` pushes to `private outbox: OutboxEntry[] = []` (an in-process array) then notifies handlers. `ledger.service.ts:546,565` calls `eventPublisher.publish(...)` AFTER the atomic CAS commit (line ~510-527), so it is a classic dual-write: a crash between commit and publish loses the event forever, and it never crosses to another replica or a durable broker. `IOutboxRepository` (event-publisher.ts:62-87) is declared but has **no implementation** in Borjie.
- **Current state:** events are best-effort, in-process, post-commit. Violates CLAUDE.md "Webhook delivery is at-least-once."
- **AGI target:** every `LedgerService.post()` co-commits its domain events to a transactional `event_outbox` row; a leader-elected relay delivers at-least-once across replices, surviving restarts.
- **Closure lane:** Port BN's `DurableEventPublisher` (`../Cursor Projects/BOSSNYUMBA101/services/payments-ledger/src/events/event-publisher.ts:223` — has `enqueueToOutbox(events, tx)` + `notifySubscribers` MUST-FIX-3a co-commit) + its `event-publisher-factory.ts`, add the Drizzle `IOutboxRepository` against `event_outbox`, swap `server.ts:316`. (Borjie lost both in the fork.) Area: services/payments-ledger.
- **Effort:** M

**RSS-2 [HIGH] Outbox drainer publishes on an IN-PROCESS bus and has no leader election — events fan out to only the draining replica.**
- **Evidence:** `services/api-gateway/src/workers/outbox-worker.ts:1-8` header: "publishes them on the in-process event bus"; `:81` `setInterval(tick)` with no advisory lock. Every gateway replica drains and emits into its own process.
- **Current state:** cross-replica delivery impossible; N× drain load.
- **AGI target:** single leader drains; delivery via Postgres LISTEN/NOTIFY or Redis pub/sub fan-out.
- **Closure lane:** wrap `tick` in `withClusterLock(OUTBOX_LOCK_ID)` (RSS-7) and publish via the cross-replica bus (RSS-5). Area: services/api-gateway/src/workers/outbox-worker.ts.
- **Effort:** M

### Infinite scale — in-process state on a horizontally-scaled gateway

**RSS-3 [BLOCKER] RLS reserved-connection pinning + `prepare:true` is incompatible with the Supabase transaction pooler (:6543) — silent cross-tenant leak OR connection starvation.**
- **Evidence:** `packages/database/src/client.ts:222-245` `withReservedConnection()` holds one backend connection per request to bind `app.current_tenant_id`; `:73-101 readPoolOptions()` never sets `prepare:false` (the migration runner DOES — proving awareness). Prod URL is the tx-pooler (`.env.example:75` `:6543`). The pooler returns the backend at each tx boundary → statement affinity not guaranteed → stale-GUC cross-tenant rows, OR forced onto the connection-starved session pooler.
- **Current state:** SCALE_SPEC P0 lane #1 still open. Security + correctness blocker under concurrent load.
- **AGI target:** one coherent pooler model: drop `reserve()`, bind tenant GUC with `SET LOCAL` per DB op via `withTenantContext`, set `prepare:false`.
- **Closure lane:** route all routes through `databaseMiddlewareNoPin` + `withTenantContext`; set `prepare:false` in `readPoolOptions()` + readonly variant. Area: packages/database/src/client.ts:73,222; services/api-gateway/src/middleware/database.ts.
- **Effort:** L

**RSS-4 [HIGH] ≥5 independent DB pools per process × max:20 × up to 50 replicas overruns Postgres `max_connections`.**
- **Evidence:** `client.ts:75` `max:20` default; distinct `createDatabaseClient(...)` pools at `middleware/database.ts`, `composition/db-client.ts:51`, `routes/brain.hono.ts:97`, `brain-voice.hono.ts:294`, `ai-chat.router.ts:74` (+ read-replica). No `max_connections` tuning in `infra/k8s/base/postgres-statefulset.yaml` → default 100. 5×20=100/replica → 2,000-5,000 demanded at 20-50 replicas.
- **Current state:** SCALE_SPEC P0 lane #2 open. `FATAL: too many connections` far below target replicas.
- **AGI target:** one shared pool per process behind PgBouncer/Supavisor tx-mode; `pool_max ≤ backend_max/(replicas×pools)`.
- **Closure lane:** consolidate to `getDb()`; size from budget; document SCALE_RUNBOOK. Area: packages/database/src/client.ts:111; the 5 brain/voice/chat call sites.
- **Effort:** M

**RSS-5 [HIGH] Cockpit SSE event bus is an in-process EventEmitter — ~(N-1)/N of real-time events dropped at >1 replica.**
- **Evidence:** `services/api-gateway/src/services/cockpit-events/bus.ts:36` `const emitter = new EventEmitter()`; header (`:5-12`) admits "the only seam to swap for a PG-LISTEN / Redis-pubsub fan-out." HPA `minReplicas:3` → always multi-replica in prod.
- **Current state:** SCALE_SPEC P0 lane #4 open. 90% of cockpit events lost at 10 replicas.
- **AGI target:** Postgres LISTEN/NOTIFY or Redis pub/sub fan-out behind the identical publish/subscribe signatures.
- **Closure lane:** swap the EventEmitter seam (signatures already named for it). Requires HA Redis first (RSS-9). Area: cockpit-events/bus.ts; cockpit-stream.hono.ts.
- **Effort:** M

**RSS-6 [HIGH] ~26 of 27 in-process crons run on EVERY replica with no leader election — 50× LLM cost + 50× DB-poll + 50× external-API fan-out.**
- **Evidence:** `services/api-gateway/src/index.ts:3252-3361` — 27 `.start()` calls (mwikilaAutonomousWorker:3334 walks every tenant × 5 LLM handlers, fxFeedCron:3307, executiveBriefCron:3286, etc.). Only `wake-loop-cron.ts:206` uses `pg_try_advisory_lock`; grep for `withClusterLock` across workers/composition returns ONLY wake-loop-cron. **Borjie has no `cluster-lock.ts`** (BN does: `../BOSSNYUMBA101/.../composition/cluster-lock.ts:136,175`).
- **Current state:** SCALE_SPEC P0 lane #3 open. Burns `LLM_DAILY_COST_CAP_USD` linearly with replicas.
- **AGI target:** every cron tick leader-gated by a stable advisory-lock id, or moved to a single-replica worker / k8s CronJobs.
- **Closure lane:** port BN `cluster-lock.ts`; wrap each `.start()` tick in `withClusterLock(<stable-id>)`. Area: new composition/cluster-lock.ts; index.ts:3252-3361.
- **Effort:** M

**RSS-7 [MED] fx-feed cron has no `ON CONFLICT` and no leader lock — N duplicate money-path rows + N× hits on gov endpoints per tick.**
- **Evidence:** `services/api-gateway/src/workers/fx-feed-cron.ts:221` `INSERT INTO fx_rates`, `:251` `INSERT INTO external_benchmarks` — neither has `ON CONFLICT`; no advisory guard (one of the unguarded 26).
- **Current state:** SCALE_SPEC P1 lane open. Pollutes `fx_rates` used by the money path; IP-ban risk on `bot.go.tz` / LBMA.
- **AGI target:** leader-gated + `ON CONFLICT (ts,pair) DO UPDATE` idempotent ticks.
- **Closure lane:** add cluster-lock (RSS-6) + ON CONFLICT. Area: fx-feed-cron.ts:221,251.
- **Effort:** S

**RSS-8 [HIGH] Per-route rate limiters use a process-local Map — effective cap = max × replicas (abuse + per-tenant fairness defeated).**
- **Evidence:** `services/api-gateway/src/middleware/rate-limiter.ts:103-106` "In-Memory Store (Replace with Redis in production)"; `:144` `new RateLimitStore()`, `:245` `new TokenBucketRateLimiter()`. Used by `memory-declare.router.ts`, `parity-capability-dashboard.router.ts`. Only the global Express limiter is Redis-backed.
- **Current state:** SCALE_SPEC P0 lane #6 open. 30/min → 600/min at 20 replicas.
- **AGI target:** Redis token-bucket per-tenant; delete in-memory Map.
- **Closure lane:** route `perUserRateLimit`/`customRateLimit` through shared Redis limiter. Requires HA Redis (RSS-9). Area: rate-limiter.ts:103,144.
- **Effort:** M

**RSS-9 [HIGH] In-memory onboarding store fallback — multi-step onboarding breaks across replicas / on rollout.**
- **Evidence:** `services/api-gateway/src/routes/onboarding.router.ts:70` `sharedInMemoryStore = createInMemoryOnboardingStore()`; `:161-166 resolveStore()` returns Drizzle only if `c.get('db')!=null`, else the in-process Map holding credentials + verification tokens.
- **Current state:** SCALE_SPEC P0 lane #7 open. "Token not found" when verify lands on a different replica; state lost on rollout.
- **AGI target:** Drizzle store is the only production path; hard 503 when db missing.
- **Closure lane:** delete the in-memory fallback; 503 on missing db. Area: onboarding.router.ts:70,161.
- **Effort:** S

### Always-on — HA data tier

**RSS-10 [BLOCKER] Deployed prod overlay ships Postgres `replicas:1` + RWO and Redis `replicas:1` — single points of failure; the HA bundle exists but is NOT referenced.**
- **Evidence:** `infra/k8s/overlays/prod/kustomization.yaml:11` pulls `../../base`; `infra/k8s/base/postgres-statefulset.yaml:31` `replicas:1`, `:78` `ReadWriteOnce`; `infra/k8s/base/redis-deployment.yaml:17` `replicas:1` (a Deployment — restart loses all state). The full HA bundle (`k8s/ha/postgres-statefulset.yaml`, `redis-sentinel-statefulset.yaml`, `etcd`, `haproxy`) exists but the prod kustomization does not include it.
- **Current state:** SCALE_SPEC P0 lanes #5 + #6(redis) open. Any node/AZ loss = full write outage; Redis restart re-opens RSS-8.
- **AGI target:** managed Postgres-with-standby (or the `k8s/ha/` streaming-replication bundle) + Redis Sentinel/Upstash; `DATABASE_URL_READONLY` wired to the replica.
- **Closure lane:** point the prod overlay at `k8s/ha/` (or a managed offering); enable Redis persistence. Area: infra/k8s/overlays/prod/kustomization.yaml; k8s/ha/.
- **Effort:** L

**RSS-11 [MED] nginx ingress buffers SSE and caps read at 60s — defeats real-time streaming + severs long brain/LLM streams.**
- **Evidence:** `infra/k8s/base/ingress.yaml:19` `proxy-read-timeout:"60"` only; no `proxy-buffering:"off"` / `X-Accel-Buffering`. SSE routes rely on byte-flush (cockpit-stream.hono.ts, mining/chat-orchestrator).
- **Current state:** SCALE_SPEC P1 lane open.
- **AGI target:** `proxy-buffering:off` + `proxy-read-timeout≥180` on stream paths.
- **Closure lane:** annotate the SSE ingress path. Area: ingress.yaml:19.
- **Effort:** S

### Reliability — admission control / amplification bounds / capacity proof

**RSS-12 [HIGH] No admission control / prioritized load-shedding / adaptive concurrency — the gateway has no cheap "no" under overload.**
- **Evidence:** no `admission`/`load-shed`/`backpressure`/`CoDel`/`adaptiveConcurrency` module anywhere in `services/api-gateway/src` (find + grep empty). No CRITICAL/DEGRADED/BEST_EFFORT/BULK request classing.
- **Current state:** scale-reliability-sota §1-2 gaps open; the "behavior at the limit" half is absent. Overload is self-amplifying.
- **AGI target:** CoDel/adaptive-LIFO sojourn-timeout middleware (5ms/100ms) + Netflix prioritized shedding on CPU + Netflix adaptive concurrency limit on the brain dispatcher.
- **Closure lane:** new `middleware/admission-control.ts`; class routes (payments/kill-switch/four-eye = CRITICAL never shed; proactive scans = BULK shed first). Area: api-gateway/src/index.ts request path; brain tool-dispatcher.
- **Effort:** L

**RSS-13 [HIGH] No token-bucket retry budget + no bulkheads; jitter is ±20% not AWS Full Jitter — retry amplification + cross-domain resource starvation possible.**
- **Evidence:** `packages/connectors/src/base-connector.ts:201-204` jitter is `±20% equal-ish` (`baseMs*0.2`), not Full Jitter `random(0,min(cap,base*2^n))`. No `retryBudget`/Brooker `0.1-deposit/1-consume` token bucket anywhere (grep empty). No `bulkhead`/`semaphore` isolation between brain / payments / connectors (grep empty) — a slow LLM call can starve payment posts sharing the runtime.
- **Current state:** scale-reliability-sota §3.3 gap open. Retries capped per-request but not as a fraction of success rate.
- **AGI target:** Brooker retry-budget bucket (retries ≤ ~10% of success rate), per-domain bulkheads, Full Jitter.
- **Closure lane:** add retry-budget bucket + bulkheads on LLM/payment/OCR; switch jitter formula. Area: base-connector.ts:201; new admission-control bulkheads.
- **Effort:** M

**RSS-14 [MED] No k6 breakpoint/soak/spike load-proof CI gate; the only load CI is the isolated-vm sandbox harness.**
- **Evidence:** `.github/workflows/sandbox-load-test.yml` stress-tests only the isolated-vm sandbox (1000 runs). No k6/Gatling suite against the api-gateway asserting graceful-at-the-limit; no soak to catch connection-pool leaks; no spike asserting critical-class availability.
- **Current state:** scale-reliability-sota §7 gap open. Capacity is claimed, not proven.
- **AGI target:** k6 breakpoint + 6h soak + spike-with-injected-LLM-503, Thresholds as failing CI gate.
- **Closure lane:** new `k6/` suite + CI workflow with `http_req_failed{class:critical}:rate<0.001`. Area: .github/workflows/; new k6/.
- **Effort:** M

**RSS-15 [MED] CD SLO gate is a single 5m window, not multiwindow-multi-burn-rate — over/under-reacts and lacks fast reset.**
- **Evidence:** `scripts/check-prometheus-slo.sh:34` `WINDOW:-5m`; `:123-131` p99/5xx/payments over one window. No 14.4/6/1 burn-rate table.
- **Current state:** scale-reliability-sota §5.2/§8 upgrade open.
- **AGI target:** MWMBR (1h/5m@14.4, 6h/30m@6, 3d/6h@1) + an error-budget freeze policy.
- **Closure lane:** add burn-rate recording rules + MWMBR conditions to the gate. Area: check-prometheus-slo.sh; prometheus rules.
- **Effort:** M

### Provably-safe autonomy

**RSS-16 [BLOCKER] No autonomy-controller meta-rail (Shield trigger→check→enforce outside the agent loop).**
- **Evidence:** SCALE_SPEC P0 lane #8 names `new kernel/autonomy-controller/`; no such directory exists (`ls packages/central-intelligence/src/kernel/` shows autonomy/, awareness/, policy-gate.ts, inviolable.ts, killswitch.ts — no autonomy-controller). Enforcement is in-loop (policy-gate/inviolable inside think()).
- **Current state:** there is no external rail that can stop/override the agent independent of its own loop; AUTO is not "runs inside a proven box."
- **AGI target:** a Shield meta-rail wrapping policy-gate + inviolable, with gate/audit/test machinery immutable to the agent (DGM invariant).
- **Closure lane:** build `kernel/autonomy-controller/` (trigger→check→enforce); keep money/licence/deletion dual-control. Area: packages/central-intelligence/src/kernel/.
- **Effort:** L

**RSS-17 [BLOCKER] No architecturally-forced simulate-before-act pre-commit stage — world-model exists but is never a forced gate (agents invoke optional world-models <1%).**
- **Evidence:** `packages/central-intelligence/src/kernel/world-model/` + `counter-model/` + `critics/` exist, but grep for `simulate.before.act`/`preCommit` in `kernel/orchestrator` is empty. No mandatory k-step lookahead + critic-veto + null-action rollout before an AUTO action touches reality.
- **Current state:** ORCHESTRATION_FRONTIER_ADDENDUM "most load-bearing change" open. Foresight is optional, therefore ~never used.
- **AGI target:** forced pre-commit lookahead over a runnable estate twin (ledger/licences/FX state machine) + WALL-E rule-calibration against the realized ledger, exactly as the Auditor evidence gate is forced.
- **Closure lane:** insert a forced pre-commit stage in `orchestrator/main-loop.ts` calling world-model + MCTS (process-reward-model) + constitutional-critic veto. Area: main-loop.ts; world-model; process-reward-model/mcts.
- **Effort:** L

**RSS-18 [HIGH] cap-evaluator is confidence/reversibility-blind AND unwired into the kernel — autonomy gates only on cost/mutation envelopes.**
- **Evidence:** `packages/autonomy-governance/src/caps/cap-evaluator.ts:78` `evaluateAutonomyCap(cap, proposedAction, rollingState)` — inputs are only tool-tier/mutation/cost envelopes; no confidence, reversibility, or conformal input. Grep for `evaluateAutonomyCap`/`cap-evaluator` in central-intelligence + gateway composition is EMPTY (never called from the action loop). Conformal `aci.ts` exists and is referenced only in `autonomy-governance/src/decision/calibrated-confidence.ts` — not in the cap-evaluator or kernel gate. ORCHESTRATION_SPEC flags the kernel hook as "a follow-up" (index.ts:18).
- **Current state:** AURA-style confidence×consequence×reversibility control absent; risk-tier.ts is a flat 5-tier ladder (conflates reversibility with blast-radius).
- **AGI target:** wire `evaluateAutonomyCap` before four-eye/sovereign; feed conformal-abstained confidence + 2-D reversibility×blast-radius; enforce maxMutationsPerDay.
- **Closure lane:** wire the kernel hook; extend evaluator inputs with calibrated confidence + reversibility; 2-D risk surface. Area: cap-evaluator.ts; risk-tier.ts; main-loop.ts.
- **Effort:** M

**RSS-19 [HIGH] Kill-switch default port FAILS OPEN on misconfiguration — contradicts the CLAUDE.md "fail-closed" hard rule.**
- **Evidence:** `packages/central-intelligence/src/kernel/killswitch.ts:96` "Anything else collapses to 'live' to fail-open on misconfiguration"; `:129 parseLevel` returns `'live'` for any unrecognized/empty value. A typo'd or missing flag-service value silently re-enables generation.
- **Current state:** the kill-switch is the last-resort safety control; defaulting to live on bad config is the opposite of fail-closed. (Also: the reason-code vocabulary is still property/Kenya — CBK/EAC/OAG/KRA — a BN-fork residual, not mining/Tanzania.)
- **AGI target:** unrecognized/missing → treat as `halt` (or `degraded`) for HIGH-risk surfaces; production wires a real flag-service, not env defaults.
- **Closure lane:** make `parseLevel` fail-closed for HIGH-risk paths; require an explicit `live` token; replace property reason codes with mining ones. Area: killswitch.ts:96,129.
- **Effort:** S

**RSS-20 [HIGH] Safety probes (defection / alignment-faking / SAE) run only nightly in CI — not inline on AUTO actions, so a latent-backdoor AUTO flow has a green light in real time.**
- **Evidence:** `packages/autonomy-governance/src/probes/{defection,alignment-faking}-probe.ts` + `packages/sae-probe/src/` exist; `defection-probe.yml` runs nightly. Grep for `defectionProbe`/`saeProbe`/inline probe in `kernel/orchestrator` is EMPTY. Sleeper-Agents shows good-conduct survives training and hides in weights.
- **Current state:** ORCHESTRATION_FRONTIER_ADDENDUM "inline defection probes" open.
- **AGI target:** linear defection probes on internal activations INLINE on every AUTO action, fail-closed via killswitch + drift-detector + immune.
- **Closure lane:** move probes from nightly CI to an inline call in main-loop PreToolUse on AUTO actions. Area: main-loop.ts; sae-probe; probes/.
- **Effort:** M

**RSS-21 [HIGH] Four-eye approval queue is in-memory only — pending dual-control approvals lost on restart (SOC2 CC7.2 risk on the safety control itself).**
- **Evidence:** `workflow-engine-wiring.ts:223` `createInMemoryApprovalRouter(...)` with NO Drizzle alternative (Run/RunEvent/AuditChain/FlowAutonomy got Drizzle adapters; approvalRouter did not — grep `createDrizzleApprovalRouter` empty). Assignment repos also in-memory (`:129-130`).
- **Current state:** EXECUTION_SPEC "four-eyes queue survives restart" partially open. A gateway rollout drops queued money/licence approvals.
- **AGI target:** Drizzle-backed ApprovalRouter co-located with the audit chain.
- **Closure lane:** add `createDrizzleApprovalRouter` + Assignment Drizzle repos; swap when db present. Area: workflow-engine-wiring.ts:223; new Drizzle adapter.
- **Effort:** M

### Calibration / trust

**RSS-22 [HIGH] The brain hard-stamps confidence=1 and gates=pass on EVERY orchestrator answer — overconfident by construction; calibration/abstention dead on the default path.**
- **Evidence:** `packages/central-intelligence/src/kernel/kernel.ts:3602-3614` (`translateOrchestratorResponse`) sets `groundedness/stability/review/numericalConsistency/overall = 1` and `inviolable/policy/drift/cognitiveLoad = pass` for every `answer`. The comment claims the hook chain "already enforced the gates" but the confidence/judge/drift/uncertainty rails are NOT re-run on the orchestrator answer.
- **Current state:** EXECUTION_SPEC "stop hard-coding confidence=1/gates=pass" open. "90% sure" is never statistically true; semantic-entropy abstention can't fire; trust cannot be earned on real calibration.
- **AGI target:** run the real confidence scorer + policy-gate + drift + uncertainty policy on the orchestrator answer BEFORE translation; pass confidence through conformal abstention.
- **Closure lane:** call the rails in `translateOrchestratorResponse`'s `answer` branch; wire conformal `aci.ts`. Area: kernel.ts:3587-3614; conformal-calibration-online.
- **Effort:** M

### Durable execution / always-resumes

**RSS-23 [MED] Durable Inngest executor is opt-in (`DURABLE_EXEC_ENABLED`) and no worker is deployed — scheduled wake/monitor + long-horizon flows are lost on restart by default.**
- **Evidence:** `packages/central-intelligence/src/durable/inngest-executor.ts:23` "opt-in via DURABLE_EXEC_ENABLED=true"; `index.ts:82` "backward-compatible no-op". No Inngest worker manifest in k8s (only pnpm-lock has the dep). Default path = in-process timers (lost on restart).
- **Current state:** EXECUTION_SPEC durable-resume blocker open by default.
- **AGI target:** deploy an Inngest worker (or Postgres-advisory-lock poller) and default-on durable exec for money/compliance/scheduled-wake/mission flows.
- **Closure lane:** add the worker manifest; set DURABLE_EXEC_ENABLED=true in prod; wire at composition root. Area: durable/inngest-executor.ts; new k8s worker.
- **Effort:** M

**RSS-24 [LOW] HPA ceiling mismatch (helm 50 vs deployed base 20) — the capacity you think you have is not what ships, and it changes the RSS-4 connection math.**
- **Evidence:** `k8s/helm/borjie/values.yaml:141 maxReplicas:50` vs `infra/k8s/base/api-gateway-hpa.yaml:12 maxReplicas:20`.
- **Current state:** SCALE_SPEC P1 reconciliation open.
- **AGI target:** one source of truth, sized against the RSS-4 connection budget; add KEDA RPS/queue-depth scalers.
- **Closure lane:** reconcile; render base from helm. Area: api-gateway-hpa.yaml:12; values.yaml:141.
- **Effort:** S

---

## Sequencing (mirrors SCALE_SPEC P0-first; safety fused as one system)

1. **Money + DB correctness (BLOCKERS):** RSS-1 (durable ledger publisher), RSS-3 (pooler/RLS model), RSS-10 (HA data tier).
2. **Turn off in-process state:** RSS-6 (cluster-lock), RSS-5 (cross-replica bus), RSS-8 (Redis limits), RSS-9 (stateless onboarding), RSS-4 (pool consolidation), RSS-2/RSS-7.
3. **Make AUTO safe-by-construction:** RSS-16 (meta-rail), RSS-17 (forced simulate-before-act), RSS-18 (cap hook + calibration + reversibility), RSS-19 (fail-closed kill-switch), RSS-20 (inline probes), RSS-22 (un-stamp confidence), RSS-21 (durable four-eye).
4. **Prove behavior at the limit:** RSS-12 (admission/shedding), RSS-13 (retry-budget+bulkheads+jitter), RSS-14 (k6 gate), RSS-15 (MWMBR), RSS-11 (SSE ingress), RSS-23/RSS-24.

The non-negotiable invariant throughout (FRONTIER_ADDENDUM): the offense moat
(self-improvement, self-writing memory, AUTO) is only safe BECAUSE of the
defense moat — they are ONE system. Money/licence/deletion stay dual-control
HITL forever; the agent can grow capability but never touch its own
gate/audit/test machinery.
