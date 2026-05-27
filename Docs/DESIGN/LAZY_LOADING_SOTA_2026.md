# Lazy-Loading SOTA — 2026

**Status:** Spec
**Date:** 2026-05-27
**Author:** Mr. Mwikila (performance task)
**Wave:** SOTA-LAZY-LOAD
**Surfaces:** `apps/admin-web`, `apps/owner-web`, `apps/marketing`, `apps/buyer-mobile`, `apps/workforce-mobile`, `packages/chat-ui`, `packages/genui`
**Predecessors:** `Docs/PERFORMANCE_SOTA_RESEARCH_2026-05-25.md`, `Docs/LITFIN_PARITY_AUDIT_DYNAMIC_LLM_LAZY_LOAD_2026-05-25.md`, Wave 15E (genui SSR-safe), Wave UX-1 (InlineRichRender)

---

## 0. Mandate (founder-locked)

> "Every page, every tab, every chat message must load fast — **without losing one ounce of intelligence**. If a fetch lived here yesterday, it lives here today; we just deliver the value *later in the frame* instead of *earlier in the bundle*."

The whole surface area — five apps and two cross-cutting packages — must hit the 2026 Web Vitals **good** band at p75:

| Metric | Target | 2026 thresholds |
|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤ 2.5 s | web.dev/lcp |
| **INP** (Interaction to Next Paint) | ≤ 200 ms | web.dev/inp |
| **CLS** (Cumulative Layout Shift) | ≤ 0.1 | web.dev/cls |
| **TTFB** (Time to First Byte) | ≤ 800 ms | web.dev/ttfb |
| **FCP** (First Contentful Paint) | ≤ 1.8 s | web.dev/fcp |

Marketing tightens further: LCP ≤ 1.5 s, CLS ≤ 0.05.

INP replaced FID in March 2024 — it measures the **worst** interaction across the whole session, not just the first. 43 % of websites fail INP in 2026; it is the metric most worth chasing.

---

## 1. Zero-intelligence-loss invariant

This invariant **dominates** every other optimisation. The cognitive value of Borjie lives in its fetches, mutations, and subscriptions:

- `useDailyBrief` on the owner cockpit pulls the 10-card daily-brief.
- `Sensorium` events from the 14-event sensory bus.
- `useUnifiedChat` SSE streaming.
- TanStack-Query backed reads (cockpit, ai-costs, system-health, jarvis, persona-drift, webhook-dlq, …).
- DP-aggregated industry views (admin-web `/industry`, `/radar`, `/insights`, `/forecasts`).
- LiveBlocks + Yjs collaboration in admin-web ask threads.

Lazy-loading **defers the cost** of these dependencies; it must **never drop** them. A removed query is a removed signal — that's exactly the kind of degradation this work forbids.

Enforcement:

1. Every Suspense-wrapped component still mounts the same hooks. Skeleton → real data, never skeleton → empty.
2. `next/dynamic` boundaries used only on **rendering** modules (charts, calendar, map). Data hooks stay in the wrapping client island.
3. Streamed Suspense holes (PPR) preserve the original RSC `await`.
4. Mobile `React.lazy(() => import('./Screen'))` keeps the screen's `useQuery`/`useMutation` calls intact — only the component bundle is deferred.
5. **Audit:** after each commit, `git diff <commit>~..<commit> -- apps/ packages/ | grep -c "use\(Query\|Mutation\|SWR\|Effect\|useSyncExternalStore\)"` shows non-negative net.

---

## 2. React 19 + Next 15 baseline (per react.dev 2026)

The platform already runs React 19 + Next 15.5. We exploit:

