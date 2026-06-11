# Lazy-Frontend SOTA — instant shell, streamed intelligence

**Lane:** frontend-loading-SOTA
**Date:** 2026-06-09
**Author:** research subagent (Opus 4.8, 1M)
**Scope:** the 2026 state-of-the-art of making a rich web/mobile app feel
INSTANT while heavy intelligence streams in — mapped concretely onto
`apps/owner-web`, `apps/admin-web` (Next.js 15.5 + React 18),
`apps/buyer-mobile`, `apps/workforce-mobile` (Expo 51 / RN 0.74).

---

## 0. The owner's law, restated as an engineering invariant

> "ALWAYS loading super fast but keeping FULL intelligence and logic."

Fast is **deferred / streamed / progressively-enhanced**, never **degraded**.
The honest test (TEST=PAYING): a paying owner must never get a *worse
answer* because we wanted a faster paint. So the SOTA pattern is a strict
separation of three timelines on every surface:

1. **Shell timeline (0–200 ms perceived):** static chrome, navigation,
   greeting, skeletons — never blocks on the brain, the BFF, or any
   chart engine. Served from cache where possible.
2. **Data timeline (200 ms–~1 s):** per-region dynamic holes stream in
   parallel (daily brief, KPI strip, live surface) each behind its own
   Suspense boundary.
3. **Intelligence timeline (streams to completion):** the brain's SSE
   tokens / genui artifacts arrive with an HONEST status object
   (`thinking | retrieving | drafting | eta_ms`), never a fabricated
   fast answer. The heavy renderer (ArtifactRenderer, charts, maps) is a
   **lazy chunk** loaded only when an artifact actually arrives.

Everything below is in service of holding those three timelines apart.

---

## 1. Current Borjie baseline (what's already true, what's missing)

Grounding from the repo so every recommendation is concrete:

**Already SOTA-aligned (keep / extend):**
- `next/dynamic(..., { ssr: false })` already isolates the heavy chat-ui
  bundle (`apps/owner-web/src/components/BorjieWidgetMount.tsx`) and every
  owner-os panel (`apps/owner-web/src/components/owner-os/panels/*Panel.tsx`)
  behind a `SurfaceSkeleton` loading state.
- A custom `TabSleeper`
  (`apps/owner-web/src/components/owner-os/TabSleeper.tsx`) already
  unmounts inactive tabs and renders a snapshot — this is a hand-rolled
  React `<Activity>` (§2.3); when we reach React 19.2 it should *become*
  `<Activity mode="hidden">`.
- `WebVitalsReporter`
  (`apps/owner-web/src/app/layout.tsx`) already lazy-loads `web-vitals` v5
  and beacons LCP/INP/CLS/TTFB/FCP — the measurement loop exists.
- `@borjie/performance-toolkit` already has `lazy`, `streaming`, `cache`,
  `bundle-budget`, `yield-and-chunk` modules — the primitives exist; they
  are under-wired into the apps.
- `next.config.js` already uses `optimizePackageImports` (lucide,
  design-system, chat-ui), `modularizeImports` for lucide, and
  `transpilePackages` for workspace packages.
- Brain already streams via SSE (`AskBorjieSurface`, `master-brain`,
  `cockpit`, `home-chat/use-chat-mode.ts`).
- TanStack Query is the shared client cache (`app/providers.tsx`).

**Missing (the fast-load gap):**
- **Zero `loading.tsx` files** anywhere in `apps/` → no route-segment
  streaming, no instant-navigation skeleton, and Next's *partial
  prefetch* of dynamic routes is disabled (it needs a `loading` boundary
  to know where the static prefix ends — see §3.2).
- **PPR not enabled** (`experimental.ppr` absent) → the dashboard's static
  greeting/chrome is re-rendered per request behind the session/brief
  fetch instead of shipped as a cached shell.
- **No `<Link prefetch>` tuning and no Speculation Rules** → no instant
  cross-route navigation, no bfcache-grade back/forward.
- **React 18, not 19** → no `use()`, no resource preload APIs
  (`preinit`/`preload`/`preconnect`), no native `<Activity>`.
