# THE SOTA LAZY-LOAD ARCHITECTURE

**Instant shell · streamed intelligence · deferred-not-dropped**

**Date:** 2026-06-09
**Author:** synthesis subagent (Opus 4.8, 1M) — workflow-orchestrated
**Status:** master dossier. No code, no commit. The buildable plan.
**Synthesizes:**
- `Docs/research/lazy-frontend-sota.md` (FE) — PPR/Suspense/code-split/prefetch
- `Docs/research/lazy-backend-coldstart-sota.md` (BE) — lazy composition/cold-start
- `Docs/research/lazy-brain-progressive-sota.md` (BRAIN) — progressive intelligence
- `Docs/research/lazy-our-loading-audit.md` (AUDIT) — our concrete hotspots

> **Owner directive (the law this document serves).** "WE ARE ALWAYS
> LOADING SUPER FAST BUT KEEPING FULL INTELLIGENCE AND LOGIC." Fast =
> **DEFERRED / STREAMED / PROGRESSIVELY-ENHANCED**, never capability
> dropped or intelligence degraded.

---

## 1. THE PRINCIPLE

Borjie is an AI-native mining-estate OS whose differentiator is a deep
12-agent brain (`packages/central-intelligence`), persona copilots
(`packages/ai-copilot`), and streamed generative UI (`packages/genui`,
`packages/chat-ui`, `ArtifactRenderer`) wired through a Hono BFF whose
composition root binds **hundreds** of ports at boot. The risk of all
that depth is that depth feels *slow*. The principle resolves the
tension: **we never make the app shallow to make it fast — we make the
shallow parts instant and let the deep parts stream in honestly.**

Three timelines are held strictly apart on every surface (FE §0,
BRAIN §11):

1. **Shell timeline (0–200 ms perceived) — INSTANT, never blocks.** The
   static chrome, navigation, greeting, composer, and skeletons paint
   and become interactive in **<1 s** from a cached shell. Nothing on
   this timeline waits on the brain, the BFF cold graph, a chart engine,
   or a model token. This is PPR's static prefix on the web (FE §3.1),
   the shell + first screen on mobile (FE §8), and the empty registry
   Proxy on the gateway (BE §1.2).

2. **Data timeline (200 ms–~1 s) — STREAMED holes.** Each independently
   dynamic region (daily brief, KPI strip, live surface) streams behind
   its own Suspense boundary in one HTTP response (FE §2.1, §3.1). A slow
   region can never hold back a fast one.

3. **Intelligence timeline (streams to completion) — HONEST, never
   faked.** The brain's SSE tokens / genui artifacts arrive with a typed,
   **honest status object** (`thinking | retrieving | drafting | eta_ms`),
   carrying their `evidence_id`s (BRAIN §2, §9). The heavy renderer
   (ArtifactRenderer, recharts, maps) is a **lazy chunk** loaded only when
   an artifact actually arrives (FE §5, §9).

**The non-negotiable invariant (TEST = PAYING).** A paying owner must
never receive a *worse answer* because we wanted a faster paint. Every
deferral is **latency relocation, not capability reduction** (BE §0). A
lazily-built `ListingService` is the *same* `ListingService`, born at
first request instead of at `t=0`. A streamed brain answer is the *same*
deep answer, revealed sooner. The only fast things we are allowed to show
are (BRAIN §0): (a) the same correct answer streamed sooner;
(b) honest structure/plan the reasoned content then fills; (c) honest
status. **Never a fabricated fast reply.** The single technique that can
violate this — the cheap-first cascade — ships last, behind a calibrated
deferral gate, and is the subject of an explicit guardrail (§4, BRAIN §4).

**Why this works.** Streaming SSR cuts *perceived* load up to 40 %;
skeletons are perceived ~30 % faster than spinners at identical real load
(FE §7). PPR drops TTFB 4–10× by serving a cached shell (FE §3.1). Lazy
module loading cuts Node bootstrap 40–60 % (BE §0). Prompt-prefix caching
cuts time-to-first-token up to 85 % with zero capability change
(BRAIN §5). None of these touch the answer — they relocate *when* cost is
paid. That is the whole architecture: **pay the heavy cost off the
first-paint path, stream the full intelligence in behind honest status.**