- **`Suspense` streaming SSR** — shell renders synchronously; suspended trees stream in `<template>` tags as their promises resolve. `selective hydration` lets the user interact with the already-painted shell while heavier islands hydrate. (react.dev/reference/react/Suspense, 2026)
- **`use()` hook** — accepts a Promise; binds React's reconciler to the suspension boundary; replaces the `useEffect`-then-set-state pattern for one-shot reads. (react.dev/reference/react/use, 2026)
- **Asset Loading APIs** — `preinit`, `preinitModule`, `preload` exposed as React APIs and streamed into the SSR response so the browser can start the critical-asset download before the document finishes parsing. (react.dev/reference/react-dom/preload, 2026)
- **Document Metadata hoist** — `<title>`, `<meta>`, `<link>` inside components are hoisted into `<head>` automatically; no helmet shim. (react.dev/reference/react-dom/components, 2026)
- **`useOptimistic`** — pre-bake the success state for instant form feedback while the server action runs. (react.dev/reference/react/useOptimistic, 2026)

Next 15.5 features we lean on:

- **Partial Prerendering (PPR)** — `experimental.ppr: 'incremental'` lets a single route stream a static shell PLUS dynamic holes. Cuts TTFB ~30-50 % on hybrid routes. (nextjs.org/docs/15/app/api-reference/next-config-js/ppr, 2026)
- **`unstable_cache` + revalidate** — ISR-style cache for server reads. We use it on owner-web dashboards (60 s) and admin-web read-mostly views (30 s).
- **Edge runtime** — `export const runtime = 'edge'` deploys the route on Vercel Edge / Cloudflare Workers. We migrate the marketing public routes + the owner snapshot endpoint.
- **Turbopack** — already enabled on the three Next apps via `--turbo`. 5-10× faster dev compile.

---

## 3. Per-app strategy

### 3.1 apps/admin-web (operator console — dense data, internal traffic)

Pattern: **client-side Suspense islands + TanStack-Query prefetch + virtualisation for >100-row tables.**

| Page | Heavy artefact | Lazy strategy |
|---|---|---|
| `/jarvis` | JarvisConsole (long-form list) | `next/dynamic` with `loading={JarvisSkeleton}` — **skipped this wave (concurrent edit)** |
| `/mission-eval` | MissionEvalClient — scenario table | Defer scenario detail panel via `next/dynamic` — **skipped this wave (concurrent edit)** |
| `/persona-drift` | drift sparklines + table | Defer chart island — **skipped this wave (concurrent edit)** |
| `/webhook-dlq` | rrweb cold-store replay panel | Defer rrweb to user interaction — **skipped this wave (concurrent edit)** |
| `/ai-costs` | per-model breakdown table | Add Suspense + virtualisation when >100 rows |
| `/system-health` | live status cards | Streaming Suspense + prefetch |
| `/feature-flags` | flag table | Virtualised when >100 flags |
| `/control-tower`, `/decision-trace`, `/insights`, `/forecasts`, `/radar` | mixed | Suspense + prefetch |

`@borjie/performance-toolkit` already ships `loaderWithRetry`, `prefetchOnHover`, `lazyImage`, `createIntersectionLazy`. We wire these into the admin-web layer.

### 3.2 apps/owner-web (mining owner cockpit)

Pattern: **Streaming Suspense for analytics + PPR for the static shell + lazy charts (Recharts/Mapbox) on scroll-into-view.**

- `/` (cockpit) — `CockpitGrid` is already a client island reading `useDailyBrief`. The grid stays; we add a Suspense skeleton row so the SWR background refetch shows a clear shimmer.
- `/portfolio-map` — Mapbox + react-map-gl are heavy (>200 KB gzipped). Wrap in `next/dynamic` with `ssr: false`.
- `/treasury`, `/finance`, `/reports` — Recharts charts wrapped in `next/dynamic` and rendered only when scrolled into view (`createIntersectionLazy` from performance-toolkit).
- `/master-brain` — chat streaming SSE; already lean.
- Edge route: `/api/owner-overview/snapshot` — `runtime = 'edge'` + `Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=600` (the `edge-cdn` preset already in `@borjie/performance-toolkit/cache`).

### 3.3 apps/marketing (public site)

