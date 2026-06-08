# Scale, Reliability & Resilience — SOTA Dossier

**Status:** Research synthesis (frontier + authoritative primary sources)
**Date:** 2026-06-08
**Audience:** Borjie platform/SRE engineers hardening the api-gateway, brain
kernel, payments-ledger, connectors, and workflow-engine for heavy traffic.
**Thesis:** You do not "prevent breakage" — that is impossible at scale.
You engineer the system so that **the limit is reached gracefully and
predictably**: it sheds the least-important work first, degrades to a
useful subset, protects its dependencies from each other, and proves —
empirically, with load and chaos — that it survives the conditions you
designed for. Every claim below cites a real URL actually fetched.

---

## 0. The governing mental model

There is no such thing as "infinite capacity." The only honest design
goal is **bounded, intentional behavior at the limit**. Three invariants
follow, and they organize the entire dossier:

1. **The system must always be able to say "no" cheaply** (load-shedding +
   admission control) — rejecting a request must cost far less than
   serving it, otherwise overload is self-amplifying.
2. **Work has a priority; the system sheds in priority order** (Netflix
   prioritized load shedding, Google criticality levels, Stripe fleet
   reservation). User-critical traffic survives; prefetch/batch/bulk dies
   first.
3. **Every reliability claim is an experiment that must be run**
   (Principles of Chaos Engineering; k6/Gatling capacity proof; SLO
   error-budget operations). Confidence comes from evidence, not from
   architecture diagrams.