---

## 2. THE LAYER STACK

The lazy strategy at each layer, mapped onto our code, with what we HAVE
(from AUDIT), the eager HOTSPOTS to defer (file:line), and the exact
pattern to apply.

### 2.A FRONTEND — `apps/owner-web`, `apps/admin-web` (Next 15.5/React 18), `apps/buyer-mobile`, `apps/workforce-mobile` (Expo 51/RN 0.74)

**What we HAVE (keep / extend) — AUDIT Part 1, FE §1:**
- `next/dynamic(..., { ssr:false })` already isolates the heavy chat-ui
  bundle (`BorjieWidgetMount.tsx`) and **20+** owner-os panels behind
  `SurfaceSkeleton` (`owner-os/panels/*Panel.tsx`). Root layouts are
  CLEAN — no genui/chat-ui/recharts/framer-motion in the layout bundle
  (AUDIT Part 1.D/1.E).
- `TabSleeper.tsx` is a **hand-rolled `<Activity>`** (unmount inactive
  tab → snapshot, `startTransition` on wake) (FE §2.3).
- `WebVitalsReporter` lazy-loads web-vitals v5 and beacons LCP/INP/CLS —
  the measurement loop exists (FE §1).
- `@borjie/performance-toolkit` has `lazy`/`streaming`/`cache`/
  `bundle-budget`/`yield-and-chunk` — primitives exist, under-wired.
- `next.config.js` uses `optimizePackageImports` + `modularizeImports`
  (lucide) + `transpilePackages`.
- Brain streams via SSE already; TanStack Query is the shared cache.

**Eager HOTSPOTS to defer:**
- **ZERO `loading.tsx` files anywhere in `apps/`** (verified:
  `find apps -name loading.tsx` = 0). This disables route-segment
  streaming AND silently disables Next's *partial prefetch* of dynamic
  routes (which needs a `loading` boundary to know where the static
  prefix ends) (FE §3.2).
- **PPR not enabled** (`experimental.ppr` absent) → the dashboard's
  static greeting/chrome re-renders per request behind the session/brief
  fetch (FE §3.1).
- **`dashboard/page.tsx` (147 lines)** renders `DailyBriefCard`,
  `DashboardBriefSummary`, `OwnerOSShell`, `OwnerDashboardSurface` inline;
  a top-of-page `await getOwnerSession()` gates the *whole* thing
  (FE §2.1).
- **`recharts` (~200 KB), `ArtifactRenderer`, `DOMPurify`** must never sit
  in a route entry chunk; `KpiStripPanel`/`SparklineChart` appear on the
  dashboard LCP path (FE §5).
- **Locale cookie read in the root layout** (`readLocaleFromServerCookies()`)
  poisons the whole tree into dynamic, defeating PPR (FE §3.1).
- **Mobile:** 47 workforce + 12 buyer screens ship as one cold bundle;
  async routes likely off; old RN arch = no TurboModule lazy init (FE §8).

**Exact patterns to apply (FE §2–§9):**
- **`loading.tsx` per route group** rendering existing `SurfaceSkeleton`
  shapes — unlocks instant-nav skeletons AND Link partial-prefetch. (§3.2)