Pattern: **mostly-static rendering + Edge runtime for /api/* + AVIF/WebP next/image + next/font subset + `afterInteractive` strategy for analytics.**

- All public route segments → `export const runtime = 'edge'` where the segment is pure server-rendering.
- next/image with `formats: ['image/avif', 'image/webp']` (95 % global support as of early 2026).
- next/font `display: 'swap'` + `preload: true` only for the LCP-critical face (Fraunces display). Body Inter loads after first paint.
- Tailwind v4 JIT is already configured; we tighten the `content` glob so the production CSS shrinks ~20 %.
- `next/script` with `strategy="afterInteractive"` for analytics (Google Tag, etc) when added later.
- Soft target: LCP ≤ 1.5 s, CLS ≤ 0.05.

### 3.4 apps/workforce-mobile + apps/buyer-mobile (Expo / React Native)

Pattern: **Hermes-engine on, `React.lazy` for screen islands, FlashList for any >100-row list, image precache for above-fold.**

- Hermes is the Expo default for SDK 51; verify `jsEngine: 'hermes'` in `app.json`.
- Heavy screens (chat, marketplace board, KYC photo capture) → `React.lazy(() => import('../screens/X'))`.
- FlashList drop-in replacement for FlatList where lists exceed ~50 rows.
- `expo-image` with `priority="high"` for above-fold assets; precache via `expo-image`'s `prefetch`.
- Background sync queue for offline-tolerant operations (uses `expo-background-fetch` + AsyncStorage adapter).

### 3.5 packages/chat-ui (cross-cutting)

Pattern: **message virtualisation past 50 messages + lazy InlineRichRender heavy blocks + streaming completion preserved.**

- The floating widget caps at ~50 messages currently; we extend with a virtualisation hook (`@tanstack/react-virtual` or `virtua`) that activates past 50 rows so memory stays flat.
- `InlineRichRender` already routes to `@borjie/genui` `AdaptiveRenderer`. We keep it — heavy blocks within genui are already lazy-wrapped via `ClientOnly + React.lazy`.
- Streaming chat completion via SSE is in place; we add a Suspense boundary around the message list so the **shell** appears before the first token.
- We add `experimental_million` opt-in via the host app's Million.js wrap; chat-ui itself stays library-agnostic.

### 3.6 packages/genui (rich blocks)

Pattern: **every heavy block already `ClientOnly + React.lazy`** (Wave 15E). The pattern is preserved. We document it here so future blocks inherit it automatically.

Heavy blocks (peer-dep / browser-only):

| Block | Library | Lazy guard |
|---|---|---|
| `CalendarView` | FullCalendar | `ClientOnly` + `lazy(import('./CalendarInner.js'))` ✓ |
| `MapView` | Leaflet / react-leaflet | `ClientOnly` + `lazy(import('./MapInner.js'))` ✓ |
| `PdfViewer` | react-pdf | `ClientOnly` + `lazy(import('./PdfInner.js'))` ✓ |
| `VegaChart` | react-vega + vega-lite | `ClientOnly` + `lazy(import('react-vega'))` ✓ |
| `GeoFence` | Leaflet | `ClientOnly` + `lazy(import('./GeoFenceInner.js'))` ✓ |
| `FilePreview` | mixed (pdf + image + audio) | `ClientOnly` for pdf branch ✓ |

Other blocks (`DataTable`, `Heatmap`, `GanttChart`, `OrgChart`, `DataflowDiagram`, `Kanban`, `Timeline`, `Tree`, `DashboardGrid`, `MarkdownCard`, `KpiGrid`, `MetricSparkline`, `ComparisonTable`, `EvidenceCard`, `DecisionTrace`, `LiveCounter`, `MediaGrid`, `MultistepWizard`, `Gauge`, `PrefillForm`, `SignaturePad`, `SliderInput`, `WorkflowStepper`, `ApprovalDialog`, `ChatEmbed`, `ImageAnnotation`, `PromptSuggestions`, `NotificationToast`, `CodeBlock`, `DiffView`) are zero-dep (SVG / CSS / minimal JS) — they ship in the genui chunk and don't need their own boundary.

---

## 4. Cross-cutting infrastructure

### 4.1 Bundle baseline

`next-bundle-analyzer` is wired into each Next app's prod build behind `ANALYZE=true`. The first-pass numbers are captured in `Docs/QA/BUNDLE_BASELINE_2026_05_27.md` per the wave commit cadence. Future PRs that grow a bundle by >10 % require a justification in the PR body.

### 4.2 Web Vitals reporting

`@borjie/performance-toolkit/perf-metrics` exposes:

- `reportWebVitals` — Next.js `useReportWebVitals` hook callback.
- `bindReportWebVitalsToSink` — pipes LCP/INP/CLS/FCP/TTFB to a sink (our analytics package).
- `classifyWebVital` — buckets the number into `good | needs-improvement | poor` per 2026 thresholds.

Each Next app installs a `WebVitalsReporter` client island in `app/layout.tsx` (or, in admin-web's case, inside the existing `SensoriumProvider` so the sensory bus captures it too).

### 4.3 Service Worker (mobile + marketing)

Workbox 7 with the canonical mix:

- **Cache-first** for hashed static assets (immutable cache).
- **Stale-while-revalidate** for next/image AVIF/WebP responses.
- **Network-first** with 5 s timeout for HTML/API.

Worker file lives in each app's `public/sw.js`; registration on `app/layout.tsx` mount.

### 4.4 Pre-fetch on hover (admin + owner)

`PrefetchNavLink` already exists in admin-web. We extend the pattern by wiring `queryClient.prefetchQuery` on link hover for the destination's primary feed. This compresses perceived navigation cost to ~0.

---

## 5. Verification

For each commit:

1. `pnpm -F @borjie/admin-web build && pnpm -F @borjie/owner-web build && pnpm -F @borjie/marketing build` (production builds).
2. `pnpm -F @borjie/admin-web typecheck && …` (TS strict).
3. `pnpm -F @borjie/admin-web test --run` (vitest).
4. Visual smoke in `next dev`: first paint < 1 s on each app, route navigation under 200 ms.
5. Bundle size diff captured in `Docs/QA/BUNDLE_BASELINE_2026_05_27.md`.

---

## 6. Cited sources (≥ 14)

1. https://web.dev/articles/inp — Interaction to Next Paint. Google web.dev. Updated 2025-09.
2. https://web.dev/articles/lcp — Largest Contentful Paint. Google web.dev. Updated 2025-09.
3. https://web.dev/articles/cls — Cumulative Layout Shift. Google web.dev. Updated 2025-09.
4. https://react.dev/reference/react/Suspense — Suspense. React docs. 2026.
5. https://react.dev/reference/react/use — `use()` hook. React docs. 2026.
6. https://react.dev/reference/react-dom/preload — Asset Loading APIs. React docs. 2026.
7. https://nextjs.org/docs/app/building-your-application/rendering/partial-prerendering — PPR. Next.js docs. 2026.
8. https://nextjs.org/docs/app/api-reference/functions/unstable_cache — `unstable_cache`. Next.js docs. 2026.
9. https://nextjs.org/docs/app/api-reference/components/image — `next/image`. Next.js docs. 2026.
10. https://nextjs.org/docs/app/api-reference/components/font — `next/font`. Next.js docs. 2026.
11. https://tanstack.com/query/v5/docs/framework/react/guides/prefetching — Query v5 prefetch. TanStack. 2026.
12. https://tanstack.com/virtual/latest — TanStack Virtual. 2026.
13. https://shopify.github.io/flash-list — FlashList. Shopify. 2025-11.
14. https://docs.expo.dev/versions/v51.0.0/sdk/image/ — `expo-image` with prefetch. Expo. 2025.
15. https://million.dev/docs — Million.js 3.x. 2026.
16. https://web.dev/learn/pwa/workbox — Workbox 7 strategies. web.dev. 2025-10.
17. https://developer.chrome.com/docs/web-platform/early-hints — HTTP 103 Early Hints. Chrome devrel. 2025.
18. https://vercel.com/docs/edge-network/regions — Vercel Edge regions. 2026.
19. https://npmjs.com/package/web-vitals — `web-vitals` v5. 2026.
20. https://dev.to/aralroca/avif-in-2026-the-complete-guide-to-the-image-format-that-beat-jpeg-png-and-webp-34n2 — AVIF 2026 adoption. 2026-02.
