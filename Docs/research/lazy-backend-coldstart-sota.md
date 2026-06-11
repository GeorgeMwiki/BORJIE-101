# Lazy Backend Composition + Cold-Start SOTA (June 2026)

**Lane:** `backend-composition-coldstart-SOTA`
**Author:** research subagent (deep online survey, June 2026 sources)
**Scope:** how `services/api-gateway` (Hono BFF, composition root wiring
**hundreds** of ports/services at boot) can boot + first-respond FAST by
**deferring** the wirings to first-use — **without dropping any
capability or degrading any intelligence**.

> **HARD CONSTRAINT (owner directive).** Fast = DEFERRED / STREAMED /
> PROGRESSIVELY-ENHANCED, **never** capability-dropped, never a degraded
> fallback in a user path, never a fake fast answer. The TEST is PAYING:
> a real user paying for the brain must get the full brain — just
> sooner, with honest streaming status (thinking / eta) while the heavy
> graph hydrates. Everything below is *latency relocation*, not
> *capability reduction*. A lazily-instantiated `ListingService` is the
> exact same `ListingService` — it is simply built on the first request
> that needs it instead of at `t=0`.

---

## 0. The Borjie cold-start problem, measured from the code

Concrete facts established by reading the repo (not assumed):

- **`services/api-gateway/src/index.ts` is 3,880 lines** with **282
  top-level `import` statements** and **97 eager
  `createX()/wireX()/registerX()` composition calls** that fire
  synchronously as the module body executes — i.e. *before the HTTP
  server starts listening*.
- **`composition/service-registry.ts` is 3,124 lines** and performs
  **73 eager `new X(...)` constructions** (repos + domain services)
  inside a single synchronous `buildServiceRegistry()` pass. Every one
  is built whether or not the first request touches it.
- The boot also imports + (in many cases) constructs **dozens of crons /
  workers / supervisors**: `idempotency-sweeper`, `daily-brief-cron`,
  `fx-feed-cron`, `webhook-retry-worker`, `reminders-dispatch.worker`,
  `announcement-fanout.worker`, `entity-indexer-worker`,
  `licence-renewal-watcher`, `geofence-watcher`,
  `heartbeat/background/intelligence-history` supervisors, etc.
- Two patterns **already exist as templates** for the fix:
  1. **`composition/db-client.ts`** — `getDb()` memoizes a single
     Drizzle client on **first call** (`if (initialized) return
     cachedClient`). This is a textbook lazy singleton; we should
     generalize its shape across the registry.
  2. **`composition/dynamic-model-registry-wiring.ts`** — the
     `dynamic-registry` L1/L2/L3 model resolver: it returns **L3
     baselines immediately** (`getModelLatest()` never throws), then
     `warmAllFamilies()` is **fire-and-forget** to hydrate the hot
     cache. This is the canonical "respond now from a safe floor, hydrate
     the premium layer in the background, never block boot" pattern — and
     it is exactly the mental model to copy across the whole composition
     root.

