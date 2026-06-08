# Infinite-Scale Application Architecture — SOTA Dossier

**Author:** Research subagent (Opus 4.8, 1M context)
**Date:** 2026-06-08
**Audience:** Borjie platform/infra owners, LLM coding assistants, SRE
**Scope:** What a system that scales to *millions of tenants/users* under
*heavy, bursty traffic* with *zero breakage* looks like — and the
specific, battle-tested mechanisms that get you there without a
redesign.

> **Thesis.** "Infinite scale" is not a bigger box. It is a *shape*: a
> mesh of **stateless, shared-nothing compute** that any instance can
> serve any request; **decoupled by durable async messaging** so
> producers never wait on consumers; **partitioned into fault-isolated
> cells** so a failure touches a bounded fraction of tenants; **fronted
> by layered caching + edge** so most reads never reach origin;
> **protected by load-shedding/backpressure** so overload degrades
> gracefully instead of collapsing; and **idempotent end-to-end** so
> the at-least-once reality of distributed systems never produces
> duplicates. None of these can be retrofitted cheaply — they are
> *construction-time* decisions. This dossier is the construction manual,
> every claim tied to a primary source actually fetched.

---

## 0. The non-negotiable invariants (the "shape")

A system scales to millions of tenants *without a redesign* iff it
satisfies all of these by construction. Each maps to a section below.

| # | Invariant | Why it is load-bearing | Section |
|---|-----------|------------------------|---------|
| 1 | **Stateless, shared-nothing compute** | Any instance serves any request → linear horizontal scaling, free restarts/relocation | §1 |
| 2 | **Autoscaling on the *real* signal** (queue depth / RPS / concurrency, not just CPU) | CPU lags demand; the work signal leads it; scale-to-zero kills idle cost | §2 |
| 3 | **Async, event-driven decoupling** (queue + outbox + CQRS) | Producers never block on consumers; spikes absorbed by the log, not dropped | §3 |
| 4 | **Idempotency end-to-end** | Distributed delivery is *at-least-once*; without dedup, retries double-charge | §4 |
| 5 | **Layered caching + edge** | The cheapest request is the one that never reaches origin; 99%+ hot-data hit rate | §5 |
| 6 | **Cell-based + shuffle-sharding** | Bounds blast radius to 1/N (or 1/C(N,k)); poison-pill containment | §6 |
| 7 | **Load shedding + backpressure + adaptive concurrency** | Overload sheds the cheap stuff instead of timing out the whole system | §7 |
| 8 | **Partitioned data with high-cardinality keys** | No hot partition; storage scales out by split, not vertical scale | §8 |
| 9 | **Global LB + multi-region + edge state** | User hits nearest healthy region; region loss ≠ outage | §9 |
| 10 | **Capacity planning grounded in queueing theory** | Utilization→latency is *non-linear*; you must leave headroom by math, not vibes | §10 |

---

## 1. Stateless, shared-nothing horizontally-scalable services