- **Mobile is Expo 51 / RN 0.74 (old architecture)** → no New-Arch
  TurboModule lazy init, no Hermes v1, async routes likely not enabled.

---

## 2. React layer — Suspense, `use()`, `<Activity>`, resource preload

### 2.1 Suspense is the universal "dynamic hole" primitive
React commits the nearest Suspense `fallback` immediately when a child
suspends, then streams the resolved subtree and *pre-warms* sibling lazy
requests in parallel
([react.dev/blog/react-19](https://react.dev/blog/2024/12/05/react-19)).
This is the mechanism PPR (§3.1), streaming SSR, and route `loading.tsx`
all sit on top of. **The architectural rule: one Suspense boundary per
INDEPENDENTLY-dynamic concern, never one boundary around the whole page**
(a single outer boundary degenerates to "full SSR + one big spinner" — the
PPR docs and DEV deep-dive both flag this as the #1 anti-pattern).

> **Borjie application:** the dashboard
> (`apps/owner-web/src/app/dashboard/page.tsx`) currently renders
> `DailyBriefCard`, `DashboardBriefSummary`, `OwnerOSShell`,
> `OwnerDashboardSurface` inline — they all share the page's render and
> the `getOwnerSession()` await gates the *whole* thing. Split into four
> Suspense boundaries: greeting hero (static shell) + one boundary each
> for brief, OS shell, live surface.
> **FAST-LOAD WIN:** greeting + CTA strip paint at the shell timeline
> (~150 ms) instead of waiting on `/api/v1/owner/brief`; the four data
> regions stream independently so a slow brief can't hold back the KPI
> strip.

### 2.2 `use()` (React 19) — read a promise/Context in render
`use()` lets a component read a promise and suspend until it resolves, and
unlike hooks it can be called conditionally
([react.dev](https://react.dev/blog/2024/12/05/react-19),
[dev.to use() deep dive](https://dev.to/a1guy/react-19-use-hook-deep-dive-using-promises-directly-in-your-components-1plp)).
The SOTA pattern: **kick off the fetch in a Server Component WITHOUT
awaiting, pass the unawaited promise down, and `use()` it inside a
Suspense-wrapped client child.** The fetch starts at the top of the
request; the parent never blocks.

> **Borjie application (post-React-19):** in `dashboard/page.tsx`, start
> `const briefP = fetchBrief()` (no `await`), render the static hero, and
> pass `briefP` into `<Suspense><DashboardBriefSummary briefPromise={briefP}/></Suspense>`
> where the client component does `const brief = use(briefPromise)`.
> **FAST-LOAD WIN:** removes the top-of-page `await getOwnerSession()`
> stall from the LCP path; session and brief fetch in parallel, hero
> paints before either resolves.

### 2.3 `<Activity>` (React 19.2, Oct 2025) — pre-render & keep-warm
`<Activity mode="hidden">` renders a subtree in the background (effects
unmounted, low priority) so switching it to `visible` has **no loading
delay**
([codewithseb React 19.2 guide](https://www.codewithseb.com/blog/react-19-2-release-guide-activity-useeffectevent-ssr-batching-and-more-explained)).
This is the canonical replacement for hand-rolled tab keep-alive and for
"prepare the next screen while the user reads this one."

> **Borjie application:** `TabSleeper.tsx` is *already* an Activity by
> hand (unmount inactive tab → snapshot placeholder, `startTransition` on
> wake). When we adopt React 19.2, replace its mount/unmount logic with
> `<Activity mode={isActive ? 'visible' : 'hidden'}>` so inactive owner-os
> tabs keep their fiber + query cache warm at low priority instead of
> being torn down and re-fetched on every switch.
> **FAST-LOAD WIN:** tab switches become instant (no skeleton flash, no
> re-fetch) while idle tabs still cost ~0 CPU. Also use `<Activity hidden>`
> to pre-render the *likely-next* genui tab spawned by chat in the
> background (matches the existing "genui tabs spawn in the background
> from chat" commit 748ccbeb).

### 2.4 Resource preload APIs (React 19): `preinit` / `preload` / `preconnect` / `prefetchDNS`
React 19 exposes `preinit`, `preload`, `preconnect`, `prefetchDNS` from
`react-dom` to move resource discovery out of the critical CSS/JS chain
([Medium: React 19 resource preloading](https://medium.com/@ogundipe.eniola/react-19-updates-resource-preloading-hydration-error-reporting-and-custom-elements-8486ba180137)).

> **Borjie application:** call `preconnect('https://*.supabase.co')` and
> `prefetchDNS` for the api-gateway origin at the top of the root layout
> so the TLS handshake to Supabase realtime / the BFF is warm before the
> first SSE connection or query fires. `preinit` the chart chunk on the
> dashboard route (the user is statistically about to open a KPI panel).
> **FAST-LOAD WIN:** removes ~100–300 ms of connection setup from the
> first brain SSE stream and first BFF fetch; the chart chunk is in cache
> before the artifact arrives.

---

## 3. Next.js 15 layer — PPR, streaming SSR, prefetch, `after()`

### 3.1 Partial Prerendering (PPR) — the cached shell + streamed holes
PPR ships a **static shell from the CDN edge instantly (TTFB ~20–80 ms
p75 vs 300–800 ms for full SSR)**, leaving Suspense-marked **holes** that
stream the dynamic content **in a single HTTP response** — no extra
round-trips
([Next.js PPR docs](https://nextjs.org/docs/15/app/getting-started/partial-prerendering),
[samcheek PPR-in-production 2026](https://samcheek.com/blog/nextjs-partial-prerendering-production-2026)).
Mechanism, precisely:
- Enable per-route adoption: `experimental: { ppr: 'incremental' }` in
  `next.config.js`, then `export const experimental_ppr = true` on the
  route's top segment (layout or page). It cascades to children.
- A component goes dynamic **only when it touches** `cookies`, `headers`,
  `searchParams`, `connection`, `draftMode`, `unstable_noStore`, or
  `fetch({cache:'no-store'})`. Wrap exactly that component in `<Suspense>`;
  everything else is prerendered into the shell.
- **Trap:** destructuring `searchParams` in the *page* opts the whole page
  dynamic — forward the unawaited `searchParams` promise into a
  Suspense-wrapped child instead (official docs example).
- Status: experimental in Next 15; **stable in Next 16 (Oct 2025) under
  "Cache Components"** (`next.config` `cacheComponents`)
  ([nextjs.org cacheComponents](https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents)).

> **Borjie application:** the owner dashboard and admin console screens
> have an obvious static prefix (sidebar, top bar, greeting hero, section
> headings) and identifiable dynamic holes (daily brief, KPI strip, live
> BFF surface). Add `experimental.ppr: 'incremental'` and
> `export const experimental_ppr = true` to
> `apps/owner-web/src/app/(routes)/layout.tsx` + the dashboard, with the
> session/brief-dependent children behind Suspense (built in §2.1).
> The `borjie_locale` cookie read currently lives in the *root layout*
> (`await readLocaleFromServerCookies()`) — move that cookie read DOWN
> into a small `<Suspense>`-wrapped chrome component (or pass it as a
> prerendered-at-build default and hydrate the toggle) so the cookie
> access doesn't poison the whole tree into dynamic.
> **FAST-LOAD WIN:** the cockpit chrome + greeting render from a cached
> shell at ~50 ms TTFB; only the four brief regions are dynamic and they
> stream in one response. 4–10× TTFB reduction on the most-visited route.
> Caution: PPR is experimental on 15.5 — gate it behind a route-group so a
> regression can't take down auth/sign-in; promote when we move to Next 16
> Cache Components.

### 3.2 Streaming SSR via `loading.tsx` — instant navigation skeleton
A route-segment `loading.tsx` wraps the segment in a Suspense boundary:
navigation is **immediate** (the loading UI shows instantly while the
server renders), and it **enables partial prefetch of dynamic routes** —
Next prefetches the static prefix down to the nearest `loading` boundary
([Next.js prefetching guide](https://nextjs.org/docs/app/guides/prefetching),
[Next.js streaming/Suspense guide](https://www.untergletscher.com/en/blog/nextjs-15-streaming-suspense-performance-guide)).

> **Borjie application:** there are **zero `loading.tsx` files in the
> repo today** — this is the single highest-leverage, lowest-risk win.
> Add a `loading.tsx` per route group (`(routes)/loading.tsx`,
> `dashboard/loading.tsx`, plus admin-web equivalents) that renders the
> existing `SurfaceSkeleton` shapes. Reuse the skeleton components already
> built for the `next/dynamic` panels.
> **FAST-LOAD WIN:** every sidebar navigation paints a skeleton in <100 ms
> instead of hanging on the server render; simultaneously *unlocks*
> `<Link prefetch>` partial-prefetch (§3.3) for these dynamic routes,
> which is currently silently disabled because there's no boundary.

### 3.3 `<Link>` prefetch — viewport prefetch & `prefetch` tuning
Next prefetches a `<Link>` when it enters the viewport; default (`auto`)
prefetches the full route for static routes but only the partial route
down to the nearest `loading.js` for dynamic routes; `prefetch={true}`
forces the full route + data
([Next.js Link docs](https://nextjs.org/docs/app/api-reference/components/link)).
If a `next/dynamic` component is hit during SSR, **its chunk is
prefetched** automatically (Next 15).

> **Borjie application:** the sidebar nav links and the dashboard CTA
> strip (`/ask`, `/cockpit`, `/master-brain`) are the hot paths. Once
> `loading.tsx` exists (§3.2), set `prefetch` deliberately: leave nav
> links on `auto` (cheap partial prefetch), and set `prefetch={true}` on
> the 2–3 CTA buttons the owner almost always clicks next.
> **FAST-LOAD WIN:** the next screen's static shell + JS chunk are in
> cache before the click, so navigation feels instant; combined with
> `loading.tsx`, the dynamic data streams into an already-painted shell.

### 3.4 `after()` — defer non-critical work past the response
`after()` (stable in 15, usable in static pages) schedules work to run
**after** the response is flushed — logging, analytics, audit writes,
cache warming
([Next.js 15 blog](https://nextjs.org/blog/next-15)).

> **Borjie application:** the audit-chain append, web-vitals persistence,
> and "mark brief as seen" writes that currently can sit in the request
> path should move to `after()`. The AI audit chain is append-only and
> hash-chained (a hard rule) — `after()` keeps the *write* off the
> response critical path without weakening the invariant (still
> guaranteed to run, just not blocking paint).
> **FAST-LOAD WIN:** removes audit/telemetry write latency from TTFB on
> every brain/brief response.

---

## 4. Islands / partial hydration / resumability — the hydration-cost lens

Hydration replays the server render on the client and re-downloads
component code; islands architecture hydrates only interactive widgets
("partial/selective hydration") while the rest stays static HTML; Qwik's
*resumability* skips replay entirely by serializing state + listeners into
the HTML and lazy-loading only the handler for the interaction that fires
([patterns.dev islands](https://www.patterns.dev/vanilla/islands-architecture/),
[thenewstack Qwik vs React](https://thenewstack.io/javascript-on-demand-how-qwik-differs-from-react-hydration/)).

**Verdict for Borjie:** do **not** rewrite in Qwik/Astro — the brain,
genui, blackboard-CRDT and chat surfaces are deeply React/RSC-coupled and
the cost/risk is unjustifiable. **The RSC + "client islands" model already
gives us 80% of the islands benefit:** Server Components ship *zero* JS;
only `'use client'` leaves are hydrated. The actionable discipline is to
**shrink the client islands**, not change framework.

> **Borjie application:** audit `'use client'` boundaries — every panel
> that is actually static (headings, hero, section chrome) should be a
> Server Component so it ships no hydration JS. The interactive leaves
> (chart, slider, composer, voice) stay client islands behind
> `next/dynamic`. The dashboard hero, section headings, and "this week"
> grid are pure-render and should never be in a client bundle.
> **FAST-LOAD WIN:** less client JS to download/parse/hydrate → lower INP
> (43% of sites still fail the 200 ms INP bar
> [1604lab CWV 2026](https://1604lab.com/en/blog/core-web-vitals-complete-guide-lcp-inp-cls)),
> faster TTI, smaller bundles with no capability loss.

---

## 5. Code-splitting the heavy chunks — ArtifactRenderer / charts / chat-ui

The expensive client modules MUST be lazy chunks, never in the initial
route bundle: heavy client components split via `next/dynamic`/`React.lazy`
load only when rendered
([greatfrontend code-splitting](https://www.greatfrontend.com/blog/code-splitting-and-lazy-loading-in-react)).

**The heavy chunks in Borjie (from the repo):**
- `recharts` (the chart engine) — pulled by `KpiStripPanel`,
  `SparklineChart`, `ChartElementChart`, treasury, genui projector.
- `@borjie/chat-ui` `FloatingAskBorjie` (already `dynamic ssr:false` —
  good).
- `ArtifactRenderer` (`apps/owner-web/src/components/artifacts/
  ArtifactRenderer.tsx`) + `DOMPurify` + the genui catalog/registry.
- `dompurify` (heavy, browser-only).

> **Borjie application:**
> 1. **Lazy-load `ArtifactRenderer` and DOMPurify** — these only matter
>    when an artifact actually streams from the brain. Wrap in
>    `dynamic(() => import('./ArtifactRenderer'), { ssr:false, loading: ArtifactSkeleton })`
>    and trigger the import on first artifact token, not on chat mount.
> 2. **Lazy-load every recharts surface** behind `next/dynamic` with a
>    `SurfaceSkeleton` (the panels already do this — extend it to
>    `KpiStripPanel`/`SparklineChart` which appear on the dashboard LCP
>    path). recharts must not sit in the dashboard's first JS chunk.
> 3. **`preinit`/`preload` (§2.4) the chart + artifact chunks on idle**
>    once the shell is interactive, so by the time the brief or an
>    artifact needs them they're warm — deferred, not dropped.
> 4. Enforce with the existing `@borjie/performance-toolkit`
>    `bundle-budget` module in CI so a heavy import can't silently land in
>    the route entry chunk.
> **FAST-LOAD WIN:** the dashboard route entry chunk drops the chart +
> sanitizer + genui weight; LCP paints on the hero/skeleton, and the heavy
> viz arrives exactly when data does — full richness, zero up-front cost.

---

## 6. Instant navigation — Speculation Rules API + bfcache

The Speculation Rules API prefetches or **prerenders** the next page in a
hidden tab so activation is near-instant: Google Search saves 67 ms LCP
per click; monitored sites see p75 LCP 320 ms (prerendered) vs 1,800 ms
(standard) — an **82% improvement**
([Chrome prerender-pages](https://developer.chrome.com/docs/web-platform/prerender-pages),
[MDN Speculation Rules](https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API)).
Syntax — inject a `<script type="speculationrules">` with document rules:
```json
{ "prerender": [{ "where": { "href_matches": "/*" },
                  "eagerness": "moderate" }] }
```
Eagerness: `immediate` (50 prefetch / 10 prerender), `eager` (10 ms hover
desktop / 50 ms-in-viewport mobile), `moderate` (200 ms hover / pointer-
down; 2 FIFO), `conservative` (pointerdown only). Chrome 144 (Jan 2026)
adds *prerender-until-script* (renders + loads subresources but pauses at
the first blocking script — safer prerender). bfcache gives instant
back/forward when the page is restorable.

> **Borjie application:** add a Speculation Rules `<script>` in the owner-
> web + admin-web layouts with **`moderate` document rules** scoped to
> same-origin nav links, plus an exclusion selector (e.g.
> `.no-prerender`) on anything with side-effects (sign-out, destructive
> actions, the SSE chat route). Prefer **prefetch** (lighter) for the long
> tail and **prerender** only for the 1–2 hottest next routes
> (dashboard→cockpit, dashboard→ask). Verify bfcache eligibility (no
> `unload` listeners, no `Cache-Control: no-store` on document HTML) so
> back/forward is instant.
> **FAST-LOAD WIN:** the most-traveled owner journeys become *instant*
> (prerendered) on hover/scroll-stop; back/forward is bfcache-instant —
> with zero change to the data/intelligence layers. Note: Next's own
> `<Link>` prefetch (§3.3) and Speculation Rules are complementary — Link
> prefetch warms the RSC payload, Speculation Rules can prerender the full
> document; start with Link prefetch + `moderate` prefetch rules to avoid
> over-fetching on a metered Tanzanian mobile connection.

---

## 7. Perceived-performance science — skeletons, streaming, honest status

The evidence base:
- **Skeleton screens are perceived ~30% faster than spinners** at
  identical real load time; switching cut perceived load 30–50% with no
  backend change; skeletons reduce bounce 9–20%
  ([UI Deploy skeletons-vs-spinners](https://ui-deploy.com/blog/skeleton-screens-vs-spinners-optimizing-perceived-performance),
  [NN/g-cited summary](https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/)).
- **Streaming SSR cuts perceived load up to 40%** because content appears
  progressively instead of all-at-once
  ([beefed.ai HTML streaming](https://beefed.ai/en/html-streaming-react-nextjs)).
- **RAIL:** respond to input within 100 ms, animate at 60 fps, use idle
  time for deferred work, target fast load — perceived thresholds, not
  raw numbers ([web.dev/rail](https://web.dev/articles/rail)).
- **CWV 2026 "good" bars:** LCP < 2.5 s, INP < 200 ms, CLS < 0.1; INP is
  the most-failed (43% of sites)
  ([1604lab](https://1604lab.com/en/blog/core-web-vitals-complete-guide-lcp-inp-cls)).

> **Borjie application:**
> - **Skeletons everywhere, never spinners.** Standardize on the existing
>   `SurfaceSkeleton`/`TabSnapshotShell` shapes for `loading.tsx`,
>   `dynamic` fallbacks, and Suspense fallbacks. Reserve CLS by sizing
>   skeletons to the real content box (the KPI strip and chart panels have
>   fixed heights — set them so streamed content doesn't shift layout →
>   protects CLS < 0.1).
> - **Honest streaming status (the owner's hard constraint).** The brain
>   SSE must surface a typed status the UI renders — `thinking →
>   retrieving evidence → drafting → eta_ms` — driven by real pipeline
>   stages, NEVER a fake "instant answer." This is already partly present
>   in the home-chat SSE normalisers; make the status a first-class
>   contract so every surface (ask, cockpit, master-brain, mobile)
>   renders the same honest progress.
> - **INP guard:** wrap heavy state transitions (tab wake, artifact
>   mount) in `startTransition` (TabSleeper already does) and use the
>   `yield-and-chunk` toolkit module to break long client tasks so the
>   main thread stays responsive < 200 ms during streaming.
> **FAST-LOAD WIN:** the surface *feels* 30–40% faster and bounce drops,
> while the brain still does the full deep computation behind an honest,
> never-degraded progress indicator.

---

## 8. Mobile — Expo Router lazy routes, Hermes, RN New Architecture

The RN/Expo 2026 SOTA:
- **Async routes:** Expo Router auto-splits the JS bundle by route file
  via React Suspense — a screen's JS loads only when navigated to
  ([Expo async routes](https://docs.expo.dev/router/reference/async-routes/)).
- **New Architecture (mandatory from SDK 55; SDK 54 last legacy):**
  TurboModules are **lazy-loaded** — native modules init only when used,
  so startup scales with what you use, not what you install
  ([Expo New Arch](https://docs.expo.dev/guides/new-architecture/),
  [farooxium RN+Expo 2026](https://farooxium.dev/blog/react-native-expo-2026-guide)).
- **Hermes v1:** ~29% faster startup, 38% lower memory, 25% smaller
  bundle, 73% less GC pause vs JSC; with New Arch's JSI, Android cold
  starts ~40% faster
  ([byteiota Expo SDK 56](https://byteiota.com/expo-sdk-56-react-native-2026/)).
- **`React.lazy` + Suspense** for heavy in-screen components (charts,
  maps) after first paint; FlashList over FlatList; Reanimated worklets
  off the JS thread
  ([rapidnative RN 2026 playbook](https://www.rapidnative.com/blogs/react-native-performance-optimization-2026-playbook),
  [reactnative.dev optimizing JS loading](https://reactnative.dev/docs/optimizing-javascript-loading)).

> **Borjie application (buyer-mobile + workforce-mobile are on Expo 51 /
> RN 0.74 / old arch today):**
> 1. **Enable async routes** in the Expo Router config so the 47
>    workforce screens + 12 buyer screens lazy-load per route instead of
>    one cold bundle — biggest single mobile startup win available today,
>    no SDK bump required.
> 2. **Upgrade path → SDK 55/56 (New Arch + Hermes v1).** Plan the bump:
>    mandatory New Arch gives TurboModule lazy init (camera/GPS/file only
>    when a screen uses them) and ~40% faster Android cold start — material
>    on low-end Tanzanian devices.
> 3. **`React.lazy` the heavy in-screen modules** — any chart, map
>    (marketplace geo-parcels), or document viewer renders behind Suspense
>    after the screen's first paint; show a skeleton, defer the heavy
>    import to `InteractionManager.runAfterInteractions`.
> 4. **Stream the brain to mobile the same honest way as web** — SSE
>    tokens + `thinking/eta` status; never a degraded mobile-only short
>    answer (TEST=PAYING applies on mobile too).
> **FAST-LOAD WIN:** app cold start drops to the shell + first screen only;
> heavy per-screen viz and native modules load on demand; on New Arch +
> Hermes the same app starts ~30–40% faster with lower memory — full
> capability, deferred cost.

---

## 9. Streaming generative UI — the brain/genui timeline (Borjie-critical)

Borjie's differentiator is the brain streaming UI, so the genui timeline
gets its own treatment. The Vercel-pattern landscape: `streamUI` /
`createStreamableUI` stream RSC components alongside model output;
`useChat` (AI SDK 5, fully typed) owns conversation state + the data-stream
protocol; the 2026 direction is **AI-generated sections inside PPR — static
shell instant, AI regions update in real time**
([ai-sdk.dev](https://ai-sdk.dev/docs/introduction),
[Vercel RSC genui](https://vercel.com/templates/next.js/rsc-genui)).
Note: **AI SDK *RSC* is paused** — the durable pattern is the client
`useChat` + SSE data-stream + a registry of lazily-imported renderers,
which is exactly what Borjie already has (genui `registry.ts` +
`AdaptiveRenderer` + SSE).

> **Borjie application:** keep the architecture; tighten the loading
> contract:
> - The chat shell (composer + message list skeleton) is in the static
>   PPR shell and paints instantly.
> - Each streamed artifact resolves its renderer from the genui
>   `registry` via **lazy `import()`** (chart → recharts chunk, table,
>   doc → ArtifactRenderer chunk) so an unused renderer never ships.
> - `<Activity hidden>` pre-renders the genui tab that chat is about to
>   spawn (ties to commit 748ccbeb "genui tabs spawn in the background
>   from chat") so the tab is warm when it surfaces.
> - The SSE carries the honest `thinking/retrieving/drafting/eta` status
>   (§7) and `evidence_id`s (the evidence-required hard rule) — the fast
>   path never drops evidence to look faster.
> **FAST-LOAD WIN:** first token + skeleton appear immediately on a cached
> chat shell; the heavy renderer chunk loads exactly when its artifact
> type first appears; the spawned tab is pre-warmed — instant feel, zero
> intelligence dropped.

---

## 10. Prioritized fast-load backlog (do in this order)

1. **`loading.tsx` per route group** (owner-web + admin-web). Zero today;
   unlocks instant-nav skeletons **and** Link partial-prefetch. Lowest
   risk, highest leverage. (§3.2)
2. **Split the dashboard into per-region Suspense boundaries** so the
   greeting hero paints before the brief/session resolves. (§2.1)
3. **Lazy-chunk recharts + ArtifactRenderer + DOMPurify**; enforce with
   `bundle-budget` in CI. (§5)
4. **`<Link prefetch>` tuning + `moderate` Speculation Rules prefetch**
   for hot routes; verify bfcache. (§3.3, §6)
5. **Enable PPR (`ppr:'incremental'`) on the dashboard route group**,
   gated; promote to Next 16 Cache Components later. Move the locale
   cookie read out of the root layout first. (§3.1)
6. **Honest streaming-status contract** across all brain surfaces; size
   skeletons to reserve layout (CLS). (§7, §9)
7. **Enable Expo Router async routes on mobile now**; plan SDK 55/56 New
   Arch + Hermes v1 upgrade. (§8)
8. **(Post React-19 upgrade)** adopt `use()`, `preinit/preconnect`, and
   convert `TabSleeper` → `<Activity>`. (§2.2–2.4)

---

## Sources

- React 19 / `use()` / preload APIs — https://react.dev/blog/2024/12/05/react-19
- React 19 `use()` deep dive — https://dev.to/a1guy/react-19-use-hook-deep-dive-using-promises-directly-in-your-components-1plp
- React 19.2 `<Activity>` / SSR batching — https://www.codewithseb.com/blog/react-19-2-release-guide-activity-useeffectevent-ssr-batching-and-more-explained
- React 19 resource preloading — https://medium.com/@ogundipe.eniola/react-19-updates-resource-preloading-hydration-error-reporting-and-custom-elements-8486ba180137
- Next.js 15 PPR docs — https://nextjs.org/docs/15/app/getting-started/partial-prerendering
- PPR in production 2026 — https://samcheek.com/blog/nextjs-partial-prerendering-production-2026
- Next.js cacheComponents (Next 16) — https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents
- Next.js prefetching guide — https://nextjs.org/docs/app/guides/prefetching
- Next.js `<Link>` API — https://nextjs.org/docs/app/api-reference/components/link
- Next.js 15 blog (`after()`) — https://nextjs.org/blog/next-15
- Next.js streaming + Suspense guide — https://www.untergletscher.com/en/blog/nextjs-15-streaming-suspense-performance-guide
- Islands architecture — https://www.patterns.dev/vanilla/islands-architecture/
- Qwik resumability vs React hydration — https://thenewstack.io/javascript-on-demand-how-qwik-differs-from-react-hydration/
- Chrome prerender / Speculation Rules — https://developer.chrome.com/docs/web-platform/prerender-pages
- MDN Speculation Rules API — https://developer.mozilla.org/en-US/docs/Web/API/Speculation_Rules_API
- Skeletons vs spinners (perceived perf) — https://ui-deploy.com/blog/skeleton-screens-vs-spinners-optimizing-perceived-performance
- Skeleton loading design (NN/g-cited) — https://blog.logrocket.com/ux-design/skeleton-loading-screen-design/
- HTML streaming TTFB — https://beefed.ai/en/html-streaming-react-nextjs
- web.dev RAIL — https://web.dev/articles/rail
- Core Web Vitals 2026 (LCP/INP/CLS) — https://1604lab.com/en/blog/core-web-vitals-complete-guide-lcp-inp-cls
- Expo async routes — https://docs.expo.dev/router/reference/async-routes/
- Expo New Architecture — https://docs.expo.dev/guides/new-architecture/
- Expo SDK 56 / Hermes v1 — https://byteiota.com/expo-sdk-56-react-native-2026/
- RN + Expo 2026 guide — https://farooxium.dev/blog/react-native-expo-2026-guide
- RN 2026 performance playbook — https://www.rapidnative.com/blogs/react-native-performance-optimization-2026-playbook
- RN optimizing JS loading — https://reactnative.dev/docs/optimizing-javascript-loading
- Vercel AI SDK — https://ai-sdk.dev/docs/introduction
- Vercel RSC genui template — https://vercel.com/templates/next.js/rsc-genui