- **One Suspense boundary per independently-dynamic concern** — split the
  dashboard into greeting hero (static shell) + brief + OS shell + live
  surface. NEVER one outer boundary (degenerates to "full SSR + one big
  spinner"). (§2.1)
- **PPR `ppr:'incremental'`** on the dashboard route group, gated behind a
  route-group; move the locale cookie read DOWN into a Suspense-wrapped
  chrome component first. Promote to Next 16 Cache Components later. (§3.1)
- **Lazy-chunk recharts + ArtifactRenderer + DOMPurify**; trigger the
  ArtifactRenderer import on first artifact token, not chat mount; enforce
  with `bundle-budget` in CI. (§5)
- **`<Link prefetch>` tuning + `moderate` Speculation Rules** for the 2–3
  hottest routes (dashboard→cockpit, dashboard→ask); verify bfcache;
  prefer prefetch over prerender on metered Tanzanian mobile. (§3.3, §6)
- **`after()`** for audit-chain append, web-vitals persistence, "mark
  brief seen" — off the response critical path, invariant intact. (§3.4)
- **Shrink client islands** — make static panels (hero, headings, "this
  week" grid) Server Components shipping zero JS; keep chart/slider/
  composer/voice as client islands. (§4)
- **Honest streaming-status contract** rendered identically on every
  surface; size skeletons to the real content box (reserve CLS). (§7)
- **Mobile now:** enable Expo Router **async routes** (per-route split, no
  SDK bump). **Plan SDK 55/56** (New Arch TurboModule lazy init + Hermes
  v1, ~40 % faster Android cold start — material on low-end TZ devices).
  `React.lazy` heavy in-screen charts/maps after first paint via
  `InteractionManager.runAfterInteractions`. (§8)
- **Post React-19:** adopt `use()` (unawaited-promise fetch + Suspense),
  `preinit`/`preconnect` (warm Supabase/BFF TLS + chart chunk), convert
  `TabSleeper` → `<Activity mode>`. (§2.2–§2.4)

### 2.B GATEWAY — `services/api-gateway` (Hono BFF, composition root)

**What we HAVE (the proven lazy templates) — AUDIT Part 3, BE §0:**
- **`composition/db-client.ts` `getDb()`** memoizes a single Drizzle
  client on first call (`if (initialized) return cachedClient`) — a
  textbook lazy singleton. **This shape generalizes to the whole
  registry.** (BE §1.2a)
- **`composition/dynamic-model-registry-wiring.ts`** — the L1/L2/L3
  resolver returns **L3 baselines immediately** (`getModelLatest()` never
  throws), then `warmAllFamilies()` is **fire-and-forget**. This is the
  canonical **"respond now from a safe floor, hydrate the premium layer in
  the background, never block boot"** pattern — the mental model for the
  entire composition root. (BE §0, §6)
- **CrossPortalBus** is a Promise slot resolved lazily when Redis is up;
  boot does not wait; degrades to in-memory EventEmitter honestly.
- In-memory degradation is **honest, never fabricated** (ConversationMemory,
  MemoryV2, AutonomyPolicyService) (AUDIT Part 3.C).

**Eager HOTSPOTS to defer (measured from the code):**
- **`index.ts` is 3,880 lines** (verified) with **282 top-level imports**
  and **97 eager `createX()/wireX()/registerX()` composition calls** that
  fire synchronously *before the server listens* (BE §0).
- **`service-registry.ts` is 3,124 lines** (verified), **73 eager
  `new X(...)`** in one synchronous `buildServiceRegistry()` pass —
  every service built whether or not the first request touches it
  (BE §0; AUDIT HOTSPOT 3, est. 200–400 ms).
- **`index.ts:1342–1374` `wireCognitive()` + `buildCognitiveCompositionDeps()`**
  — embedder resolution, Anthropic composer infer, MemoryV2 6-layer
  substrate, persistent stores — all synchronous at boot, no timeout
  (AUDIT HOTSPOT 1, est. 300–500 ms — the **P0** win).
- **`buildPersonaToolHandlers()` (~index.ts:1670+)** builds 15+ persona
  handlers synchronously (AUDIT HOTSPOT 2, est. 100–200 ms).
- **~20 crons/workers/supervisors** (`idempotency-sweeper`,
  `daily-brief-cron`, `fx-feed-cron`, `webhook-retry-worker`,
  `reminders-dispatch`, `announcement-fanout`, `entity-indexer`,
  `licence-renewal-watcher`, `geofence-watcher`, 3 supervisors)
  registered on the synchronous boot path — **none serves the first
  request** (BE §5).
- **Heavy rarely-first-touched wirings** statically imported:
  `sovereign.ts` (1,131), `orchestrator-bindings.ts` (1,290),
  `mwikila-autonomous-ports.ts` (643), `monthly-close-wiring.ts` (512),
  `predictive-interventions-wiring.ts` (671) (BE §2.3).

**Exact patterns to apply — the three-tier boot plan (BE §6):**
- **Tier A — request-critical, stays eager before `listen`:** OTel
  bootstrap (hard rule: first), Pino, env load, tenant/auth middleware,
  route *table* mounting (cheap fn refs — must be eager; Hono won't accept
  routes after ready, BE §1.4), the brain SSE route handler wiring, the
  money path / `LedgerService.post()`, kill-switch (fail-closed), and the
  **empty memoizing-Proxy `ServiceRegistry` shell** (~free).
- **Tier B — lazy-on-first-use:** the 73 service constructions + the
  long-tail wirings, behind a **memoizing Proxy** whose `get(target,key)`
  trap builds-once-on-first-touch and caches. **Call-sites don't change** —
  `c.get('services').listingService` still works; only construction
  *timing* moves to first request (BE §1.2b). Heavy wirings convert to
  dynamic `import()` at their route seam (→ `import defer` once the
  toolchain ships it — the synchronous-safe module-level lazy primitive,
  BE §2.2).
- **Tier C — background hydration, post-`listen` fire-and-forget:** crons,
  workers, supervisors, cache warmers (`warmAllFamilies()`, single DB
  keep-warm connection, junior prompt-table pre-compile), each in its own
  try/catch that **logs and continues** — exactly the
  dynamic-model-registry shape, generalized (BE §5, §6).
- **The snapshot/lazy split rule (BE §7):** snapshot/eager the *pure
  object graph* (prompt tables, tier→caps catalogs, model L3 baselines,
  routing rules, the registry's factory map); lazy-rehydrate every *live
  handle* (DB pools, M-Pesa/GePG clients, voice sockets, cron timers) —
  snapshots cannot capture open handles. Enables the V8 userland snapshot
  (BE §4.1) without shipping a stub.
- **Runtime levers, ship today:** `node --compile-cache` (Node v22.15
  verified — free bytecode cache across the 282 imports, BE §4.2). Later:
  V8 userland startup snapshot of the pure graph (BE §4.1, ~40 ms→<2 ms
  context creation).
- **Make lazy boot SAFE in K8s:** a `startupProbe` holds the pod out of
  rotation until Tier A is up; keep-warm replicas + `minReplicas`; a
  degraded pool signals readiness failure so a half-hydrated pod never
  receives a request needing a not-yet-hydratable tier (BE §4.4, §8).

### 2.C BRAIN — `packages/central-intelligence` kernel + `packages/ai-copilot`

**What we HAVE (the bones are right) — BRAIN §1, AUDIT Part 3:**
- **Token streaming over SSE** is LIVE — `kernel.thinkStream`
  (`kernel.ts:2025`): `turn_start → text_delta/thought_delta →
  gate_verdict → confidence → done`.
- **Fast-path router** (trivial-turn gate, µs regex) BUILT, env-gated
  `BORJIE_FASTPATH` (**default OFF**).
- **Model tiering** (cheap/standard/deep) BUILT, `BORJIE_MODEL_TIERING`
  (**default OFF**). **TTC allocator** (fast/deliberate/judge/multi-sample)
  BUILT.
- **Semantic cache** (cosine, per `tenant/surface/persona/locale`) BUILT +
  now wired on orchestrator path (`orchestrator-fast-cache.ts`).
  **Brain-side LRU** LIVE (replays a cache hit as one delta,
  `kernel.ts:2117`).
- **genui partial-object streaming** (`StreamingArtifact<T>`,
  `schema → partial* → final`) BUILT; **choreography engine** BUILT;
  **AG-UI emitter** BUILT.
- **Self-RAG retrieve-gate** BUILT. **EstateMind slow loop**
  (PERCEIVE→ORIENT→MOTIVATE→PROPOSE→FORGET) BUILT, leader-elected.

> **The brain gap is NOT capability — it is orchestration + default-on
> wiring** (BRAIN §1). The eight techniques exist as independent flags;
> they don't yet cooperate as one progressive pipeline.

**Eager / blocking HOTSPOTS:**
- **Prompt assembly is not ordered for prefix-cache reuse** — persona +
  the `tenant_id = NULL` mining corpus (the largest, most stable part of
  the prompt) is not pinned behind a cache breakpoint, so it re-ingests
  every turn (BRAIN §5).
- **No skeleton-first emission** — the brain turn does not emit a `schema`
  chunk before reasoning, so genui tabs show a blank spinner not a frame
  (BRAIN §3, §10).
- **RAG can block TTFT** — retrieval not yet streamed in parallel with an
  `evidence_delta` (BRAIN §9).
- **Nothing warms the next turn** — EstateMind computes nudges but does not
  precompute the *reasoned content* of the top-salience nudge during idle
  heartbeats (BRAIN §8).
- **Cognitive composition built eagerly at gateway boot** (AUDIT HOTSPOT 1)
  — couples brain weight to gateway cold start.

**Exact patterns to apply — one progressive pipeline (BRAIN §11):**
1. **t≈0 ms** — `turn_start` + locale-correct persona greeting (single
   language — CLAUDE.md absolute-toggle rule). Prompt-prefix cache makes
   TTFT minimal.
2. **t<50 ms** — emit the **skeleton** (genui `schema` chunk, slots
   pre-allocated) + the honestly-labelled **reasoning channel**
   (`thought_delta`, redacted, collapsible, never mixed into the answer).
3. **In parallel** — fire **lazy RAG** (evidence streams via
   `evidence_delta`) + speculatively **prefetch** the read-only,
   reversible next-turn reads (money/ledger writes NEVER speculated).
4. **t<300 ms** — **cheap-tier provisional answer** streams *only if
   eligible*; else the deep tier streams directly; **semantic-cache hit**
   short-circuits to single-digit ms (with its evidence chain intact).
5. **Deferral gate** on **calibrated** confidence (NOT raw self-report) +
   evidence-chain non-emptiness → `accept` (confirm-in-place) /
   `escalate-deep` (supersede-honestly) / `abstain` (HITL).
6. **Deep pass** (speculative-decoded, distribution-preserving) refines/
   confirms; sections fill their pre-allocated slots; citations land.
7. **`done`** — gated on non-empty evidence; cache-write the
   evidence-backed final; EstateMind precomputes the next nudge.

**Highest-ROI, lowest-risk brain win:** **prompt-prefix cache
restructure (BRAIN §5)** — order the prompt `inviolable/system rails →
tool spec → persona → tenant-invariant corpus → situational/EstateMind →
user message`, breakpoint after the corpus, **1-hour TTL** on
persona+corpus (identical across every user in the tenant). Per-tenant
branding override sits *after* the shared breakpoint so it doesn't bust
the shared prefix. (Watch the Feb-2026 workspace-isolation change.)
Result: dominant input-token cost collapses to ~0.1× read; TTFT improves
up to 85 % on long prompts, every turn, zero capability change.

---

## 3. THE HOTSPOT BURN-DOWN (ranked, heaviest eager offenders first)

| # | Layer | Eager offender (file:line) | Est. cost | Defer fix | Risk |
|---|---|---|---|---|---|
| 1 | GATEWAY | `index.ts:1342–1374` `wireCognitive()`+`buildCognitiveCompositionDeps()` (embedder, Anthropic composer, MemoryV2 6-layer) | **300–500 ms boot** | Lazy-trigger on first `/api/v1/brain/*` via the cognitive-context middleware; honest 202+thinking on cold start; cache once resolved (AUDIT HOTSPOT 1) | Med — middleware must lazily wire before first brain handler reads `c.get('cognitive')` |
| 2 | GATEWAY | `service-registry.ts` (3,124 ln) + `index.ts:1218` — **73 eager `new`** | **200–400 ms boot** | Memoizing-Proxy registry: 73 `new`→first-touch factories (generalize `getDb()`); **call-sites unchanged** (BE §1, AUDIT HOTSPOT 3) | Low–Med — Proxy is transparent; verify no top-level destructuring captures a stale ref |
| 3 | FRONTEND | **Zero `loading.tsx`** in `apps/` (verified) | route nav hangs on server render; partial-prefetch disabled | Add `loading.tsx` per route group rendering `SurfaceSkeleton`; unlocks instant-nav + Link partial-prefetch (FE §3.2) | **Lowest risk, highest leverage** |
| 4 | FRONTEND | `recharts` (~200 KB) + `ArtifactRenderer` + `DOMPurify` on route entry path | ~200–400 KB off LCP chunk | `next/dynamic` all recharts surfaces (incl. `KpiStripPanel`/`SparklineChart`); import ArtifactRenderer on first artifact token; `bundle-budget` CI gate (FE §5) | Low |
| 5 | BRAIN | Prompt assembly not ordered for prefix cache (persona + corpus re-ingested every turn) | **up to 85 % TTFT** + ~0.1× input cost | Reorder prompt; breakpoint after corpus; 1-h TTL on persona+corpus block (BRAIN §5) | **Lowest brain risk, zero behaviour change** |
| 6 | GATEWAY | ~20 crons/workers/supervisors on synchronous boot path | ~timer-registration boot cost | Move to post-`listen` `queueMicrotask`/`setImmediate` fire-and-forget hydration, each try/catch-isolated (BE §5) | Low |
| 7 | FRONTEND | `dashboard/page.tsx` (147 ln) — `await getOwnerSession()` gates whole page; 4 surfaces inline | greeting blocked behind brief/session | Split into 4 Suspense boundaries (hero static + brief + OS shell + live surface) (FE §2.1) | Low |
| 8 | GATEWAY | No PPR / locale cookie read in root layout poisons tree dynamic | re-renders chrome per request | Enable `ppr:'incremental'` gated; move locale cookie read into Suspense-wrapped chrome (FE §3.1) | Med — PPR experimental on 15.5; gate behind route-group |
| 9 | GATEWAY | `buildPersonaToolHandlers()` (~`index.ts:1670+`) — 15+ personas eager | **100–200 ms boot** | Build per-persona on first `/api/v1/brain/turn` scoped to request ceiling; LRU+TTL cache (AUDIT HOTSPOT 2) | Med — `extraSkills` static→lazy getter |
| 10 | GATEWAY | Heavy wirings statically imported (`sovereign` 1,131, `orchestrator-bindings` 1,290, `mwikila-autonomous-ports` 643, `monthly-close` 512, `predictive-interventions` 671) | parse+eval on boot | Dynamic `import()` at route seam (→ `import defer` later) (BE §2.3) | Low — never on `/health` path |
| 11 | BRAIN | Default-OFF flags; no skeleton-first; RAG can block TTFT; no next-turn precompute | perceived latency | Wire `schema`-first chunk (§10), `evidence_delta` lazy-RAG (§9), EstateMind precompute (§8) | Low–Med |
| 12 | MOBILE | 47+12 screens as one cold bundle; old RN arch | cold start | Expo async routes now; plan SDK 55/56 New Arch + Hermes v1 (FE §8) | Low now; Med for SDK bump |
| 13 | RUNTIME | 282 imports re-parsed each boot | parse/compile cost | `node --compile-cache` (Node v22.15 verified — free flag); V8 userland snapshot of pure graph later (BE §4.1–4.2) | Low / High-effort |

---

## 4. GUARDRAILS — fast-load must NEVER drop intelligence

The fast path is only legitimate if it is honest. These guardrails are the
contract (BE §8, BRAIN §0/§4, FE §7, AUDIT Part 5):

1. **Every deferral streams/enhances a CORRECT answer.** A lazily-built
   service is byte-identical to the eager one (BE §1.2 capability proof); a
   streamed brain answer is the same deep answer revealed sooner. Deferral
   is **latency relocation, never capability reduction.** No user path may
   receive a degraded fallback (TEST = PAYING).

2. **Honest loading status, never a fake fast answer.** The brain SSE
   carries a typed `thinking | retrieving | drafting | eta_ms` driven by
   *real* pipeline stages, rendered identically on every surface (web +
   mobile). The reasoning channel (`thought_delta`) is labelled internal,
   redacted, collapsible, never mixed into the answer body, and
   locale-correct (a `sw` user sees a Swahili label — no mixing, ever).
   **Never fabricate a fast answer to mask hydration latency** — the honest
   status *is* the UX support for first-touch hydration on the brain path.

3. **The cheap-first cascade is the one technique that can violate the
   law — gate it.** A cheap-tier answer is *framed provisional*, never
   committed as final. A **deferral gate** runs on **calibrated** confidence
   (NOT raw model self-report, which is poorly calibrated) + evidence-chain
   non-emptiness → `accept` (confirm-in-place) / `escalate-deep`
   (**supersede-honestly** — the only allowed way a fast answer changes,
   rare by construction) / `abstain` (HITL). **High-stakes NEVER cheap-first:**
   anything `stakes ∈ {high,critical}`, any sovereign / kill_switch /
   four_eye / policy_rollout prefix, any money or licence/royalty path skips
   the cascade and goes deep — reuse the existing fast-path refusal predicate
   as the eligibility gate. Ship it **last**, with a calibration set as a
   first-class artifact and false-accept monitoring before widening
   (BRAIN §4).

4. **Lazy composition stays FAIL-SAFE, never silently absent.** A lazy
   service that fails to init must fail *transparently* (the Proxy/getter
   builds it synchronously-or-awaited on first touch and surfaces the error)
   — the forbidden failure mode is a request hitting a not-yet-built tier and
   getting an empty/degraded answer. The **`startupProbe` + three-tier**
   guarantees no request arrives for a tier that depends on something
   not-yet-hydratable; a degraded pool signals readiness failure and pulls the
   pod from rotation (BE §4.4, §8). Tier-C background warmers are try/catch-
   isolated: a warm-failure leaves the *immediately-available safe floor*
   intact (model L3 baselines, lazy services), never blocks boot, never goes
   silently missing.

5. **Hard-rule invariants are Tier A — never behind a lazy boundary a
   paying request could race.** OTel bootstrap first + eager; money path /
   `LedgerService.post()` eager; RLS tenant-binding middleware eager;
   kill-switch fail-closed + eager. Evidence-required output preserved —
   `done` is gated on a non-empty evidence chain; the Auditor still rejects
   empty chains; lazy RAG is "evidence-arriving", never "evidence-skipped".
   Never cache refusals, softened replies, or evidence-empty answers; locale
   in the cache key is load-bearing (an `en` hit never serves a `sw` user).

6. **Measure, don't assert.** Instrument boot phases with OTel spans
   (`tier-a`, `tier-b-first-touch`, `tier-c-hydrate`) + event-loop lag;
   `WebVitalsReporter` already beacons LCP/INP/CLS — make "fast" *proven*.
   Snapshot determinism: fix `--random_seed`, keep snapshot-build free of
   env/clock reads (BE §4.1, §8).

---

## 5. THE BUILD-WAVE PLAN (dependency-ordered; each a measurable perf win)

Each wave is independently shippable, ordered risk-ascending and
dependency-respecting. Metric named per wave.

**WAVE 0 — Free runtime + measurement floor (ship today).**
- `node --compile-cache` on the gateway (Node v22.15 verified) — free
  bytecode cache across 282 imports (BE §4.2).
- OTel boot-phase spans (`tier-a/b/c`) + event-loop-lag; confirm
  `WebVitalsReporter` beacons LCP/INP/CLS to a dashboard.
- **Metric:** baseline **boot-time** + **LCP/INP/CLS** captured; compile-
  cache **boot-time** delta on second boot.

**WAVE 1 — Frontend instant shell (lowest risk, highest leverage).**
- `loading.tsx` per route group (owner-web + admin-web) with
  `SurfaceSkeleton` — unlocks instant-nav skeletons AND Link partial-
  prefetch (FE §3.2).
- Split `dashboard/page.tsx` into 4 Suspense boundaries; hero paints before
  session/brief resolves (FE §2.1).
- Lazy-chunk recharts + ArtifactRenderer + DOMPurify; `bundle-budget` CI
  gate (FE §5).
- **Metric:** **LCP** on dashboard ↓ (hero paints on skeleton); route-entry
  **bundle size** ↓ ~200–400 KB; instant-nav skeleton <100 ms.

**WAVE 2 — Gateway lazy composition (biggest boot win).**
- Memoizing-Proxy `ServiceRegistry`: 73 `new`→first-touch factories
  (generalize `getDb()`); call-sites unchanged (BE §1; HOTSPOT 2).
- Defer cognitive composition to first `/api/v1/brain/*` (HOTSPOT 1).
- Move ~20 crons/workers/supervisors to post-`listen` fire-and-forget
  Tier-C hydration (BE §5).
- `startupProbe` + keep-warm replicas so lazy boot is safe in K8s
  (BE §4.4).
- **Metric:** **boot-time-to-`listen`** ↓ ~600 ms–1 s (cognitive 300–500 +
  registry 200–400); first-request latency for an un-warmed service
  measured (must stay honest, not degraded).

**WAVE 3 — Brain prefix cache + skeleton-first (highest brain ROI, zero
behaviour change).**
- Prompt-prefix cache restructure: order
  `rails→tools→persona→corpus→situational→message`, breakpoint after
  corpus, 1-h TTL on persona+corpus (BRAIN §5).
- Skeleton-first: emit genui `schema` chunk on first token; consume
  `input_json_delta` partials with a partial-JSON-tolerant parser;
  validate against catalog Zod only on `final` (BRAIN §3, §10).
- Honest streaming-status contract as a first-class type across all
  surfaces (FE §7, BRAIN §2).
- **Metric:** **time-to-first-token** ↓ up to 85 % on long prompts;
  input-token **cost** ↓ to ~0.1× read on cached prefix; first-skeleton-
  token latency <50 ms.

**WAVE 4 — Lazy-RAG streaming + prefetch + dynamic-import the heavy
wirings.**
- Lazy-RAG: stream `evidence_delta` in parallel; `done` gated on non-empty
  evidence (BRAIN §9).
- EstateMind precompute the top-salience nudge during idle; safe next-turn
  prefetch of read-only/reversible reads only (BRAIN §8).
- Dynamic `import()` the heavy rarely-first-touched wirings (`sovereign`,
  `orchestrator-bindings`, `mwikila-autonomous-ports`, `monthly-close`,
  `predictive-interventions`) at their route seam (BE §2.3).
- Single DB keep-warm connection in the Tier-C background pass (BE §5).
- **Metric:** brain **TTFT** unblocked from retrieve; **boot-time** further
  ↓ (heavy wirings off boot); proactive cockpit brief pre-computed (open-to-
  content latency).

**WAVE 5 — Instant navigation + mobile shell + volatility-aware cache.**
- `<Link prefetch>` tuning + `moderate` Speculation Rules for hot routes;
  verify bfcache (FE §3.3, §6).
- Expo Router async routes now (per-route split, no SDK bump);
  `React.lazy` heavy in-screen modules after first paint (FE §8).
- Volatility-aware semantic-cache TTLs (stable facts hours, live numbers
  minutes/none); never cache volatile/evidence-empty (BRAIN §6).
- **Metric:** hot-route nav **INP/LCP** near-instant (prerendered);
  back/forward bfcache-instant; mobile **cold-start** ↓ (shell + first
  screen only); semantic-cache **hit-rate** (target 20–45 % real).

**WAVE 6 — PPR + cheap-first cascade (gated) + structural runtime.**
- Enable PPR `ppr:'incremental'` on dashboard route group (gated); move
  locale cookie read out of root layout first; promote to Next 16 Cache
  Components later (FE §3.1).
- Cheap-first cascade behind the deferral/abstention gate — calibration set
  + false-accept monitoring + supersede-honestly UX + high-stakes exclusion
  (BRAIN §4). **Ship last.**
- V8 userland startup snapshot of the pure object graph (BE §4.1); plan
  Expo SDK 55/56 New Arch + Hermes v1 bump (FE §8).
- **Metric:** dashboard **TTFB** ↓ 4–10× (cached shell ~50 ms);
  cheap-tier first-answer <300 ms on the long tail *with confirmed-correct
  guarantee*; context-creation ~40 ms→<2 ms (snapshot).

**Post React-19 upgrade (cross-cutting, after framework bump):** adopt
`use()`, `preinit`/`preconnect`, convert `TabSleeper` → `<Activity>`
(FE §2.2–§2.4). Infra SLA: speculative decoding + warm pools on
cheap/standard tiers — procurement requirement, distribution-preserving so
unconditionally constraint-safe (BRAIN §7).

---

## 6. CLOSING — why this honors the law

Every item above is one of exactly two shapes the owner directive permits:
**pure latency-hiding** (the answer/service is identical, revealed sooner —
PPR, Suspense, code-split, lazy composition, prefix cache, token/partial
streaming, prefetch, speculative decoding) or a **gated cheap-first** that
is *confirmed or visibly superseded* (the one risky technique, shipped last
behind a calibrated gate with high-stakes exclusion). Nothing is stubbed,
nothing degrades, no user path gets a worse answer. The app paints and is
interactive in <1 s; the full brain streams in behind honest status; every
deferred service is born — fully — at first use. **Deferred, never dropped.**