The cold-start cost is therefore **eager graph instantiation**: the cost
of building 170+ objects + registering ~20 timers is paid *up front, on
the critical path to "listening"*, even though a given process restart's
**first request touches a tiny fraction** of that graph. Node startup for
a medium app is already ~100–150 ms before any of this user code runs
([NestJS Bun 2026](https://pas7.com.ua/blog/en/nestjs-bun-performance-2026)),
and lazy module loading alone has been measured to cut bootstrap **40–60 %**
([NestJS lazy modules](https://docs.nestjs.com/fundamentals/lazy-loading-modules),
[60 % cold-start reduction case study](https://medium.com/@connect.hashblock/how-i-reduced-cold-start-time-in-nestjs-by-60-with-lazy-module-loading-4d95830d6f6a)).

---

## 1. Lazy composition / lazy dependency-injection (THE primary win)

### 1.1 The principle (2026 SOTA)

> "Lazy loading can decrease bootstrap time by loading only the modules
> required by the specific invocation... load other modules
> asynchronously once the function is warm (deferred module
> registration)." — [NestJS docs](https://docs.nestjs.com/fundamentals/lazy-loading-modules)

The SOTA Node IoC container, **Awilix**, ships **`InjectionMode.PROXY`
as its default**: the container `cradle` is a `Proxy` whose **getters
trigger `container.resolve` on first access** — so even `SINGLETON`-lifetime
services are *constructed on first use, not at registration*
([awilix](https://github.com/jeffijoe/awilix),
[awilix injection modes](https://snyk.io/advisor/npm-package/awilix/functions/awilix.InjectionMode.CLASSIC)).
`fast-inject` markets the same headline: "lazy-loaded services that only
get instantiated if they're used" ([fast-inject](https://github.com/benthepoet/fast-inject)).
Lambda-cold-start guides converge on the identical rule:
*"establish connections / build dependencies lazily on first use rather
than during cold start, using a getter that creates the resource only
when first needed"*
([cold-start dependency loading, Feb 2026](https://oneuptime.com/blog/post/2026-02-17-how-to-reduce-cloud-functions-cold-start-time-by-optimizing-dependency-loading/view)).

### 1.2 The mechanism for Borjie: lazy getters + memoizing Proxy

Two equivalent, capability-preserving mechanisms — pick per call-site:

**(a) Lazy memoized getter (the `getDb()` shape, generalized).** Replace
each eager `const svc = new XService(...)` with a `lazy(() => new
XService(...))` cell that builds-once-on-first-read. The accepted 2026
JS idiom is the **lazy-loading property pattern**: an accessor property
that *redefines itself as a data property* after first read, so the
factory runs exactly once and every subsequent access is a plain field
read ([lazy-loading property pattern](https://humanwhocodes.com/blog/2021/04/lazy-loading-property-pattern-javascript/)).

**(b) Registry Proxy (the Awilix cradle, in-house).** Wrap the
`ServiceRegistry` object in a `Proxy` whose `get(target, key)` trap, on
first access to `key`, invokes the registered factory, caches the
instance, and returns it. Downstream routers already do
`c.get('services').listingService` — **the call-sites do not change**;
only the *timing* of construction moves from boot to first-touch
([Proxy lazy-loading pattern](https://dev.to/jsmanifest/the-power-of-proxy-pattern-in-javscript-6fp),
[Frontend Masters lazy/proxy patterns](https://frontendmasters.com/courses/js-design-patterns/lazy-sync-proxy-middleware-patterns/)).

> **Capability proof.** With either mechanism the registry's *type* and
> *surface* are byte-identical to today. `c.get('services').brainKernel`
> still yields the full kernel. Nothing is stubbed, nothing degrades —
> the object is simply born at request time. This is **deferred**, the
> approved category, not **dropped**.

### 1.3 Concrete Borjie application

- **`service-registry.ts` (73 eager `new`s)** → convert
  `buildServiceRegistry()` to register **factories**
  (`{ listingService: () => new ListingService(...) }`) behind a
  memoizing Proxy. A restart whose first request is `GET /health` or a
  single buyer-mobile listings call then constructs **1–3 services**, not
  73. The `db` handle they share is *already* lazy via `getDb()`, so the
  pool also opens on first DB-touching request, not boot.
- **The 97 `wireX()` calls in `index.ts`** → split into three tiers (see
  §6): **request-critical** (auth, tenant middleware, the brain SSE
  route, core domain routes) stay eager; **lazy-on-first-route** (the
  long tail of domain wirings) become factories resolved by the route
  that needs them; **background** (crons/workers/warmers) move to a
  post-`listen` hydration pass.

### 1.4 Pitfall to respect (Fastify-class constraint)

Routes themselves must still be *registered* before `listen` — Hono, like
Fastify, will not accept new route registration after the server is ready
([Fastify lazy-route limitation](https://docs.nestjs.com/fundamentals/lazy-loading-modules)).
So **lazy applies to the service objects behind a route, not to the route
table.** Keep route mounting eager + cheap (it's just function refs);
defer the *handlers' dependencies*. This is the safe seam.

---

## 2. Lazy ESM dynamic `import()` of heavy modules

### 2.1 The two tools (2026)

1. **`import()` (dynamic import)** — load a heavy module **only when a
   code path needs it**, moving its parse+evaluate cost off the boot
   path. The Lambda-cold-start canon: *"the most impactful optimization
   is lazy-loading dependencies you don't need on every request, by
   importing inside the functions that use them rather than at the top
   of the file"*
   ([cold-start dep loading](https://oneuptime.com/blog/post/2026-02-17-how-to-reduce-cloud-functions-cold-start-time-by-optimizing-dependency-loading/view),
   [Lambda 75 % cold-start cut](https://markaicode.com/lambda-cold-start-optimization-nodejs-18/)).
2. **`import defer * as ns` — TC39 Deferred Module Evaluation, now Stage 3**
   (advanced again Jan 2026), with **Deno experimental support (Apr 2026)**
   and **Bun static-form support**
   ([TC39 proposal](https://github.com/tc39/proposal-defer-import-eval/blob/main/README.md),
   [TC39 advances, socket.dev](https://socket.dev/blog/tc39-advances-key-proposals),
   [Deno import-defer PR](https://github.com/denoland/deno/pull/32360)).

### 2.2 Why `import defer` is the *synchronous-safe* lazy primitive

`import defer` **fully loads + links** the module graph at boot (so it's
"execution-ready" — no async surprise later), but **does not run the
module body** until you **first access a property** of its namespace,
and that first access runs **synchronously**
([defer semantics](https://github.com/tc39/proposal-defer-import-eval/blob/main/README.md)).
For Borjie this is gold: a wiring module's *side-effecting top-level work*
(building registries, compiling prompt tables, constructing adapters) is
**postponed to first property read** with **zero call-site async
refactor**. The model resolver's "L3 baseline now, warm later" ethos,
but at the *module* granularity.

> **Hard limits to honor.** (1) A `defer`-imported module that uses
> **top-level `await`** cannot have its async parts deferred — those
> (and their transitive deps) are **eagerly evaluated**; only the
> synchronous slice is deferred. (2) First property access is
> **synchronous**, so it cannot itself perform async init. Borjie's
> heavy async work (DB connect, model warm) must stay behind the §1
> lazy-getter / fire-and-forget paths, **not** behind `import defer`.

### 2.3 Concrete Borjie application

- **Heavy, rarely-first-touched wirings** (`sovereign.ts` 1,131 lines,
  `orchestrator-bindings.ts` 1,290, `mwikila-autonomous-ports.ts` 643,
  `monthly-close-wiring.ts` 512, `predictive-interventions-wiring.ts`
  671): convert their `index.ts` imports to **dynamic `import()` inside
  the route/first-use seam**, or `import defer` once the toolchain ships
  it, so their parse+eval lands on first touch. These are *never* on a
  `GET /health` path; deferring them is pure boot savings.
- **Optional/per-provider SDKs** (Stripe, M-Pesa/GePG, voice/Realtime,
  media-engine providers): already constructed lazily-per-request in
  their routers per the registry's own doc-comment — formalize this with
  `await import('stripe')` inside the provider factory so the SDK never
  parses on a process that takes zero payments before its next restart.
- **Keep request-critical modules statically imported** (auth, tenant
  middleware, Pino, OTel bootstrap, the brain SSE route) — dynamic import
  adds a microtask + first-call latency, which we do **not** want on the
  hot path.

---

## 3. Tree-shaking + module boundaries

ESM's static `import`/`export` graph lets bundlers "inspect the graph
before running your code" and drop unimported code
([ESM 2026 guide](https://getnerdify.com/blog/what-is-esm),
[dynamic imports + code splitting](https://rune.codes/hub/javascript/dynamic-imports-in-javascript-complete-guide)).
For a **server** the win is subtler than for a browser bundle (Node loads
files from disk, not a network bundle), but module-boundary hygiene is
what *makes lazy possible*:

- **Barrel-file discipline.** The registry's own comments note it uses
  **subpath imports** (`@borjie/domain-services/marketplace`) precisely
  to avoid the top-level barrel's `export *` chains — which *eagerly pull
  the entire domain surface* and were even implicated in TS2709 namespace
  collisions (`DatabaseClient`, `DatabasePoolMode`). **Subpath imports
  shrink the loaded graph per call-site** — keep extending this; a barrel
  `export *` is the enemy of both lazy loading and tree-shaking.
- **346 workspace packages** → enforce that a wiring module imports the
  *narrowest* subpath it needs, so `import()`-ing it later pulls a small
  subgraph, not the whole package.
- Pair with a bundling step (esbuild/Rollup) for the gateway if you ever
  ship a single-file artifact: tree-shaking + the bytecode/snapshot wins
  in §4 compound.

---

## 4. Cold-start optimization at the runtime layer

### 4.1 V8 startup snapshots (biggest structural lever)

V8 snapshots **deserialize a pre-built heap** instead of compiling+running
init scripts: context creation drops from **~40 ms to <2 ms**
([V8 custom startup snapshots](https://v8.dev/blog/custom-startup-snapshots)).
Node embeds a built-in snapshot and **also lets userland build one**
(`node --snapshot-blob`, `v8.startupSnapshot` API) so your *own*
initialization (building registries, compiling prompt/junior tables,
seeding caches) is **captured once at build time and rehydrated at boot**
([Node v8 docs](https://nodejs.org/api/v8.html),
[Joyee Cheung: reproducible Node snapshots](https://joyeecheung.github.io/blog/2024/09/28/reproducible-nodejs-builtin-snapshots-1/),
[Node startup snapshots talk](https://gitnation.com/contents/nodejs-startup-snapshots)).
**Constraint:** snapshot building must be deterministic (fix
`--random_seed`) and **cannot capture open sockets/handles** — so DB
pools, timers, and live connections stay *out* of the snapshot and remain
lazy (§1/§7). The capture-able part is the **pure object graph**:
junior-agent prompt tables, tier→caps catalogs, the model L3 baselines,
static routing rules.

### 4.2 Bytecode / compile cache (cheap, immediate, ship today)

- **Node 22 `module.enableCompileCache()` / `--compile-cache`** persists
  V8 bytecode across runs so module *parsing+compilation* isn't repeated
  on the next boot — directly relevant given **282 imports**
  ([Node loader perf](https://blog.appsignal.com/2025/10/22/ways-to-improve-nodejs-loader-performance.html)).
  Borjie runs **Node v22.15** today, so this is a free flag.
- **Bun 1.3.9 (Feb 2026)** added **ESM bytecode for compiled builds**;
  Evan You benchmarked it **~25 % faster startup than Node SEA with code
  caching** ([Bun bytecode](https://bun.com/docs/bundler/bytecode),
  [Bun 1.3.9 ESM bytecode](https://progosling.com/en/dev-digest/2026-02/bun-1-3-9-parallel-scripts-esm-bytecode)).
  A future runtime swap is a lever, not a requirement.

### 4.3 SnapStart / Firecracker / CRaC (deployment-shape lever)

AWS **Lambda SnapStart** takes a **Firecracker microVM snapshot** of a
fully-initialized environment and **restores from it**, cutting cold start
from seconds to sub-second; chunked 512 KB snapshot restore is
single-digit-ms per chunk
([SnapStart under the hood](https://aws.amazon.com/blogs/compute/under-the-hood-how-aws-lambda-snapstart-optimizes-function-startup-latency/),
[SnapStart 2026 deep dive](https://devstarsj.github.io/2026/03/18/aws-lambda-snapstart-cold-start-guide-2026/)).
**Critical caveat for us:** SnapStart supports **Java, Python, .NET — NOT
Node.js** ([AWS docs](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)).
The JVM analog **CRaC** (Coordinated Restore at Checkpoint) needs hooks to
re-open connections post-restore — the same "restore the object graph,
re-establish live handles lazily" shape we get from V8 snapshots + lazy
pools. **Borjie is Node + Kubernetes (not Lambda)**, so the *transferable*
idea is the **snapshot-then-lazy-rehydrate-handles discipline** (§4.1 +
§7), realized via V8 snapshots and warm pods — not SnapStart itself.

### 4.4 Warm pools / provisioned concurrency (K8s-native)

Borjie deploys via Kubernetes (Kustomize/Helm). The K8s analog of
provisioned concurrency is **keep-warm replicas + `minReplicas` on the
HPA + a `startupProbe`** that holds the pod out of rotation until the
*request-critical* graph is up, while background hydration continues
([readiness/startup probes](https://dev.to/axiom_agent/nodejs-health-checks-readiness-probes-in-production-39bi)).
This makes lazy boot *safe*: a half-hydrated pod never receives a request
that needs the not-yet-built tail (§6).

---

## 5. Connection pooling + deferring non-critical boot work

- **Pools must be lazy + first-request-warmed.** `pg`/postgres-js pools
  "create new clients lazily as needed"; a fresh PG connection costs
  **20–100 ms** (TCP+TLS+auth)
  ([node-postgres pool](https://node-postgres.com/apis/pool),
  [connection pooling 2026](https://oneuptime.com/blog/post/2026-01-06-nodejs-connection-pooling-postgresql-mysql/view)).
  Borjie's `getDb()` already defers pool creation to first DB-touching
  call — **good**. The refinement: warm **one** connection in the
  post-`listen` background pass so the *first real* DB request doesn't eat
  the full handshake, while boot itself stays unblocked.
- **Health/readiness on a separate concern from request metrics.** Run
  health checks so the health server "stays responsive even if the main
  server is overloaded," and have a **degraded pool signal readiness
  failure** to pull the pod from rotation before it times out real
  requests ([health/readiness probes](https://dev.to/axiom_agent/nodejs-health-checks-readiness-probes-in-production-39bi)).
- **Defer non-critical boot work to after first listen.** Move the
  cron/worker/supervisor swarm (idempotency-sweeper, daily-brief,
  fx-feed, webhook-retry, reminders/announcement/entity-indexer workers,
  geofence/licence watchers, the three supervisors) off the synchronous
  boot path into a **`queueMicrotask`/`setImmediate` post-`listen`
  hydration phase**. None of them serves the first request; all are
  background. This is the same **fire-and-forget** discipline the
  dynamic-model-registry already uses for `warmAllFamilies()`.

---

## 6. Request-time lazy resolution + the three-tier boot plan

Synthesizing the above into one capability-preserving boot architecture
for `services/api-gateway`:

**Tier A — request-critical (stays eager, must finish before `listen`):**
OTel bootstrap (hard rule: first), Pino logger, env load, tenant/auth
middleware, route *table* mounting (cheap fn refs), the brain SSE route's
own handler wiring, the memoizing-Proxy `ServiceRegistry` shell (empty
factories, ~free). Target: this is the only work on the path to "ready."

**Tier B — lazy-on-first-use (deferred to the route/first-touch):** the
73 domain-service constructions and the long tail of the 97 wirings,
behind the §1 memoizing Proxy + §2 `import()`/`import defer`. Built the
first time a request actually reaches them; **full capability, just
later.** A `startupProbe` (§4.4) guarantees no request arrives for a tier
that depends on something not-yet-hydratable.

**Tier C — background hydration (post-`listen`, fire-and-forget):** crons,
workers, supervisors, cache warmers (`warmAllFamilies()`, the single DB
keep-warm connection, junior prompt-table pre-compile). Each wrapped in
its own try/catch that **logs and continues** — boot never blocks on
them, and a warm-failure leaves the *immediately-available safe floor*
intact (model L3 baselines, lazy services).

This is precisely the **L3-now / warm-later** shape of
`dynamic-model-registry-wiring.ts`, generalized from one resolver to the
whole composition root.

---

## 7. The snapshot/lazy split rule (one rule to keep it honest)

The single discipline that ties V8 snapshots, SnapStart/CRaC, and lazy
DI together:

> **Snapshot/eager the *pure object graph*; lazy-rehydrate every *live
> handle*.** Pure, deterministic, side-effect-free state (prompt tables,
> tier catalogs, model baselines, routing rules, the registry's factory
> map) is cheap to build and *snapshottable*. Anything holding a socket,
> timer, file descriptor, or external connection (DB pools, M-Pesa/GePG
> clients, voice/Realtime sockets, cron timers) must be **excluded from
> snapshots and built lazily on first use / in the background**, because
> snapshots cannot capture open handles and CRaC needs explicit re-open
> hooks. This is what lets us go fast **without** ever shipping a stub.

---

## 8. Risks, guardrails, and what NOT to do

- **Never lazy-defer something a request silently needs but can't await.**
  Lazy construction must be *transparent* (the Proxy/getter builds it
  synchronously-or-awaited on first touch). The forbidden failure mode is
  a request hitting a not-yet-built tier and getting a **degraded/empty
  answer** — that violates the PAYING test. The `startupProbe` + tiering
  prevents it.
- **Don't hide critical logic behind lazy boundaries "unless the UX
  supports it."** ([ESM startup guidance](https://getnerdify.com/blog/what-is-esm))
  The brain SSE path already streams honest `thinking/eta` status — that
  *is* the UX support for any first-touch hydration latency on the brain
  path. Keep it; never fake a fast answer to mask hydration.
- **`import defer` ≠ async defer.** Don't put DB connect / model warm
  behind `import defer` (first access is sync). Those stay in §1/§5 lazy
  paths.
- **Respect the hard rules:** OTel bootstrap stays first and eager; the
  money path / `LedgerService.post()` and RLS tenant-binding middleware
  are **Tier A** (never deferred behind a lazy boundary that a paying
  request could race). Kill-switch stays fail-closed and eager.
- **Determinism for snapshots:** fix `--random_seed`; keep snapshot-build
  free of env/clock reads, or you bake a stale/incorrect graph.
- **Measure, don't guess:** instrument boot phases with OTel spans
  (`tier-a`, `tier-b-first-touch`, `tier-c-hydrate`) and event-loop lag,
  per 2026 observability practice
  ([microservices observability](https://www.dash0.com/knowledge/microservices-observability)),
  so "fast" is proven, not asserted.

---

## 9. Ranked fast-load wins for Borjie (do in this order)

1. **Memoizing-Proxy `ServiceRegistry`** — turn 73 eager `new`s into
   first-touch factories (generalize the existing `getDb()` pattern).
   Biggest win, zero call-site change, zero capability change.
2. **Move Tier-C crons/workers/supervisors to a post-`listen`
   fire-and-forget hydration pass** — strips ~20 timer registrations off
   the boot critical path.
3. **`node --compile-cache` (Node 22, already running)** — free bytecode
   cache across the 282 imports; ship immediately.
4. **Dynamic `import()` the heavy rarely-first-touched wirings**
   (`sovereign`, `orchestrator-bindings`, `mwikila-autonomous-ports`,
   `monthly-close`, `predictive-interventions`) at their route seam.
5. **`startupProbe` + keep-warm replicas** so lazy boot is safe in K8s.
6. **Single DB keep-warm connection in the background pass** so the first
   real query skips the 20–100 ms handshake.
7. **V8 userland startup snapshot** of the pure object graph (prompt
   tables / tier catalogs / model L3 baselines) — highest-effort,
   structural; do after 1–4 prove out.
8. **`import defer` adoption** once the toolchain ships it stably — the
   synchronous-safe module-level lazy primitive for the wiring tail.
9. **Barrel→subpath import hygiene** across the 346 packages to shrink
   every lazily-loaded subgraph (and fix the `export *` TS2709 class).

---

## Sources

- TC39 Deferred Module Evaluation (`import defer`), README — https://github.com/tc39/proposal-defer-import-eval/blob/main/README.md
- TC39 advances key proposals (defer-import-eval), socket.dev — https://socket.dev/blog/tc39-advances-key-proposals
- Deno `import defer` experimental support PR (Apr 2026) — https://github.com/denoland/deno/pull/32360
- Awilix IoC container (InjectionMode.PROXY lazy cradle) — https://github.com/jeffijoe/awilix
- Awilix injection modes (Snyk) — https://snyk.io/advisor/npm-package/awilix/functions/awilix.InjectionMode.CLASSIC
- fast-inject (lazy-loaded services) — https://github.com/benthepoet/fast-inject
- Reduce cloud-function cold start by optimizing dependency loading (Feb 2026) — https://oneuptime.com/blog/post/2026-02-17-how-to-reduce-cloud-functions-cold-start-time-by-optimizing-dependency-loading/view
- Lambda cold-start cut 75 % (Node.js) — https://markaicode.com/lambda-cold-start-optimization-nodejs-18/
- NestJS lazy-loading modules (deferred registration, warm) — https://docs.nestjs.com/fundamentals/lazy-loading-modules
- NestJS cold-start −60 % via lazy module loading — https://medium.com/@connect.hashblock/how-i-reduced-cold-start-time-in-nestjs-by-60-with-lazy-module-loading-4d95830d6f6a
- NestJS on Bun perf (Node 100–150 ms startup) — https://pas7.com.ua/blog/en/nestjs-bun-performance-2026
- V8 custom startup snapshots (40 ms → <2 ms) — https://v8.dev/blog/custom-startup-snapshots
- Node.js v8 module / startupSnapshot docs — https://nodejs.org/api/v8.html
- Joyee Cheung — reproducible Node.js built-in snapshots (parts 1–3) — https://joyeecheung.github.io/blog/2024/09/28/reproducible-nodejs-builtin-snapshots-1/
- Node.js startup snapshots (talk) — https://gitnation.com/contents/nodejs-startup-snapshots
- AWS Lambda SnapStart (docs, runtime support) — https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html
- AWS Lambda SnapStart under the hood (Firecracker) — https://aws.amazon.com/blogs/compute/under-the-hood-how-aws-lambda-snapstart-optimizes-function-startup-latency/
- AWS Lambda SnapStart 2026 deep dive — https://devstarsj.github.io/2026/03/18/aws-lambda-snapstart-cold-start-guide-2026/
- Bun bytecode caching — https://bun.com/docs/bundler/bytecode
- Bun 1.3.9 ESM bytecode (25 % faster startup vs Node SEA) — https://progosling.com/en/dev-digest/2026-02/bun-1-3-9-parallel-scripts-esm-bytecode
- Node.js loader performance (compile cache) — https://blog.appsignal.com/2025/10/22/ways-to-improve-nodejs-loader-performance.html
- node-postgres Pool (lazy client creation) — https://node-postgres.com/apis/pool
- Node.js connection pooling 2026 (PG handshake cost) — https://oneuptime.com/blog/post/2026-01-06-nodejs-connection-pooling-postgresql-mysql/view
- Node.js health checks & readiness/startup probes — https://dev.to/axiom_agent/nodejs-health-checks-readiness-probes-in-production-39bi
- Lazy-loading property pattern in JS (redefine accessor→data) — https://humanwhocodes.com/blog/2021/04/lazy-loading-property-pattern-javascript/
- Proxy pattern in JS (lazy access) — https://dev.to/jsmanifest/the-power-of-proxy-pattern-in-javscript-6fp
- Frontend Masters — lazy/proxy/middleware patterns — https://frontendmasters.com/courses/js-design-patterns/lazy-sync-proxy-middleware-patterns/
- ESM in 2026 (tree-shaking, startup guidance) — https://getnerdify.com/blog/what-is-esm
- Dynamic imports complete guide 2026 — https://rune.codes/hub/javascript/dynamic-imports-in-javascript-complete-guide
- Microservices observability patterns (Dash0, 2026) — https://www.dash0.com/knowledge/microservices-observability