Google SRE formalizes the measurement contract behind all of this: judge
every defensive mechanism on **precision, recall, detection time, and
reset time** — not on whether it "feels safe."
[sre.google/workbook/alerting-on-slos](https://sre.google/workbook/alerting-on-slos/)

---

## 1. Backpressure + load-shedding (admission control)

### 1.1 Why FIFO queues kill you, and CoDel/adaptive-LIFO save you

Facebook's **"Fail at Scale"** (ACM Queue) is the canonical treatment. The
insight: an unbounded or FIFO queue under overload fills with **stale
requests the client has already given up on** — the server spends 100% of
its CPU producing responses nobody is waiting for. They adapted the network
**CoDel (Controlled Delay)** active-queue-management algorithm to
application request queues. Pseudocode and parameters (verbatim from the
paper):

```
onNewRequest(req, queue):
  if (queue.lastEmptyTime() < (now - N seconds)) {
      timeout = M ms          // standing queue detected -> aggressive timeout
  } else {
      timeout = N seconds;    // queue recently drained -> tolerate a burst
  }
  queue.enqueue(req, timeout)
```

with **M = 5 ms, N = 100 ms** as production defaults. The queue "drops"
(times out) requests only once a *standing* queue persists past the
interval, so short reliability bursts are tolerated but persistent
overload is shed. Paired with this is **adaptive LIFO**: under normal
load serve FIFO (fairness), but once a standing queue forms, **switch to
LIFO** so the freshest requests — the ones whose client is still waiting —
get served and the stale ones time out. "CoDel and adaptive LIFO play
nicely together." Facebook also enforces **client-side concurrency
control**: if outstanding requests to a service exceed a configured count,
the request is *immediately* marked an error (cheap "no"), preventing a
slow dependency from consuming all the caller's threads.
[blog.acolyer.org/2015/11/19/fail-at-scale-controlling-queue-delay](https://blog.acolyer.org/2015/11/19/fail-at-scale-controlling-queue-delay/)

**Why best-in-world:** CoDel is the only widely-deployed AQM that is
*parameterless in practice* (the two constants generalize across services)
and self-tuning to the actual sojourn time — it shed exactly the requests
that have already breached their deadline, which is provably the correct
set to drop.

### 1.2 Netflix service-level **prioritized** load shedding (2024–2025)

Netflix's evolution is the SOTA for *what* to shed. They moved the
shedding decision **down from the centralized API Gateway to each
service**, and tied it to **CPU utilization** (which services already
autoscale on, so it is a natural overload signal). Requests are bucketed
into a generic, configurable priority library:
**CRITICAL → DEGRADED → BEST_EFFORT → BULK**. As CPU climbs past target,
the service first sheds BULK/prefetch, then BEST_EFFORT, then DEGRADED,
protecting CRITICAL (user-initiated) traffic. The conceptual frame is a
**Failure Buffer / Success Buffer**: deliberately spend the failure buffer
on low-priority drops to preserve the success buffer for what users
actually see. **Measured during a real infra outage:** prefetch
availability fell to **20%** while **user-initiated request availability
stayed above 99.4%** — a secondary outage was prevented.
[infoq.com/news/2024/11/netflix-load-shedding](https://www.infoq.com/news/2024/11/netflix-load-shedding/) ·
[infoq.com/news/2025/11/netflix-prioritized-loadshedding](https://www.infoq.com/news/2025/11/netflix-prioritized-loadshedding/)

**Why best-in-world:** It is the only public, battle-tested framework that
makes priority a *first-class request attribute*, decentralizes the
decision to where the CPU signal actually lives, and has the production
incident receipts (99.4% critical availability through an outage) to prove
graceful degradation rather than collapse.

### 1.3 Adaptive concurrency limits (no magic numbers)

Static concurrency caps are wrong the moment your latency profile changes.
Netflix's **adaptive concurrency limits** apply **TCP-congestion-control
math (Little's Law / AIMD / Gradient)** to the application layer: measure
RTT, infer the optimal in-flight limit continuously, and reject excess RPS
*before* latency degrades. This keeps the instance fast and protects its
downstreams — no operator ever picks a number.
[netflixtechblog.medium.com/performance-under-load-3e6fa9a60581](https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581)

> **Borjie mapping.** `packages/connectors/src/base-connector.ts` already
> ships a **token-bucket rate limiter** (`refillPerMs = rpm/60_000`,
> burst capacity) and per-connector concurrency posture. The gap vs SOTA:
> there is no **CoDel/adaptive-LIFO admission queue** in the api-gateway
> ingress and no **adaptive (latency-derived) concurrency limit** — both
> are static. Action: add a CoDel-style sojourn-timeout middleware in
> `services/api-gateway/src/index.ts` request path (drop on queue age >
> 5ms standing / 100ms interval) and an adaptive-limit guard on the brain
> kernel's tool-dispatcher, which is the most CPU-expensive hop.

---

## 2. Rate-limiting + quotas (per-tenant fairness)

### 2.1 Stripe's four-layer limiter stack (the reference architecture)

Stripe runs **four distinct limiters**, not one:

1. **Request rate limiter** — token bucket per user in **Redis** ("every
   Stripe user has a bucket; every request removes a token"). Caps
   sustained RPS, allows bursts via accumulated tokens.
2. **Concurrent requests limiter** — caps *simultaneous* in-flight
   requests per user (e.g. "only 20 at once"), which "totally solved"
   resource contention on expensive endpoints that a per-second limit
   could not.
3. **Fleet usage load shedder** — **reserves a fraction of the fleet for
   critical methods**. "If our reservation number is 20%, then any
   non-critical request over their 80% allocation would be rejected."
   (charge-creation = critical; charge-listing = non-critical.)
4. **Worker utilization load shedder** — last line of defense: when worker
   utilization spikes, shed in order test-mode → GETs → POSTs → critical.

[stripe.com/blog/rate-limiters](https://stripe.com/blog/rate-limiters)

**Why best-in-world:** Stripe is a payments processor whose entire
business is *not losing the money request*. The four-layer design proves
that rate-limiting (smoothing) and load-shedding (priority-preserving
rejection) are **different jobs that need different limiters** — a lesson
most teams learn only after an outage.

### 2.2 Google SRE per-customer quotas + adaptive client-side throttling

Google allocates **per-customer capacity** that may sum to *more* than
total capacity (overcommit, because simultaneous peaks are rare): a
10,000-CPU backend gives Gmail 4,000 CPU-s/s, Calendar 4,000, Android
3,000, etc. The killer primitive is **client-side adaptive throttling** —
clients reject their *own* requests probabilistically before they ever hit
an overloaded backend:

```
rejectionProbability = max(0, (requests - K*accepts) / (requests + 1))
```

over a 2-minute window, with **K = 2** default. Below K×accepts the client
sends everything; as the backend rejects, the client self-throttles
toward the accept rate — distributed, no coordination, no thundering herd.
[sre.google/sre-book/handling-overload](https://sre.google/sre-book/handling-overload/)

### 2.3 Per-tenant fairness: weighted fair queueing beats flat caps

Flat per-tenant caps still let a noisy tenant starve others *inside* their
allocation. **Weighted Fair Queueing (WFQ)** maintains a virtual queue per
tenant, assigns each a weight, and the scheduler round-robins small
batches proportionally to weight — guaranteeing every tenant forward
progress regardless of a neighbor's burst. The industry consensus is a
**layered** design: token/leaky bucket for the rate dimension + sliding-
window counter for strict short-window fairness + WFQ for proportional
service + tier/SLA weights on top.
[systemdr.substack.com/p/designing-for-noisy-neighbors-multi](https://systemdr.substack.com/p/designing-for-noisy-neighbors-multi) ·
[gravitee.io/blog/rate-limiting-apis-scale-patterns-strategies](https://www.gravitee.io/blog/rate-limiting-apis-scale-patterns-strategies)

> **Borjie mapping.** Borjie is **multi-tenant with FORCE-RLS** (`CLAUDE.md`
> hard rule). The base-connector token bucket is per *connector*, not per
> *tenant*. Action: add a Redis-backed **per-tenant token bucket** at the
> api-gateway auth middleware (tenant_id is already bound to
> `app.current_tenant_id`), classify routes into Stripe-style critical
> (payments/ledger `POST`, kill-switch, four-eye) vs non-critical
> (listings, brain non-urgent inference), and **reserve fleet capacity**
> for the critical class. Brain kernel calls (LATS/debate) are the
> expensive endpoints — apply the *concurrent* limiter there, not just RPS.

---

## 3. Circuit breakers + bulkheads + timeouts + retries-with-jitter

### 3.1 The four patterns, and the order they must nest

Resilience4j (the de-facto JVM reference, mirrored everywhere) prescribes
the **decorator nesting order from outermost to innermost**:
`Retry → CircuitBreaker → RateLimiter → TimeLimiter → Bulkhead`. Each does
one job:

- **Timeout** — never wait indefinitely; set on *every* cross-process call.
  Tune to **p99/p99.9** of downstream latency + network padding (AWS:
  "p99.9 for a 0.1% false-timeout rate").
- **Circuit breaker** — CLOSED → (error threshold tripped) → OPEN (fail
  fast, no calls) → (after cooldown) HALF-OPEN (probe) → CLOSED/OPEN.
  Stops cascading failure and **guards against retry storms**.
- **Bulkhead** — isolate resources so one slow dependency can't drain the
  whole thread/connection pool (`coreThreadPoolSize`, `maxThreadPoolSize`,
  `queueCapacity`); failure is contained to one compartment (ship-hull
  metaphor).
- **Retry** — only with **exponential backoff + jitter**, and only for
  idempotent ops.

[mobisoftinfotech.com/.../resilience4j-circuit-breaker-retry-bulkhead-spring-boot](https://mobisoftinfotech.com/resources/blog/microservices/resilience4j-circuit-breaker-retry-bulkhead-spring-boot)

### 3.2 Jitter formulas (AWS, exact)

AWS's canonical "Exponential Backoff and Jitter" gives the formulas
verbatim:

```
# Capped exponential backoff (NO jitter — the loser)
sleep = min(cap, base * 2 ** attempt)

# Full Jitter  (recommended default)
sleep = random(0, min(cap, base * 2 ** attempt))

# Equal Jitter
temp  = min(cap, base * 2 ** attempt)
sleep = temp/2 + random(0, temp/2)

# Decorrelated Jitter  (uses previous sleep; great for single-client throughput)
sleep = min(cap, random(base, sleep * 3))
```

Simulation under 100 contending clients: no-jitter is "the clear loser"
(more work *and* more time); jittered approaches **cut the call count by
more than half**; Full Jitter uses the least work. Verdict: "jittered
backoff should be considered a standard approach for remote clients."
[aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/) ·
[aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)

### 3.3 Why backoff+jitter is NOT enough — Marc Brooker's retry budget

The deepest insight, from AWS Sr. Principal Engineer **Marc Brooker**:
backoff only helps "in systems with small numbers of sequential clients."
With many clients, you still get **retry amplification** — a failing
service gets hammered with N× its normal load exactly when it's weakest.
The fix is a **token-bucket retry budget**:

> "each success could deposit **0.1 tokens**, and each retry could consume
> **1 token**." A retry is only allowed if a whole token exists.

This makes the client "behave like *N retries* a lot below 10% failure
rate, and like *0.1 retries* much above 10% failure rate" — retries are
**capped to a bounded fraction (≈10%) of the success rate**, so they can
never become the cause of the outage. Layer this with a **retry circuit
breaker** (stop retrying entirely when fleet-wide failure is high).
[brooker.co.za/blog/2022/02/28/retries.html](https://brooker.co.za/blog/2022/02/28/retries.html)

Google SRE independently arrives at the same numbers, with the crucial
multi-layer rule: **per-request limit ≈ 3 attempts**, **per-client retry
budget < 10%**, and **never retry at more than one layer** — emit an
"overloaded; don't retry" sentinel so retries don't multiply
combinatorially up a deep dependency stack.
[sre.google/sre-book/handling-overload](https://sre.google/sre-book/handling-overload/)

**Why best-in-world:** Brooker's token-bucket retry budget is the single
most important and most-overlooked resilience primitive — it is the only
mechanism that mathematically bounds retry-induced load amplification,
turning the classic "retries cause the outage" failure mode into an
impossibility by construction.

> **Borjie mapping.** `base-connector.ts` already implements **all four
> patterns**: token-bucket rate limit, circuit breaker
> (closed/half-open/open with `errorThreshold`, `halfOpenAfterMs`), retry
> (`maxAttempts`, `initialDelayMs`) and a `jitter()` of **±20%**.
> **Gaps vs SOTA:** (a) jitter is ±20% *equal-ish*, not AWS **Full
> Jitter** `random(0, min(cap, base*2^n))` — switch to Full Jitter; (b)
> there is **no token-bucket retry *budget*** (the Brooker primitive) —
> retries are capped per-request but not as a fraction of success rate, so
> a brain→LLM or connector→external-API storm is still possible; (c) no
> **bulkhead isolation** between brain kernel, payments, and connector
> threads — a slow LLM call can starve payment posts. Add a retry-budget
> token bucket and per-domain bulkheads (the connectors directory shows 14
> external integrations sharing one runtime — prime bulkhead candidates).

---

## 4. Graceful degradation (serve-stale, feature-shed)

Degradation is the *output* of load-shedding: when you shed or a dependency
fails, return a **useful reduced answer**, never an error page.

- **`stale-while-revalidate` / `stale-if-error`** (HTTP cache-control,
  RFC 5861; first-class at Cloudflare): on expiry/error, **serve the
  stale cached response immediately** and revalidate in the background.
  Cloudflare's 2026 async SWR means "no visitor is waiting for the origin"
  and "the first request is no longer vulnerable to origin timeouts or
  errors." `stale-if-error` keeps serving cached data through an origin
  5xx. (Prefer it over "Always Online", which injects a banner.)
  [developers.cloudflare.com/cache/concepts/revalidation](https://developers.cloudflare.com/cache/concepts/revalidation/) ·
  [developers.cloudflare.com/changelog/post/2026-02-26-async-stale-while-revalidate](https://developers.cloudflare.com/changelog/post/2026-02-26-async-stale-while-revalidate/)
- **Feature-shedding via flags** — under load, *turn off* expensive,
  non-essential features (recommendations, rich previews, prefetch) to
  protect the core path. This is the BEST_EFFORT/BULK shed (§1.2) applied
  at the feature granularity.
- **Static fallbacks** — pre-rendered defaults / last-known-good values for
  read paths when the live system is shed.

**Why best-in-world:** SWR/`stale-if-error` is the only degradation
primitive that is *invisible to users* — they get fast, slightly-stale
truth instead of a 503 — and it is built into the HTTP standard and every
major CDN, so it composes with everything.

> **Borjie mapping.** The brain layer is the perfect SWR candidate:
> cache the **last good junior recommendation + evidence chain** per
> (tenant, intent) and serve it with a "as of <timestamp>" badge when the
> live kernel is shed or the LLM provider is circuit-open — this preserves
> the **evidence-required AI output** hard rule (you serve real prior
> evidence, never a fabricated empty chain). Feature-shed order for
> Borjie: BULK = proactive-intel scans/notifications → BEST_EFFORT = LATS
> deep search/debate → DEGRADED = single-pass inference → CRITICAL =
> ledger posts, kill-switch, four-eye approvals (never shed).

---

## 5. Zero-downtime deploys: blue/green + canary + auto-rollback

### 5.1 Progressive delivery with SLO-gated automated rollback

The SOTA is **Argo Rollouts / Flagger** driving canary or blue-green on
Kubernetes with an **AnalysisTemplate** that queries Prometheus *during*
the rollout and auto-aborts on SLO breach:

```yaml
strategy:
  canary:
    analysis:
      templates: [{ templateName: success-rate }]
      startingStep: 2
    steps:
      - setWeight: 20
      - pause: { duration: 10m }   # analysis runs in background here
metrics:
  - name: success-rate
    interval: 5m
    successCondition: result[0] >= 0.95
    failureLimit: 3
    provider:
      prometheus:
        query: "sum(irate(http_requests{code!~'5..'}[5m])) / sum(irate(http_requests[5m]))"
```

"When analysis fails, the rollout automatically aborts, setting the canary
weight back to zero" — traffic reverts to the stable version with **zero
human in the loop**. Analysis can be **inconclusive** (pause for a human)
when neither success nor failure threshold is met.
[argo-rollouts.readthedocs.io/en/stable/features/analysis](https://argo-rollouts.readthedocs.io/en/stable/features/analysis/) ·
[infracloud.io/blogs/progressive-delivery-argo-rollouts-canary-analysis](https://www.infracloud.io/blogs/progressive-delivery-argo-rollouts-canary-analysis/)

### 5.2 Burn-rate SLO alerts as the rollback trigger (the rigorous version)

The rollback signal should be a **multiwindow multi-burn-rate (MWMBR)**
error-budget alert — Google SRE Workbook's recommended approach (the 6th
and final, after 5 inferior ones). For a 99.9% SLO:

| Severity | Long window | Short window | Burn rate | Budget consumed |
|----------|-------------|--------------|-----------|-----------------|
| **Page** | 1 hour      | 5 minutes    | **14.4**  | 2%              |
| **Page** | 6 hours     | 30 minutes   | **6**     | 5%              |
| **Ticket** | 3 days    | 6 hours      | **1**     | 10%             |

The alert fires only when **both** the long and short window exceed the
burn-rate threshold — the long window gives recall/precision, the short
window gives a fast **reset time** (alert clears 5 min after recovery, not
1 hour). Short window = **1/12** of long window. At 99.999% a full outage
burns the budget in **26 seconds** — faster than any alert — which is
*why* canary + auto-rollback (a preventive control) is mandatory rather
than reactive paging.
[sre.google/workbook/alerting-on-slos](https://sre.google/workbook/alerting-on-slos/) ·
[datadoghq.com/blog/burn-rate-is-better-error-rate](https://www.datadoghq.com/blog/burn-rate-is-better-error-rate/)

### 5.3 Zero-downtime DB migrations: Expand/Contract (parallel change)

Schema changes are the #1 cause of "deploy broke prod." The **expand/
contract (parallel change)** pattern makes every migration backward-
compatible with the *currently running* code:

1. **Expand** — add new column/table/index; dual-write old+new. (Old code
   still works; migration completes while old app runs.)
2. **Migrate + cutover** — backfill; deploy new code reading/writing new
   shape; both shapes coexist.
3. **Contract** — only after new code is stable everywhere, a *separate*
   migration drops the old structure.

"Every migration must be backward compatible with the currently running
application code." Combine with blue/green at the data tier for the
riskiest changes.
[blogs.reliablepenguin.com/2025/11/16/database-migrations-without-drama-expand-contract-in-practice](https://blogs.reliablepenguin.com/2025/11/16/database-migrations-without-drama-expand-contract-in-practice) ·
[dev.to/jp_fontenele4321/the-expand-and-contract-pattern-for-zero-downtime-migrations-445m](https://dev.to/jp_fontenele4321/the-expand-and-contract-pattern-for-zero-downtime-migrations-445m)

**Why best-in-world:** Expand/contract is the only migration strategy that
holds the **"migration succeeds while the old binary is still serving"**
invariant — which is *exactly* what makes canary and instant rollback
safe, because rollback never lands a binary on a schema it can't read.

> **Borjie mapping — already strong.** Borjie's CD pipeline (`.github/
> workflows/cd.yml`) **already does canary-25% → smoke test →
> `scripts/check-prometheus-slo.sh` → rollback-on-failure**. The script
> gates on p99 ≤ 1500ms, 5xx ≤ 1%, payments-success ≥ 99% over 5m.
> `packages/autonomy-governance/src/slo/` has a **`slo-monitor` +
> `canary-controller` + `auto-rollback`** engine (pure verdict →
> reduce-traffic/handoff/kill-and-rollback). **Gaps:** (a) the SLO gate is
> a single 5-min window, not MWMBR — adopt the 14.4/6/1 burn-rate table so
> you don't over/under-react; (b) Borjie's **migrations are immutable,
> forward-only** (hard rule) which is good, but there is no explicit
> *expand/contract discipline doc* — codify it so no PR ships a column
> drop in the same migration that adds its replacement; the migration-
> safety-check.yml NOT-NULL-backfill gate is a partial expand/contract
> guard already.

---

## 6. Idempotent + at-least-once messaging

### 6.1 The two impossibility/possibility theorems

- **Exactly-once *delivery* is impossible** in a distributed system.
- **Exactly-once *processing* is achievable** = at-least-once delivery +
  **idempotent consumer** (dedup on a unique key).

[systemoverflow.com/learn/.../idempotency-at-least-once-delivery-and-the-outbox-inbox-pattern](https://www.systemoverflow.com/learn/design-fundamentals/communication-patterns/idempotency-at-least-once-delivery-and-the-outbox-inbox-pattern)

### 6.2 The three primitives

1. **Idempotency keys** (producer/API side) — client sends a unique
   `Idempotency-Key`; server stores key + result in the *same transaction*
   as the business write; on retry, returns the stored response. Stripe
   does this on every mutating `POST`; its SDK auto-retries "with an
   idempotency key using increasing backoff times and jitter." TTLs:
   ~24h for API requests, ~7d for queue consumers.
   [stripe.com/blog/idempotency](https://stripe.com/blog/idempotency) ·
   [backendbytes.com/articles/idempotency-patterns-distributed-systems](https://backendbytes.com/articles/idempotency-patterns-distributed-systems/)
2. **Transactional Outbox** (producer side) — solves the dual-write
   problem: write the domain change **and** the event row in **one local
   DB transaction**; a poller publishes from the outbox to the broker.
   Delivery is guaranteed iff the transaction committed — no lost events,
   no phantom events.
3. **Inbox / consumer dedup** — consumer stores processed **event IDs**
   (not broker offsets) behind a unique constraint; a duplicate delivery
   hits the constraint and is skipped. This converts at-least-once into
   effective exactly-once *at the processing boundary*.
   [dev.to/actor-dev/inbox-pattern-51af](https://dev.to/actor-dev/inbox-pattern-51af)

**Why best-in-world:** Outbox+Inbox+Idempotency-Key is the *only*
combination that survives the dual-write problem, broker redelivery, and
client retries simultaneously — it is the reason Stripe can promise a
charge is created exactly once even when the network lies.

> **Borjie mapping — already a hard rule.** `CLAUDE.md`: "Webhook delivery
> is at-least-once. Consumers MUST be idempotent via `Idempotency-Key`,"
> and "Money path goes through `LedgerService.post()`" (the natural
> idempotency/outbox seam). `base-connector.ts` has **idempotency-key
> passthrough**. The MEMORY index references `event_outbox` as a
> schema-drift item — **confirm the outbox table + poller actually exist
> and are wired** for the ledger and connector event paths; if
> `event_outbox` is schema-ahead-of-migration (per the live-DB-migration
> memory), the at-least-once guarantee is currently *aspirational*. This
> is the highest-priority correctness gap to verify.

---

## 7. Chaos engineering + load/soak testing (PROVING capacity)

### 7.1 Principles of Chaos Engineering (the formal discipline)

"Chaos Engineering is the discipline of experimenting on a system in order
to build confidence in the system's capability to withstand turbulent
conditions in production." The five advanced principles:

1. **Build a hypothesis around steady-state behavior** (measure
   *output*/SLIs, not internals).
2. **Vary real-world events** (prioritize by impact × frequency).
3. **Run experiments in production** (only place that's authentic).
4. **Automate experiments to run continuously.**
5. **Minimize the blast radius** (the chaos engineer's obligation).

[principlesofchaos.org](https://principlesofchaos.org/)

Lineage: **Chaos Monkey** (Netflix, 2011) randomly terminates instances in
prod; **Gremlin** productized controlled fault injection (latency, packet
loss, regional outage, memory/CPU pressure, container crash) with safety
controls and blast-radius limits; **Game Days** are scheduled, human-in-
the-loop fire drills that test *both* the system and the incident-response
process.
[gremlin.com/chaos-engineering](https://www.gremlin.com/chaos-engineering) ·
[en.wikipedia.org/wiki/Chaos_engineering](https://en.wikipedia.org/wiki/Chaos_engineering)

### 7.2 Load testing taxonomy + capacity proof (k6 / Gatling)

You cannot *claim* capacity; you must *find the breakpoint*. The test
types (Grafana k6 taxonomy):

- **Smoke** — minimal load, sanity that the script + system work.
- **Load** — expected peak; verify SLOs hold.
- **Stress** — beyond peak; observe degradation behavior.
- **Spike** — sudden surge (the Black-Friday / viral test); does load-
  shedding + autoscale kick in gracefully?
- **Soak** — sustained hours/days; surfaces **memory leaks, connection-
  pool exhaustion, disk fill** — the slow killers.
- **Breakpoint** — ramp to absurd levels until thresholds fail; "this is
  the system's limit."

[grafana.com/load-testing/types-of-load-testing](https://grafana.com/load-testing/types-of-load-testing/) ·
[grafana.com/blog/2023/02/14/load-testing-grafana-k6-peak-spike-and-soak-tests](https://grafana.com/blog/2023/02/14/load-testing-grafana-k6-peak-spike-and-soak-tests/)

**k6** encodes the pass/fail directly as **Thresholds** (e.g.
`http_req_duration: p(95)<500`, `http_req_failed: rate<0.01`) with
`abortOnFail` for CI, and **scenarios** to run baseline+spike+soak
simultaneously with per-scenario thresholds. VUs are goroutines → very low
overhead. **Gatling** (Scala/Java DSL) shines for very high concurrency on
minimal hardware. **k6 is the 2026 default** for JS-native teams and
turnkey CI/CD; pick Gatling for extreme VU counts.
[ardura.consulting/blog/load-testing-complete-guide-2026](https://ardura.consulting/blog/load-testing-complete-guide-2026/) ·
[k6.io](https://k6.io/)

You can also **inject faults inside the load test** (k6 + xk6-disruptor /
LitmusChaos) so capacity *and* resilience are proven in one run — measure
SLOs *while* a dependency is failing.
[steadybit.com/blog/more-than-performance-testing-chaos-engineering-k6](https://steadybit.com/blog/more-than-performance-testing-chaos-engineering-k6)

**Why best-in-world:** k6 Thresholds turn a load test into an
*executable SLO contract that fails the build* — it is the only
mainstream tool where "prove capacity" is a CI gate, not a slide deck, and
it composes with fault injection to prove graceful-at-the-limit in one
shot.

> **Borjie mapping.** Borjie has `evals/pms-bench-1` with an SLO stream
> writer and JSONL SLO events, plus `sandbox-load-test.yml` (1000-
> concurrent isolated-vm runs). **Gaps:** no k6/Gatling **breakpoint +
> soak** suite against the api-gateway, and no spike test that *asserts*
> the load-shedder preserves critical-class availability (the Netflix
> 99.4% receipt). Add a k6 scenario suite: (1) breakpoint to find gateway
> RPS ceiling; (2) 6-hour soak to catch PgBouncer/connection-pool leaks;
> (3) spike test with `http_req_failed{class:critical}: rate<0.001`
> threshold + an injected LLM-provider 503 to prove brain SWR degradation.

---

## 8. SLO / error-budget operations

- **SLI** = a measured ratio (good events / valid events). **SLO** = the
  target (e.g. 99.9%). **Error budget** = `1 − SLO` (0.1% = ~43 min/month)
  — the *permission to fail* that you spend on velocity.
- **Burn rate** = how fast you're spending budget relative to the SLO. The
  MWMBR table (§5.2) is the operational interface.
- **Error-budget policy**: budget remaining → ship features; budget
  exhausted → **freeze risky changes, prioritize reliability** until it
  recovers. This is the negotiated, blameless lever that aligns dev
  velocity with reliability.
  [datadoghq.com/blog/burn-rate-is-better-error-rate](https://www.datadoghq.com/blog/burn-rate-is-better-error-rate/)
- **Low-traffic services** (very relevant to a Tanzania-launch tenant with
  modest QPS): a single failure produces a huge burn rate. Mitigations:
  generate synthetic traffic, aggregate related services into one SLO,
  rely on client retries, or relax the SLO target.
  [sre.google/workbook/alerting-on-slos](https://sre.google/workbook/alerting-on-slos/)
- **Request-class SLOs over per-service SLOs**: Google advises bucketing
  all traffic into **CRITICAL / HIGH_FAST / HIGH_SLOW / LOW / NO_SLO** and
  applying the *same* alerting params across services — not bespoke per
  service. This is the operational twin of priority-based load shedding.

> **Borjie mapping — already strong.** `Docs/KPIS_AND_SLOS.md`,
> `Docs/RUNBOOKS/sub-md-slo-breach.md`, `Docs/OPS/SLO_ATTESTATION`,
> `infra/observability/grafana/dashboards/sub-md-slos.json`,
> `packages/proactive-intel/.../slo-breach.detector.ts`, and the
> autonomy-governance `slo-monitor` (min-sample-size=10, 5% tolerance
> anti-flap) give Borjie real error-budget machinery. **Action:** add an
> explicit **error-budget *policy*** (freeze rule) and convert the breach
> detector to MWMBR so a single bad sub-MD run can't trip a page (the
> low-traffic-service trap above is acute for Borjie's per-tenant scale).

---

## 9. PgBouncer / connection-pool as an overload boundary

The database is usually the true scarcity. Each Postgres client connection
forks an OS process, so an external pooler is "non-negotiable for
production." Use **transaction-mode** pooling (a connection is held only
for the duration of a transaction) so ~20 server connections serve
hundreds of app connections. Set `statement_timeout` to kill runaway
queries (e.g. 5 min) and `idle_in_transaction_session_timeout` (e.g. 60s)
so a stuck client can't pin a connection. Sizing heuristic:
`pool_size ≈ (cpu_cores * 2) + effective_spindle_count`; keep a small
`reserve_pool_size` (5–10) for overload bursts. **Gotcha:** a session-set
`statement_timeout` returned to the pool **leaks into the next client** —
reset on checkin.
[pgbouncer.org/config.html](https://www.pgbouncer.org/config.html) ·
[percona.com/blog/pgbouncer-for-postgresql-how-connection-pooling-solves-enterprise-slowdowns](https://www.percona.com/blog/pgbouncer-for-postgresql-how-connection-pooling-solves-enterprise-slowdowns/)

> **Borjie mapping.** Borjie runs **Supabase Postgres + FORCE-RLS** with
> `app.current_tenant_id` bound per request — RLS GUCs are session/txn
> scoped, so **transaction-mode pooling must not leak the tenant GUC
> across requests** (set it inside the same transaction, `SET LOCAL`).
> Supabase's pooler is **Supavisor**; confirm transaction mode + per-tenant
> GUC binding under pooling is correct, or RLS + pooling will silently
> cross tenants under load. This is a security-AND-reliability boundary.

---

## 10. Borjie hardening backlog (ranked by impact × gap)

| # | Action | SOTA source | Borjie file/seam | Status |
|---|--------|-------------|------------------|--------|
| 1 | **Verify `event_outbox` + poller exist & are wired** for ledger/connector events (at-least-once is a hard rule but may be schema-ahead) | Outbox/Inbox §6 | `LedgerService.post()`, `event_outbox` | **CRITICAL — verify** |
| 2 | **Confirm Supavisor transaction-mode + per-txn RLS GUC** (no tenant leak under pooling) | §9 | gateway auth middleware, RLS | **CRITICAL — verify** |
| 3 | Add **token-bucket retry budget** (0.1 deposit / 1 consume, <10% cap) | Brooker §3.3 | `base-connector.ts` retry | **gap** |
| 4 | Per-tenant **Redis token bucket + fleet reservation** for critical (payments/kill-switch) vs non-critical | Stripe §2.1 | gateway middleware | **gap** |
| 5 | **CoDel/adaptive-LIFO** admission queue at ingress (5ms/100ms) | Facebook §1.1 | `api-gateway/src/index.ts` | **gap** |
| 6 | Switch jitter from ±20% to **AWS Full Jitter** | AWS §3.2 | `base-connector.ts:jitter()` | **easy win** |
| 7 | **Bulkheads** isolating brain / payments / connectors thread+conn pools | Resilience4j §3.1 | runtime pools | **gap** |
| 8 | **Brain SWR**: serve last-good recommendation+evidence when kernel shed / LLM circuit-open | Cloudflare §4 | brain kernel cache | **gap** |
| 9 | Adopt **MWMBR burn-rate** (14.4/6/1) for SLO gate + breach detector | Google §5.2/§8 | `check-prometheus-slo.sh`, slo-breach.detector | **upgrade** |
| 10 | **k6 breakpoint + 6h soak + spike-with-fault** suite asserting critical-class availability | k6 §7.2 | new `evals/` suite | **gap** |
| 11 | **Prioritized load shedding** (CRITICAL/DEGRADED/BEST_EFFORT/BULK) on CPU at service level | Netflix §1.2 | gateway + brain | **gap** |
| 12 | Codify **expand/contract** migration discipline doc | §5.3 | `Docs/`, migration-safety-check.yml | **doc** |

**Already best-in-class in Borjie:** four-pattern base-connector (CB +
RL + retry + idempotency-key), canary-25% → SLO-gate → auto-rollback CD
pipeline, autonomy-governance slo-monitor with anti-flap, Grafana SLO
dashboards, immutable forward-only migrations, FORCE-RLS multi-tenancy,
sandbox load-test harness. The gaps are concentrated in **admission
control (shed/backpressure), retry-budget amplification bounds, and
empirical capacity proof** — i.e. the "behavior at the limit" half of the
problem.

---

## Sources (all fetched / searched 2026-06-08)

1. Google SRE Workbook — Alerting on SLOs (MWMBR, 6 approaches, burn-rate table): https://sre.google/workbook/alerting-on-slos/
2. Google SRE Book — Handling Overload (adaptive throttling, criticality, retry budgets): https://sre.google/sre-book/handling-overload/
3. Netflix — Service-Level Prioritized Load Shedding (InfoQ 2024): https://www.infoq.com/news/2024/11/netflix-load-shedding/
4. Netflix — Prioritized Load Shedding @ QCon SF 2025 (InfoQ): https://www.infoq.com/news/2025/11/netflix-prioritized-loadshedding/
5. Netflix — Performance Under Load / Adaptive Concurrency Limits: https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581
6. Facebook "Fail at Scale" — CoDel + adaptive LIFO (the morning paper): https://blog.acolyer.org/2015/11/19/fail-at-scale-controlling-queue-delay/
7. AWS — Exponential Backoff and Jitter (formulas + simulation): https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
8. AWS Builders' Library — Timeouts, Retries, and Backoff with Jitter: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/
9. Marc Brooker — Fixing retries with token buckets and circuit breakers: https://brooker.co.za/blog/2022/02/28/retries.html
10. Stripe — Scaling your API with rate limiters (4-layer stack): https://stripe.com/blog/rate-limiters
11. Stripe — Designing robust and predictable APIs with idempotency: https://stripe.com/blog/idempotency
12. Resilience4j — Circuit Breaker, Retry & Bulkhead (Mobisoft): https://mobisoftinfotech.com/resources/blog/microservices/resilience4j-circuit-breaker-retry-bulkhead-spring-boot
13. Principles of Chaos Engineering: https://principlesofchaos.org/
14. Gremlin — Chaos Engineering: https://www.gremlin.com/chaos-engineering
15. Chaos Engineering — Wikipedia (history/lineage): https://en.wikipedia.org/wiki/Chaos_engineering
16. Argo Rollouts — Analysis & Progressive Delivery: https://argo-rollouts.readthedocs.io/en/stable/features/analysis/
17. InfraCloud — Progressive Delivery with Argo Rollouts canary analysis: https://www.infracloud.io/blogs/progressive-delivery-argo-rollouts-canary-analysis/
18. Cloudflare — Cache Revalidation (stale-while-revalidate / stale-if-error): https://developers.cloudflare.com/cache/concepts/revalidation/
19. Cloudflare — Async stale-while-revalidate changelog (2026): https://developers.cloudflare.com/changelog/post/2026-02-26-async-stale-while-revalidate/
20. Datadog — Burn rate is a better error rate: https://www.datadoghq.com/blog/burn-rate-is-better-error-rate/
21. Grafana k6 — Types of load testing: https://grafana.com/load-testing/types-of-load-testing/
22. Grafana k6 — Peak, spike, and soak tests: https://grafana.com/blog/2023/02/14/load-testing-grafana-k6-peak-spike-and-soak-tests/
23. ARDURA — Load testing complete guide 2026 (k6 vs Gatling vs JMeter): https://ardura.consulting/blog/load-testing-complete-guide-2026/
24. k6 (Grafana) homepage: https://k6.io/
25. Steadybit — k6 + chaos engineering (fault injection in load tests): https://steadybit.com/blog/more-than-performance-testing-chaos-engineering-k6
26. Expand/Contract in practice (Reliable Penguin, 2025): https://blogs.reliablepenguin.com/2025/11/16/database-migrations-without-drama-expand-contract-in-practice
27. Expand and Contract pattern for zero-downtime migrations (DEV): https://dev.to/jp_fontenele4321/the-expand-and-contract-pattern-for-zero-downtime-migrations-445m
28. Idempotency, At-Least-Once Delivery, Outbox/Inbox (System Overflow): https://www.systemoverflow.com/learn/design-fundamentals/communication-patterns/idempotency-at-least-once-delivery-and-the-outbox-inbox-pattern
29. Idempotency Patterns: Building Retry-Safe Distributed Systems (BackendBytes): https://backendbytes.com/articles/idempotency-patterns-distributed-systems/
30. Inbox Pattern for consumer dedup (DEV): https://dev.to/actor-dev/inbox-pattern-51af
31. Designing for Noisy Neighbors — multi-tenant limits + WFQ (systemdr): https://systemdr.substack.com/p/designing-for-noisy-neighbors-multi
32. Gravitee — API rate limiting at scale: patterns & strategies: https://www.gravitee.io/blog/rate-limiting-apis-scale-patterns-strategies
33. PgBouncer config reference: https://www.pgbouncer.org/config.html
34. Percona — PgBouncer connection pooling for PostgreSQL: https://www.percona.com/blog/pgbouncer-for-postgresql-how-connection-pooling-solves-enterprise-slowdowns/
</content>
</invoke>