**Best-in-world baseline: the Twelve-Factor "processes" factor.** The
canonical statement is that *twelve-factor processes are stateless and
share-nothing; any data that needs to persist is stored in a stateful
backing service, typically a database.* Stateless, share-nothing
processes "are well positioned to take full advantage of horizontal
scaling and running multiple, concurrent instances." Crucially: *"the
twelve-factor app never assumes that anything cached in memory or on
disk will be available on a future request or job"* — even a single
process can be restarted at any moment and lose all local state.
([12factor.net/processes](https://12factor.net/processes))

**Why this is the keystone.** If any instance can serve any request,
the load balancer is free to spray traffic anywhere, autoscalers can
add/remove pods with no drain choreography, and a crashed pod loses
*nothing*. The moment a service pins state to a node (in-process
sessions, local upload scratch, sticky in-memory caches as source of
truth), horizontal scaling becomes *stateful migration* — the thing
that forces redesigns.

**The concrete rules (SOTA, 2026):**
- **Externalize session/state to a backing service** with TTL — Redis
  is the standard: *"Session state data is a good candidate for a
  datastore that offers time-expiration, such as Redis. Never store
  session data or cache in the application process itself."*
  ([pradeepl.com 12-factor guide](https://pradeepl.com/blog/12-factor-cloud-native-apps/))
- **Sticky sessions are a smell, not a strategy.** Stickiness re-couples
  a user to a node and defeats even load distribution; use it only as a
  transitional crutch.
- **No local disk as source of truth.** Object storage (S3/R2/GCS) for
  blobs; the process disk is ephemeral scratch only.
- **Stateless ≠ no caching.** You *can* keep an in-process LRU as a
  performance tier (§5), but it must be a *cache* (rebuildable, never
  authoritative), not state.

> **Borjie note.** The api-gateway BFF already binds tenant via the
> `app.current_tenant_id` GUC per-request from the JWT (CLAUDE.md hard
> rule) — that is exactly the shared-nothing pattern: state lives in
> Postgres + RLS, the gateway process holds nothing across requests.
> Keep it that way; never cache tenant data in a module-level singleton
> that survives requests.

---

## 2. Autoscaling on the right signal — K8s HPA, KEDA, scale-to-zero

**Best-in-world: KEDA (Kubernetes Event-Driven Autoscaling), a CNCF
graduated project.** KEDA "provides event driven scale for any
container running in Kubernetes" and "allows for fine-grained
autoscaling (including to/from zero) for event driven Kubernetes
workloads." ([github.com/kedacore/keda](https://github.com/kedacore/keda),
[keda.sh](https://keda.sh/))

**Why KEDA beats raw HPA for infinite scale.** The Horizontal Pod
Autoscaler scales on CPU/memory — *lagging* indicators that only rise
*after* the system is already saturated, and that never reach zero
(HPA's floor is 1). KEDA inverts this:

- **Scale on the leading work signal.** KEDA scales on *"the number of
  messages in a queue, database connection counts, HTTP request rates,
  or any of the 70+ built-in scalers it supports"* — i.e. it reads
  demand at the source, before latency degrades.
  ([k8s.guide/ecosystem/keda](https://www.k8s.guide/ecosystem/keda/))
- **Scale to zero.** *"Unlike HPA, which maintains a minimum of one
  replica, KEDA can scale your applications down to zero when no events
  are detected... When a deployment scales to zero, all pods are
  removed and consume no cluster resources."* This is how you afford
  *millions of tenants* most of whom are idle most of the time.
- **It rides the native control loop.** KEDA *"serves as a Kubernetes
  Metrics Server"* and *"exposes the External Metrics API so that the
  Horizontal Pod Autoscaler can see non-resource metrics like queue
  length or HTTP requests per second"* — so you get KEDA's signals with
  HPA's proven, stable scaling machinery underneath.

**The two failure modes you must engineer around:**
1. **Cold start tax.** *"Scaling to zero can increase latency due to
   cold starts... When a request comes in, a new instance has to be
   started, increasing latency."* Mitigations: keep a small warm floor
   on latency-critical paths (`minReplicaCount: 1`), use fast-booting
   runtimes, or push truly bursty work behind a queue (§3) so cold
   start is hidden from the user.
2. **Flapping.** *"A reliable KEDA setup requires careful tuning of
   polling intervals and cooldown periods to prevent rapid scaling
   fluctuations."* Set `cooldownPeriod`, `pollingInterval`, and
   stabilization windows deliberately.
   ([oneuptime KEDA pipeline](https://oneuptime.com/blog/post/2026-02-09-keda-driven-auto-scaling-pipeline/view),
   [cloud.google.com — Scale to zero on GKE with KEDA](https://cloud.google.com/blog/products/containers-kubernetes/scale-to-zero-on-gke-with-keda))

**SOTA pattern (2026):** request-driven HTTP services scale on
`http_requests_per_second` or, better, on *in-flight concurrency*;
async workers scale on **queue depth** (the cleanest signal of unmet
demand). Pair KEDA's external-metrics scaling with **cluster
autoscaler / Karpenter** so nodes follow pods. Emit autoscaling
decisions to OpenTelemetry so you can correlate scale events with
latency. ([dash0 — observable KEDA autoscaling](https://www.dash0.com/blog/observable-event-driven-autoscaling-with-keda-opentelemetry-and-dash0))

---

## 3. Async / event-driven decoupling — queues, outbox, CQRS

The single most important architectural move for "absorbs spikes
without breaking" is to **make the write path async and durable**. The
synchronous request does the minimum (validate + persist intent),
everything else happens off a log that *cannot drop work*.

### 3.1 Transactional Outbox — the atomicity fix

The hardest correctness bug in event-driven systems is the *dual write*:
update the DB **and** publish an event, non-atomically — crash between
them and you've lost the event or emitted a phantom. The **transactional
outbox** solves it: *"use an outbox table to keep the message to send
and a message relay process to publish events inserted into the database
to the event backbone."* The event row is written **in the same DB
transaction** as the business change, so they commit or roll back
together. ([confluent — transactional outbox](https://developer.confluent.io/courses/microservices/the-transactional-outbox-pattern/),
[AWS Prescriptive Guidance — transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html))

Properties (Conduktor's precise framing): the outbox gives *"guaranteed
delivery (events are persisted durably before the transaction
commits)"*, *"exactly-once semantics... within the database
transaction"*, and *"decoupled systems (the application doesn't need
direct connectivity to the message broker during transaction
processing)."* But the broker-side guarantee is honest about its limit:
*"the delivery guarantee to the message broker is at-least-once, meaning
every message in the outbox will eventually arrive, but it may arrive
more than once."* **Therefore consumers MUST be idempotent (§4).**
([conduktor — outbox pattern](https://www.conduktor.io/glossary/outbox-pattern-for-reliable-event-publishing))

The relay is implemented two ways:
- **Polling publisher** — a worker `SELECT`s unsent rows, publishes,
  marks them sent. Simple, slightly higher latency.
- **CDC (Change Data Capture)** — tail the DB's replication log
  (Debezium) so the outbox table's inserts stream out with near-zero
  added load and no polling. Debezium's own comparison frames CDC vs
  event sourcing as the two durable-propagation strategies.
  ([debezium — event sourcing vs CDC](https://debezium.io/blog/2020/02/10/event-sourcing-vs-cdc/))

### 3.2 CQRS — separate the write model from read models

The outbox *"enables clean CQRS separation of write and read models."*
([conduktor](https://www.conduktor.io/glossary/outbox-pattern-for-reliable-event-publishing))
CQRS (Command Query Responsibility Segregation) lets you scale reads
and writes **independently** — fan the event stream into purpose-built,
denormalized read stores (search index, cache, analytics rollups, a
read replica shaped for one query). At millions-of-tenants scale this
is essential: read traffic is usually 10–1000× write traffic, and you
do not want both contending on one normalized schema. DDIA places CQRS
and "end-to-end correctness with idempotence" in its derived-data
section precisely because derived read models are how you scale reads
without sacrificing a single authoritative write model.
([O'Reilly — DDIA Part III: Derived Data](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/part03.html))

### 3.3 Streaming backbone — Kafka partitioning at scale (the proof)

The async log must itself scale. **Kafka at LinkedIn is the existence
proof**: *"more than 100 clusters with 4,000 brokers and roughly 7
million partitions, processing over 7 trillion messages per day."*
([factorhouse — how LinkedIn uses Kafka](https://factorhouse.io/articles/linkedin-kafka-architecture))

The mechanics that make this scale:
- **Partition = unit of parallelism.** *"Increasing partition counts is
  the primary lever for producer and consumer throughput on a given
  topic, because partitions are the unit of parallelism."*
- **Ordering is per-partition.** *"Kafka guarantees message ordering
  within a partition"* — so the architectural decision is *single
  partition (strong global order, capped throughput)* vs *many
  partitions (high throughput, order only within partition)*. Choose a
  **partition key** (e.g. `tenant_id` or `aggregate_id`) so that all
  events that must be ordered share a partition, and everything else
  spreads for parallelism.
- **Consumer groups = horizontal consumers.** *"Each partition is
  consumed by exactly one group member, enabling horizontal scaling
  without duplicate processing."* Add consumers up to the partition
  count to scale processing linearly.
  ([factorhouse — Kafka scaling best practices](https://factorhouse.io/articles/kafka-scaling-best-practices),
  [sdcourse — partitioning & consumer groups](https://sdcourse.substack.com/p/day-41-kafka-partitioning-and-consumer))

> **Borjie note.** This is already a CLAUDE.md invariant: *"Webhook
> delivery is at-least-once. Consumers MUST be idempotent via
> `Idempotency-Key`"* and *"AI audit chain is hash-chained,
> append-only."* The outbox + idempotent consumer is the literal
> implementation of those rules. The `event_outbox` table flagged as
> schema-drift in MEMORY.md (`borjie-live-db-migration-state`) is the
> outbox — closing that drift is prerequisite to durable async.

---

## 4. Idempotency at scale — the dedup layer that makes at-least-once safe

Because every durable system (outbox, Kafka, webhooks, retries) is
**at-least-once**, idempotency is not optional polish — it is the thing
that converts "delivered ≥1 times" into "applied exactly once." DDIA:
*"the visible effect in the output is as if [records] had only been
processed once — a principle known as exactly-once semantics... ensured
by idempotent operations."*
([O'Reilly DDIA](https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/part03.html))

### 4.1 Stripe's client contract (the industry reference)

Stripe codifies three principles: *handle failures consistently
(client retries), safely (idempotency keys), and responsibly
(exponential backoff + jitter).* The key insight on key ownership and
the thundering-herd defense: *"introducing random jitter prevents the
thundering herd problem — where synchronized retries from multiple
clients could overwhelm a struggling server,"* with wait time
*"proportional to 2^n where n is the number of failures."*
([stripe.com/blog/idempotency](https://stripe.com/blog/idempotency))

Design rule (from the planet-scale survey): **keys belong to business
intent, not transport attempts**, and *"every key should be scoped by
tenant and operation."* The client owns key generation *"because the
client knows the intent."*
([medium — top 7 idempotency key designs at planet scale](https://medium.com/@bhagyarana80/top-7-idempotency-key-designs-at-planet-scale-fd856c6c6b70))

### 4.2 Brandur's server implementation (the canonical engineering deep-dive)

This is the most precise public design — it makes the server *passively
safe*: *"no matter what kind of failures are thrown at them they'll end
up in a stable state."*
([brandur.org/idempotency-keys](https://brandur.org/idempotency-keys))

Core mechanism — a **DAG of recovery points + atomic phases**:
- A **recovery point** is *"a checkpoint that we get to after having
  successfully executed any atomic phase or foreign state mutation"*
  (e.g. `started → ride_created → charge_created → finished`), persisted
  **on the idempotency-key row** so a crashed process resumes exactly
  where it failed.
- An **atomic phase** bundles all local DB writes between two external
  calls into one ACID transaction. The rule: *"atomic phases should be
  safely committed before initiating any foreign state mutation."*
- The **foreign state mutation problem**: *"once we make our first
  foreign state mutation, we're committed... we've pushed data into a
  system beyond our own boundaries and we shouldn't lose track of it."*
  Local work rolls back; external calls don't — so commit the local
  recovery state *before* the external call, and pass *your own*
  idempotency key down to the external API so retries don't double it.

The Postgres backing schema (key columns):
```sql
CREATE TABLE idempotency_keys (
  id              BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  user_id         BIGINT NOT NULL,
  locked_at       TIMESTAMPTZ DEFAULT now(),   -- in-progress lock
  request_params  JSONB NOT NULL,              -- validate retries match
  response_code   INT,  response_body JSONB,   -- cached response
  recovery_point  TEXT NOT NULL                -- DAG checkpoint
);
CREATE UNIQUE INDEX ON idempotency_keys (user_id, idempotency_key);
```
- **In-progress lock:** if `locked_at` is recent, return `409
  request_in_progress` — only one request works a key at a time
  (enforced under `SERIALIZABLE`).
- **Completion cache:** once `finished`, the stored `response_code` /
  `response_body` short-circuit any retry.
- **Completer (sweeper):** background process scans keys not yet
  `finished` and pushes them to completion even if the client vanished.
- **Reaper:** deletes keys past a horizon (~72h) to bound table growth.

### 4.3 Storage tiering at scale

For hyperscale, the survey prescribes a **two-tier** key store: Redis
with native TTL for the hot retry window (2–24h) for speed, **plus** a
persistent `IdempotencyRecords` table for high-stakes (financial)
operations as the durable system of record.
([medium — planet-scale idempotency](https://medium.com/@bhagyarana80/top-7-idempotency-key-designs-at-planet-scale-fd856c6c6b70))

> **Borjie note.** This is your money-path safety net. CLAUDE.md says
> *"Money path goes through `LedgerService.post()`... the immutable
> double-entry invariant."* Wrap `LedgerService.post()` in exactly this
> idempotency-key envelope (tenant-scoped key, recovery points around
> the M-Pesa/Stripe foreign mutation) so a provider timeout + retry can
> never double-post the ledger.

---

## 5. Caching layers — CDN / edge / Redis, and stampede prevention

Principle: **the cheapest request is the one origin never sees.** The
SOTA is a *layered* cache where each tier is orders of magnitude faster
than the next: *"in-memory LRU → Redis → database... the combined hit
rate for hot data approaches 99%+ under normal load."* The
network-spanning version: *"CDN for global reach, edge KV for dynamic
hot keys, and TTL rules that favor users over elegance."*
([axiom — Node.js caching in production](https://axiom-experiment.hashnode.dev/nodejs-caching-in-production-redis-in-memory-and-cdn-edge),
[medium — caching beyond Redis](https://medium.com/@2nick2patel2/caching-beyond-redis-31690cf725ba))

### The cache-stampede / thundering-herd problem (and the 5 SOTA defenses)

*"When a popular cache key expires, hundreds of concurrent requests can
simultaneously hit your database — this is the cache stampede problem,
also known as thundering herd or the dog-pile effect."* At millions of
users a single hot-key expiry can take down the origin. The
state-of-the-art defenses, ranked:
([oneuptime — Redis cache stampede](https://oneuptime.com/blog/post/2026-01-21-redis-cache-stampede/view))

1. **Request coalescing / single-flight** — *"collapses concurrent
   misses for the same cache key into a single origin fetch... reduces
   origin requests by 90%+ during stampedes."* With an **Origin
   Shield**, *"the parent tier receives all requests but issues only
   one to origin."* This is the strongest structural fix.
   ([1xapi — single-flight pattern 2026](https://1xapi.com/blog/nodejs-cache-stampede-single-flight-pattern-2026))
2. **Probabilistic early expiration (XFetch)** — *"preemptively
   recomputes cache values before they expire, with probability
   proportional to how close to expiry they are"* — so refreshes spread
   out instead of synchronizing on the TTL boundary.
3. **Stale-While-Revalidate** — *"serve slightly stale content (within
   soft TTL) while a background worker refreshes from origin... users
   get a 20–50ms response from stale cache while refresh happens
   asynchronously."* Eliminates user-visible refresh latency. (This is
   also a native HTTP `Cache-Control: stale-while-revalidate`
   directive, honored by CDNs.)
4. **Distributed locking** — first request acquires a lock and rebuilds;
   others wait or serve stale. Serializes rebuilds per key.
5. **TTL jitter** — *"the simplest and most effective defense... adding
   a small amount of randomness to TTL values prevents large numbers of
   keys from expiring simultaneously."* Cheap; always do it.
   ([averagedevs — advanced caching strategies](https://www.averagedevs.com/blog/caching-strategies-redis-cdn),
   [hellointerview — caching](https://www.hellointerview.com/learn/system-design/core-concepts/caching))

**SOTA layout for Borjie:** CDN (static + cacheable GET) → edge KV
(hot dynamic, e.g. tenant config, feature flags) → Redis (shared
app cache, sessions, idempotency hot tier) → in-process LRU (per-pod
hottest keys) → Postgres. Apply jitter at every TTL, single-flight at
the Redis/origin boundary, and SWR at the CDN/edge boundary.

---

## 6. Cell-based architecture + shuffle sharding — bounding blast radius

This is the section that turns "scales" into "scales *without
breaking*." Throughput you can buy; **blast-radius containment** you
must architect.

### 6.1 Cell-based architecture (AWS Well-Architected)

A **cell** is *"a complete workload, with everything needed to operate
independently... independent, does not share state with other cells,
and handles a subset of the overall workload requests."* The math is
the whole point: *"If a workload uses 10 cells to service 100 requests,
when a failure occurs in one cell, 90% of the overall requests would be
unaffected."*
([AWS Well-Architected — what is a cell-based architecture](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/what-is-a-cell-based-architecture.html))

The named components:
- **Cell router** — *"the thinnest possible layer, with the
  responsibility of routing requests to the right cell, and only
  that."* It presents one endpoint and routes by **partition key**
  (customer ID / resource ID) chosen to align with *"the grain of the
  service — the natural way a workload subdivides with minimal
  cross-cell interactions."*
- **Cell** — the full self-contained stack.
- **Control plane** — *"provisioning cells, de-provisioning cells, and
  migrating cell customers."*

The decisive benefit: cells contain failure types that are otherwise
*uncontainable* — *"unsuccessful code deployments or requests that...
invoke a specific failure mode (also known as poison pill requests)."*
A poison-pill request that crashes a worker only crashes *its* cell.
And — critically for cost — *"building a cell-based architecture doesn't
necessarily mean having to double or triple your infrastructure... the
same 30 hosts, but with a cell router and tasks distributed between
cells."*

Operational specifics (InfoQ):
- **Cell sizing is a trade-off**: *"cells should be big enough to cater
  to the largest traffic segment"* (too small can't serve a whale
  tenant) but small enough to keep blast radius low; account for cloud
  *regional and account-level quotas* when sizing.
- **Router must stay thin**: *"the routing layer needs to be as simple
  and horizontally scalable as possible, and complex business logic
  should be avoided as the data plane is a single point of failure."*
  (DNS / API-gateway / consistent-hashing implementations.)
- **Tenant→cell mapping**: full mapping table *or* consistent hashing
  *"that offers a fairly stable allocation of items to buckets"*, with
  an **override** for whales/testing.
- **Deploy in waves across cells** (compartment by compartment) so a bad
  deploy is caught in cell 1 before it touches cell N.
  ([infoq — cell-based architecture](https://www.infoq.com/articles/cell-based-architecture-distributed-systems/),
  [AWS REL10-BP03 — bulkhead architectures](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_fault_isolation_use_bulkhead.html),
  [AWS solutions guidance — cell-based architecture](https://github.com/aws-solutions-library-samples/guidance-for-cell-based-architecture-on-aws))

**Real-world proof:** *"Shopify utilizes a cell-based pod architecture
that shards merchants across multiple independent pods to limit the
blast radius and scale horizontally."*
([educative — architecting SaaS multi-tenancy](https://www.educative.io/newsletter/system-design/architecting-saas-multi-tenancy-for-isolation-and-scale))

### 6.2 Shuffle sharding — combinatorial blast-radius collapse

Plain sharding bounds impact to `1/N`. **Shuffle sharding** bounds it to
`1/C(N,k)` — a *factorial* improvement — by giving each tenant a
*random subset* of `k` cells out of `N`, so that *almost no two tenants
share the same full subset*.

The AWS Builders' Library gives the production numbers from Route 53:
*"2,048 virtual name servers, 4 virtual servers per customer domain,
730 billion possible shuffle shard combinations... no customer domain
will ever share more than two virtual name servers with any other
customer domain."* The consequence: *"if a customer domain is targeted
for a DDoS attack, the four virtual name servers assigned to that domain
will spike, but no other customer's domain will notice."* And it
combines with retries to approach **zero** effective blast radius: *"if
the requestors are fault tolerant and can work around this (with retries
for example), service can continue uninterrupted."*
([AWS Builders' Library — workload isolation using shuffle sharding](https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/))

The intuition (AWS Architecture Blog): *"With eight cells, there are 28
unique combinations of two cells... assign each customer to a shuffle
shard, then the scope of impact due to a problem is just 1/28th — seven
times better than regular sharding."* Generalize: with even modest N
and k, C(N,k) explodes, so a poison-pill or noisy-neighbor failure
overlaps a vanishing fraction of any *other* tenant's shard.
([AWS Architecture Blog — shuffle sharding](https://aws.amazon.com/blogs/architecture/shuffle-sharding-massive-and-magical-fault-isolation/),
reference impl: [awslabs/route53-infima](https://github.com/awslabs/route53-infima))

> **Borjie note.** Map tenants → cells by `tenant_id`, deploy in waves,
> keep the cell router (the Hono gateway / DNS layer) logic-free.
> Borjie's existing RLS already enforces *data* isolation; cells add
> *failure* isolation on top — a bad migration or a poison-pill AI
> request hits one cohort of mining tenants, not all of them. Combine
> with shuffle-sharding for shared dependencies (e.g. the brain-kernel
> worker pool) so one tenant's pathological agent run can't starve
> everyone.

---

## 7. Load shedding, backpressure, adaptive concurrency

When demand exceeds capacity (and at infinite scale it *will*, briefly),
the system must **degrade gracefully**, not collapse. Google SRE's
governing philosophy: *"rejecting some work early is better than letting
everything time out later."*
([Google SRE Book — Handling Overload](https://sre.google/sre-book/handling-overload/))

### 7.1 Google SRE — the overload toolkit (with the exact formula)

- **Measure capacity in resources, not QPS.** The framework *"rejects
  the simplistic queries-per-second model"* and measures *"capacity
  directly in available resources"* (CPU, memory). A good backend
  *"should accept only the requests that it can process and reject the
  rest gracefully."*
- **Request criticality (4 tiers), propagated through the call chain:**
  `CRITICAL_PLUS` > `CRITICAL` (prod default) > `SHEDDABLE_PLUS` (batch)
  > `SHEDDABLE`. Set *"as close as possible to the browsers or mobile
  clients"* and shed lowest-criticality first.
- **Client-side adaptive throttling** — clients self-throttle *before*
  hammering an overloaded backend, using a 2-minute window of
  `requests` vs backend `accepts`:

  > **P(reject) = max(0, (requests − K × accepts) / requests)**, K ≈ 2

  i.e. once a client's requests exceed 2× its accepts, it starts
  dropping locally — *"requests above the cap fail locally without
  reaching the network."* Lowering K → more aggressive.
- **Retry budgets** — *per-request* max 3 attempts; *per-client* retry
  ratio capped at **10%**. When backends see high retry rates they
  return explicit *"don't retry"* errors instead of generic overload,
  breaking the retry-storm cascade.
- **Deadline propagation** — pass the remaining deadline down the call
  chain so a doomed request is abandoned everywhere at once, not
  re-processed by each hop.
  ([Google SRE Book — Handling Overload](https://sre.google/sre-book/handling-overload/))

### 7.2 Netflix — adaptive concurrency limits (self-tuning, no magic numbers)

Static concurrency limits go stale (*"as topology changes due to partial
outages, auto-scaling, or code pushes that impact latency"*). Netflix
discovers the limit dynamically, **borrowing TCP congestion control**:

- **Foundation = Little's Law**: `L = λW` (concurrency = arrival rate ×
  service time) — so the safe concurrency limit *is* a measurable
  quantity, not a guess.
- **Gradient signal**: `gradient = RTT_noload / RTT_actual`. Ratio ≈ 1 →
  no queuing, raise the limit; < 1 → queue forming, lower it. A
  sawtooth that continually probes the boundary.
- **Update rule**: `newLimit = currentLimit × gradient + queueSize`,
  with `queueSize` defaulting to `√(currentLimit)`.
- **No coordination**: each server instance enforces its own limit and
  *"sheds excess load to keep latencies low"* — failure domains stay
  isolated, no central tuning.
  ([Netflix TechBlog — Performance Under Load: Adaptive Concurrency Limits](https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581))

### 7.3 Netflix — prioritized progressive load shedding (the 2024 evolution)

Plain circuit breakers were *"too harsh — an on/off switch that didn't
prioritize important traffic."* Netflix replaced them with
**priority-based progressive load shedding**: under stress, *"only the
least important requests are dropped, keeping streaming
uninterrupted."* This is the synthesis of §7.1's criticality with
§7.2's adaptive limits — shed the cheap stuff *gradually* as pressure
rises.
([Netflix TechBlog — service-level prioritized load shedding](https://netflixtechblog.com/enhancing-netflix-reliability-with-service-level-prioritized-load-shedding-e735e6ce8f7d))

> **Borjie note.** Tag requests by criticality: a money-path
> `LedgerService.post()` or a kill-switch check is `CRITICAL_PLUS`; an
> AI "junior" advisory generation or a marketplace recompute is
> `SHEDDABLE_PLUS`. Under load, shed the AI/analytics first; never shed
> the money path or the fail-closed kill-switch. Enforce per-tenant
> concurrency limits on the brain kernel so one tenant's runaway agent
> loop can't consume the whole worker pool (this *is* the bulkhead at
> the compute layer).

---

## 8. Data layer that scales out — partitioning, sharding, hot-key avoidance

Stateless compute is easy to scale; **the database is where infinite
scale lives or dies.** Two SOTA families:

### 8.1 Retrofit sharding onto Postgres/MySQL — Citus & Vitess

- **Citus** (Postgres extension): *"transparently shard a complex data
  model by the tenant dimension."* Coordinator-worker model; distribute
  + **co-locate by `tenant_id`** so tenant-scoped joins/transactions/FK
  graphs stay single-shard and scale horizontally. Two modes:
  *row-based sharding* for *"a very large number of tenants (B2C with
  >100K tenants)"*; *schema-based sharding* (Citus 12) for *"<10K
  tenants (B2B)."*
  ([github.com/citusdata/citus](https://github.com/citusdata/citus),
  [citusdata — partitioning and sharding](https://www.citusdata.com/blog/2023/08/04/understanding-partitioning-and-sharding-in-postgres-and-citus/),
  [citusdata — Citus 12 schema-based sharding](https://www.citusdata.com/blog/2023/07/18/citus-12-schema-based-sharding-for-postgres/))
- **Vitess** (MySQL, CNCF graduated, built at YouTube): *"battle-hardened
  ... handles shard rebalancing, distributed transaction coordination,
  and high availability."* The MySQL-world equivalent of Citus.
  ([velodb — 7 ways to scale Postgres](https://www.velodb.io/glossary/ways-to-scale-postgresql))

**Sharding only works when** *"data naturally partitions by a key
(tenant, user, workspace) and most queries are scoped to a single
shard. Multi-tenant SaaS is the ideal case."* — which Borjie is.
([velodb](https://www.velodb.io/glossary/ways-to-scale-postgresql))

### 8.2 NewSQL / serverless storage — sharding as a kernel primitive

NewSQL platforms (Spanner, CockroachDB, Yugabyte) and DynamoDB
*"integrate sharding and replication as fundamental primitives of the
storage engine itself"* so rebalancing/HA are automatic. **DynamoDB is
the hyperscale proof** of automatic partitioning:

- **Partition limits**: ~**10 GB** per partition; throughput limits per
  partition are *always enforced* even when table-level burst allows
  temporary over-consumption.
- **Split for heat / split by size**: *"when a table has uneven traffic,
  split for heat can spread items having the same partition key across
  different partitions"* — but it's **blocked by LSIs**, and it can't
  help an *ever-increasing sort key* (timestamps) which stay capped at
  **1,000 WCU**. Detection *"takes several minutes."* **Partitions are
  only split, never merged.**
- **The cardinal design rule**: *"Designing a table schema to have wide
  dispersion (high cardinality) of partition key values will naturally
  spread the data across partitions"*; low-cardinality keys create hot
  partitions.
  ([AWS Database Blog — Scaling DynamoDB Part 3: partitions, hot keys, split for heat](https://aws.amazon.com/blogs/database/part-3-scaling-dynamodb-how-partitions-hot-keys-and-split-for-heat-impact-performance/),
  [InfoQ — DynamoDB: evolution of a hyperscale cloud database](https://www.infoq.com/presentations/dynamodb-scale-aws/))

**The universal lesson, regardless of engine:** *the hardest scaling bug
is the hot partition.* Pick partition keys with high cardinality and no
monotonic skew (avoid raw timestamps / sequential IDs as the partition
dimension; salt or hash if you must range-query time).

> **Borjie note.** Borjie's RLS + `tenant_id` design is *already*
> shard-ready by the tenant grain. The migration path to infinite
> scale is: keep co-locating everything by `tenant_id`; when one
> Postgres can't hold it, introduce Citus row-based sharding by
> `tenant_id` with **zero application changes** (the queries are already
> tenant-scoped). Watch for monotonic hot keys in time-series tables
> (audit chain, ledger, telemetry) — partition those by `(tenant_id,
> time-bucket)` not raw time.

---

## 9. Global load balancing, multi-region, and edge state

### 9.1 Multi-region topology

- **Active-active** (both regions serve writes) minimizes latency
  (*"connect to the nearest region"*) and survives a region loss, but
  forces a **write-conflict resolution** decision. **Active-passive**
  is simpler (one writer) but wastes the standby and has failover lag.
  The governing constraint: *"latency is the primary constraint... a
  trade-off between the speed of light and the cost of consistency."*
  ([calibreos — multi-region HLD](https://www.calibreos.com/learn/hld-multi-region),
  [developers.dev — multi-region active-active guide](https://www.developers.dev/tech-talk/architecting-for-global-scale-the-engineering-guide-to-multi-region-active-active-databases.html))
- **Conflict resolution strategies**, weakest→strongest:
  - *Last-Writer-Wins* — simplest; the DynamoDB Global Tables default.
    Lossy on concurrent writes.
  - *Region affinity / home region* — *"assign each user a canonical
    home region... the home region owns all writes while other regions
    replicate asynchronously for read availability."* This is usually
    the right SaaS answer: pin each *tenant* to a home region (it also
    maps cleanly onto cells §6 and data-residency law).
  - *CRDTs (Conflict-free Replicated Data Types)* — *"updated
    independently and concurrently without coordination... write-write
    conflicts merged independently on each region with eventual
    consistency,"* giving *"local latency on read and write regardless
    of the number of geo-replicated regions."* Used by Redis
    Active-Active (CRDB) and Amazon MemoryDB Multi-Region.
    ([redis.io/active-active](https://redis.io/active-active/),
    [AWS Database Blog — MemoryDB Multi-Region](https://aws.amazon.com/blogs/database/build-low-latency-resilient-applications-with-amazon-memorydb-multi-region/),
    [oracle — Global Active Tables & CRDT](https://blogs.oracle.com/nosql/global-active-tables-and-conflict-free-replicated-data-type-crdt))
- **Global LB**: anycast + health-checked DNS / global load balancers
  route users to the nearest *healthy* region; the cell router (§6) can
  itself be regional/global. *"Active-active reduces user latency by
  connecting to the nearest region."*

### 9.2 Edge compute — pushing logic and state to the user

**Cloudflare Workers** is the best-in-world serverless-edge primitive
because it eliminates the two costs that break traditional serverless:
cold starts and region selection.

- **V8 isolates, not containers**: *"start in under 5ms... ~3–5 MB
  memory... thousands of isolates on a single server,"* effectively
  *"eliminating cold starts."* Isolation is *"hardware-enforced memory
  isolation between tenants... isolates share only the V8 engine code
  which is read-only."*
- **Deploy everywhere at once**: *"unlike traditional serverless that
  require region selection, Workers deploys code identically across all
  locations simultaneously"* — 330+ cities, *"Time to First Byte under
  50ms worldwide."*
  ([digitalapplied — Cloudflare Workers 2026](https://www.digitalapplied.com/blog/edge-computing-cloudflare-workers-development-guide-2026),
  [medium — Cloudflare Workers complete platform](https://medium.com/@ltwolfpup/cloudflare-workers-the-complete-serverless-edge-computing-platform-40a113164ab6))

**Durable Objects** solve the hardest edge problem — *consistent state
at the edge*. Each is a **single-threaded actor** with *"its own
durable, transactional, strongly consistent storage (up to 10 GB)...
accessible only within that object"*, with *"single-instance semantics
across the network"* enforced by Cloudflare's control plane mapping
object-ID → physical placement. The 2024 SQLite backend put *"a full
embedded relational store inside each object"* on local SSD — *"no
network round trip for hot reads or writes within a transaction."*
([Cloudflare docs — What are Durable Objects](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/),
[lambrospetrou — Durable Objects: unlimited single-threaded servers](https://www.lambrospetrou.com/articles/durable-objects-cloudflare/))

This is profound for scale: a Durable Object is *a cell of one* — a
strongly-consistent, serialized coordination point per entity (per
tenant, per chat room, per mining-site) that scales horizontally to
*millions* of objects because each is tiny and independent. It is the
edge-native realization of both the actor model and cell-based isolation.

> **Borjie note.** The repo already has `EDGE_INFERENCE_CLOUDFLARE.md`
> and `ON_DEVICE_MINILM_ROUTER.md` — the natural next step is a Durable
> Object *per tenant* (or per active mining estate) as the
> strongly-consistent coordination point for live state (the
> blackboard / state-bus already built per the task log), with Postgres
> as the durable system of record behind it. Pin each tenant to a home
> region for write affinity + data residency (TZ/KE/UG/NG).

---

## 10. Capacity planning — the math that prevents "it worked in staging"

You cannot eyeball headroom. Utilization → latency is **non-linear**, and
the only way to plan correctly is queueing theory.

### 10.1 Little's Law — the one equation that ties it together

`L = λW` — concurrency = arrival rate × time-in-system. *"If your API
handles 500 req/s with 200ms average response time, Little's Law gives
100 concurrent requests in flight at any moment."* It *"connects
throughput, latency, and concurrency... the reason capacity planning at
Amazon and Stripe is grounded in queueing theory."*
([medium/hackernoon — why capacity planning needs queueing theory](https://medium.com/hackernoon/why-capacity-planning-needs-queueing-theory-without-the-hard-math-342a851e215c),
[Wikipedia — Little's Law](https://en.wikipedia.org/wiki/Little's_law))

This is the *same* `L = λW` Netflix uses to set adaptive concurrency
limits (§7.2) — the connection is exact: the safe concurrency limit and
the capacity plan are two faces of one equation.

### 10.2 The non-linear utilization wall

*"Queueing theory explains how and why a system will start to degrade
non-linearly at high utilization."* As utilization (ρ) approaches 1,
wait time blows up — for an M/M/1 queue, wait time scales as
`1/(1−ρ)`, so going from 80% → 90% utilization roughly *doubles* queue
delay, and 90% → 95% doubles it again. *"When benchmarks measure latency
percentiles, systems almost always perform very badly at their peak
throughput."* **Plan for headroom (typically target ≤ 60–70% steady-
state utilization) so spikes don't cross the cliff.**
([medium/hackernoon](https://medium.com/hackernoon/why-capacity-planning-needs-queueing-theory-without-the-hard-math-342a851e215c))

### 10.3 Universal Scalability Law — why you can't just add nodes

Gunther's **USL** models *real* scaling, including the two forces that
defeat linear scaling: **contention** (serialization, σ) and
**coherency** (cross-node coordination/crosstalk, κ). Its power: it's
*"a black-box technique... it does NOT require any low-level
service-time measurements as inputs"* — fit it to a handful of load
tests and it predicts where adding nodes stops helping (and where
coherency cost makes it actively *worse*). This is what tells you a
shared-everything design has a hard scaling ceiling, and that cells /
shards (which drive κ→0 by eliminating cross-node coordination) are the
escape.
([SolarWinds — capacity planning with the USL](https://orangematter.solarwinds.com/2015/11/13/capacity-planning-with-the-universal-scalability-law/),
[perfdynamics — how to quantify scalability](https://www.perfdynamics.com/Manifesto/USLscalability.html),
[Gunther — A General Theory of Computational Scalability (arXiv:0808.1431)](https://arxiv.org/pdf/0808.1431))

> **Practical capacity drill (SOTA):** (1) load-test to get λ, W per
> service; (2) compute in-flight L via Little; (3) fit USL to find the
> point of diminishing/negative returns → that's your shard/cell
> boundary; (4) size pods so steady-state ρ ≤ ~0.6, letting KEDA (§2)
> absorb the rest; (5) re-derive on every release because code pushes
> change W (exactly Netflix's reason for *adaptive* limits).

---

## 11. Putting it together — the reference shape for "millions, no redesign"

```
                         ┌───────────────────────────────────────┐
   users (millions) ──▶  │ Global anycast LB + CDN (cache, SWR,   │
                         │ jitter, origin shield / single-flight) │  §5,§9
                         └───────────────┬───────────────────────┘
                                         ▼
                         ┌───────────────────────────────────────┐
                         │ Edge: Workers (V8 isolates, no cold    │
                         │ start) + Durable Objects (per-tenant   │  §9
                         │ consistent coordination)               │
                         └───────────────┬───────────────────────┘
                                         ▼
                         ┌───────────────────────────────────────┐
                         │ CELL ROUTER (thin, logic-free; routes  │
                         │ by tenant_id / shuffle-shard)          │  §6
                         └───────┬───────────────┬───────────────┘
                          ┌──────▼─────┐   ┌──────▼─────┐   ...    each cell:
                          │  CELL 1    │   │  CELL 2    │          §1 stateless pods
                          │ stateless  │   │ stateless  │          §2 KEDA autoscale
                          │ svc + KEDA │   │ svc + KEDA │          §7 adaptive concurrency
                          │ +shed/limit│   │ +shed/limit│             + criticality shed
                          └──┬──────┬──┘   └──┬──────┬──┘
        sync write (validate │      │ async   │      │
        + outbox commit) §3,4│      ▼ §3      │      ▼
                          ┌──▼──────────────┐ │  ┌───────────────┐
                          │ Postgres (RLS,  │ │  │ Kafka log      │  §3
                          │ sharded by      │ │  │ (partition by  │
                          │ tenant via      │◀┘  │ tenant/aggr;   │
                          │ Citus) +        │    │ consumer groups│
                          │ OUTBOX table    │───▶│ scale linearly)│
                          │ + idempotency   │ §4 └──────┬─────────┘
                          │ keys            │           ▼ idempotent consumers
                          └─────────────────┘    ┌───────────────┐
                          §8 high-cardinality    │ CQRS read      │  §3
                             partition keys      │ models, search,│
                                                 │ analytics,cache│
                                                 └───────────────┘
```

**The litmus test for "no redesign needed":** to absorb 10× traffic you
should only ever (a) add pods (KEDA does it), (b) add cells (control
plane does it), (c) add Kafka partitions + consumers, (d) add Citus
shard nodes — **never change application code, never change the data
access pattern.** If 10× forces a code change, one of invariants §0.1–10
is violated.

---

## 12. Anti-patterns that *force* a redesign (the failure list)

1. **In-process session / authoritative in-memory state** → can't scale
   horizontally or restart freely (violates §1).
2. **Autoscaling on CPU only** → scales *after* latency already
   degraded; never reaches zero (violates §2).
3. **Dual write (DB + publish, non-atomic)** → lost or phantom events
   under crash (violates §3.1; fix = outbox).
4. **Non-idempotent consumers / no idempotency keys** → at-least-once
   delivery double-applies (double-charge) (violates §4).
5. **Synchronized TTLs / no request coalescing** → one hot-key expiry
   stampedes the origin (violates §5).
6. **One global blast radius (no cells)** → a bad deploy or poison-pill
   takes down 100% of tenants (violates §6).
7. **Circuit-breaker-only overload handling** → on/off harshness sheds
   *critical* traffic indiscriminately; no graceful degradation
   (violates §7).
8. **Low-cardinality / monotonic partition keys** → hot partition caps
   throughput regardless of cluster size (violates §8).
9. **Single-region, single-writer-everywhere** → region loss = outage;
   global users eat speed-of-light latency (violates §9).
10. **Capacity by vibes, running at 90%+ utilization** → spikes cross
    the non-linear latency cliff and cascade (violates §10).

---

## 13. Borjie-specific recommendations (mapped to existing invariants)

| Borjie invariant (CLAUDE.md / MEMORY.md) | Infinite-scale action |
|------------------------------------------|------------------------|
| `LedgerService.post()` immutable double-entry | Wrap in Brandur idempotency envelope (§4.2): tenant-scoped key, recovery points around M-Pesa/Stripe foreign mutation. |
| Webhook delivery at-least-once, idempotent consumers | This *is* outbox + idempotent consumer (§3.1, §4). Close the `event_outbox` schema drift (MEMORY: live-db-migration-state). |
| RLS force-enabled, `app.current_tenant_id` GUC per request | Already shard-ready by tenant grain → adopt Citus row-based sharding by `tenant_id` with zero code change when one PG saturates (§8.1). |
| Kill-switch fail-closed | Tag as `CRITICAL_PLUS`; never shed under load; per-tenant concurrency bulkhead on brain kernel (§7). |
| AI audit chain hash-chained, append-only | High-cardinality partition by `(tenant_id, time-bucket)` to avoid monotonic hot key (§8.2). |
| Multi-currency, TZ launch + KE/UG/NG expansion | Pin each tenant to a **home region** (region affinity, §9.1) for write locality + data-residency law; maps onto cells. |
| Edge inference docs already present | Durable Object per tenant/estate as consistent edge coordination point; Postgres remains system of record (§9.2). |
| Brain kernel / AI "juniors" can be expensive | Mark AI generation `SHEDDABLE_PLUS`; shed before money/kill-switch; adaptive concurrency per tenant so one runaway agent can't starve the pool (§7). |

---

## Sources (all fetched/searched 2026-06-08)

**Stateless / shared-nothing**
- https://12factor.net/processes
- https://pradeepl.com/blog/12-factor-cloud-native-apps/

**Autoscaling / KEDA**
- https://github.com/kedacore/keda
- https://keda.sh/
- https://cloud.google.com/blog/products/containers-kubernetes/scale-to-zero-on-gke-with-keda
- https://www.k8s.guide/ecosystem/keda/
- https://oneuptime.com/blog/post/2026-02-09-keda-driven-auto-scaling-pipeline/view
- https://www.dash0.com/blog/observable-event-driven-autoscaling-with-keda-opentelemetry-and-dash0

**Async / outbox / CQRS / Kafka**
- https://developer.confluent.io/courses/microservices/the-transactional-outbox-pattern/
- https://www.conduktor.io/glossary/outbox-pattern-for-reliable-event-publishing
- https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- https://debezium.io/blog/2020/02/10/event-sourcing-vs-cdc/
- https://www.oreilly.com/library/view/designing-data-intensive-applications/9781491903063/part03.html
- https://factorhouse.io/articles/linkedin-kafka-architecture
- https://factorhouse.io/articles/kafka-scaling-best-practices
- https://sdcourse.substack.com/p/day-41-kafka-partitioning-and-consumer

**Idempotency**
- https://stripe.com/blog/idempotency
- https://brandur.org/idempotency-keys
- https://medium.com/@bhagyarana80/top-7-idempotency-key-designs-at-planet-scale-fd856c6c6b70

**Caching / stampede**
- https://oneuptime.com/blog/post/2026-01-21-redis-cache-stampede/view
- https://1xapi.com/blog/nodejs-cache-stampede-single-flight-pattern-2026
- https://www.averagedevs.com/blog/caching-strategies-redis-cdn
- https://www.hellointerview.com/learn/system-design/core-concepts/caching
- https://axiom-experiment.hashnode.dev/nodejs-caching-in-production-redis-in-memory-and-cdn-edge
- https://medium.com/@2nick2patel2/caching-beyond-redis-31690cf725ba

**Cell-based / shuffle sharding / bulkhead**
- https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/what-is-a-cell-based-architecture.html
- https://www.infoq.com/articles/cell-based-architecture-distributed-systems/
- https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_fault_isolation_use_bulkhead.html
- https://github.com/aws-solutions-library-samples/guidance-for-cell-based-architecture-on-aws
- https://aws.amazon.com/builders-library/workload-isolation-using-shuffle-sharding/
- https://aws.amazon.com/blogs/architecture/shuffle-sharding-massive-and-magical-fault-isolation/
- https://github.com/awslabs/route53-infima
- https://www.educative.io/newsletter/system-design/architecting-saas-multi-tenancy-for-isolation-and-scale

**Load shedding / backpressure / adaptive concurrency**
- https://sre.google/sre-book/handling-overload/
- https://netflixtechblog.medium.com/performance-under-load-3e6fa9a60581
- https://netflixtechblog.com/enhancing-netflix-reliability-with-service-level-prioritized-load-shedding-e735e6ce8f7d

**Data layer / sharding / hot keys**
- https://github.com/citusdata/citus
- https://www.citusdata.com/blog/2023/08/04/understanding-partitioning-and-sharding-in-postgres-and-citus/
- https://www.citusdata.com/blog/2023/07/18/citus-12-schema-based-sharding-for-postgres/
- https://www.velodb.io/glossary/ways-to-scale-postgresql
- https://aws.amazon.com/blogs/database/part-3-scaling-dynamodb-how-partitions-hot-keys-and-split-for-heat-impact-performance/
- https://www.infoq.com/presentations/dynamodb-scale-aws/

**Multi-region / edge / CRDT**
- https://www.calibreos.com/learn/hld-multi-region
- https://www.developers.dev/tech-talk/architecting-for-global-scale-the-engineering-guide-to-multi-region-active-active-databases.html
- https://redis.io/active-active/
- https://aws.amazon.com/blogs/database/build-low-latency-resilient-applications-with-amazon-memorydb-multi-region/
- https://blogs.oracle.com/nosql/global-active-tables-and-conflict-free-replicated-data-type-crdt
- https://www.digitalapplied.com/blog/edge-computing-cloudflare-workers-development-guide-2026
- https://medium.com/@ltwolfpup/cloudflare-workers-the-complete-serverless-edge-computing-platform-40a113164ab6
- https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/
- https://www.lambrospetrou.com/articles/durable-objects-cloudflare/

**Capacity planning / queueing theory**
- https://medium.com/hackernoon/why-capacity-planning-needs-queueing-theory-without-the-hard-math-342a851e215c
- https://en.wikipedia.org/wiki/Little's_law
- https://orangematter.solarwinds.com/2015/11/13/capacity-planning-with-the-universal-scalability-law/
- https://www.perfdynamics.com/Manifesto/USLscalability.html
- https://arxiv.org/pdf/0808.1431

> **Verification note.** Every URL above was returned by a live
> WebSearch or fetched by WebFetch during this research session
> (2026-06-08). Items quoted with exact figures (Route 53's 2,048/4/730B,
> Google SRE's `P(reject)` formula and K=2, Netflix's gradient rule,
> LinkedIn's 7M partitions / 7T msgs/day, DynamoDB's 10GB/1000-WCU,
> Brandur's schema) were drawn from the *fetched* page bodies, not
> search snippets. No item is marked UNVERIFIED.
