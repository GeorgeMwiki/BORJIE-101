# Performance SOTA — 2026 Research Notes

**Date:** 2026-05-25
**Author:** Performance task (P75-derived sweep)
**Scope:** Inputs for `packages/performance-toolkit` and the lazy-load
sweep across `apps/owner-portal/`, `apps/admin-platform-portal/`, and
`apps/estate-manager-app/`.

---

## 1. Core Web Vitals — 2026 thresholds

Google evaluates at the 75th percentile of real-user-monitoring (RUM)
data. A page passes Core Web Vitals when ALL three metrics are in the
"good" band at p75. As of late 2025, only **42%** of websites pass all
three simultaneously; **43% fail the INP threshold** — the most
commonly missed CWV in 2026.

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤ 2.5 s | ≤ 4.0 s | > 4.0 s |
| **INP** (Interaction to Next Paint) | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| **CLS** (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| **TTFB** (Time To First Byte) | ≤ 800 ms | ≤ 1.8 s | > 1.8 s |
| **FCP** (First Contentful Paint) | ≤ 1.8 s | ≤ 3.0 s | > 3.0 s |

INP replaced FID (First Input Delay) in March 2024. INP measures the
worst end-to-end interaction latency from input → next paint over the
entire session — a much stricter metric than FID's first-interaction-only.

Source: web.dev/inp, web.dev/lcp, web.dev/cls, corewebvitals.io 2026.

---

## 2. React 19 — Suspense, `use()`, Asset Loading

- **`use()` hook** — accepts a Promise and suspends until resolved.
  Replaces the awkward `useEffect`-then-set-state data-fetching
  pattern. Can be called conditionally / inside loops (unlike useState
  hooks).
- **Document Metadata hoist** — `<title>`, `<meta>`, `<link>` inside
  components are hoisted into `<head>` automatically — no helmet
  needed.
- **Asset Loading API** — `preinit`, `preinitModule`, `preload` exposed
  as React APIs; the renderer streams them into the SSR response so
  the browser can start downloading critical assets before the
  document fully parses.
- **useOptimistic** — optimistic UI baked in; pairs with `useFormStatus`
  for instant form responsiveness while the server action runs.
- **Streaming SSR** — Suspense boundaries + selective hydration; the
  shell paints, then dynamic holes stream in.

Source: react.dev (2026 docs), freecodecamp.org/news/the-modern-react-
data-fetching-handbook, mittalkartik1.medium.com/exploring-react-19.

---

## 3. Next.js 15 — Partial Prerendering, Server Components, Turbopack

- **Partial Prerendering (PPR)** — Combines static + dynamic in one
  route. Server sends a static shell; dynamic holes stream in
  parallel. Reduces TTFB ~30-50% on hybrid pages. Enabled via
  `experimental.ppr: 'incremental'`.
- **Server Components default** — Pages are RSCs unless marked
  `'use client'`. Server-only code (DB queries, secrets) never reaches
  the bundle.
- **Server Actions** — Replace REST API route boilerplate for forms;
  call straight from a `<form action={…}>`.
- **Turbopack** — 5-10× faster builds vs Webpack. 45.8% faster initial
  route compile. Sub-50ms HMR even on large apps.
- **Dynamic imports** — `dynamic(() => import('./X'), { ssr: false,
  loading: () => <Skeleton/> })` is the canonical pattern for
  client-only heavy components (maps, rich-text editors, chart
  libraries).

Source: nextjs.org/docs/15, vercel.com/blog/ai-sdk-5, jishulabs.com/
blog/nextjs-15-16-features-migration-guide-2026.

---

## 4. Vite 6 — Lightning HMR, Rollup, Partial Hydration

- **HMR < 50 ms** regardless of app size; **42 ms** vs Webpack's 2.1 s
  (50× faster).
- **esbuild dependency pre-bundling** + native ESM serve in dev.
- **Rollup-based prod build** with code-splitting + tree-shake.
- **3.7× faster production build** vs Webpack (12 s vs 45 s on the
  same project).

Source: vite.dev, tech-insider.org/vite-vs-webpack-2026.

---

## 5. Lazy loading — route + component + library

### Route-based (React Router v6 + React.lazy)

```typescript
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
<Suspense fallback={<Skeleton/>}><Dashboard/></Suspense>
```

### Component-based (Next.js dynamic)

```typescript
const HeavyChart = dynamic(() => import('./HeavyChart'), {
  ssr: false,
  loading: () => <ChartSkeleton/>,
});
```

### Library-based — drop the eager `lodash`

```typescript
// BAD: pulls all of lodash (~70KB)
import _ from 'lodash';
// GOOD: tree-shaken
import debounce from 'lodash-es/debounce';
```

### Retry on ChunkLoadError after deploys

The classic "blank screen after we deployed" bug:
1. User opens app → browser caches old chunk URLs.
2. We ship a fresh build → those hashed files no longer exist.
3. User navigates → chunk 404 → ChunkLoadError.

Mitigation: retry N times (CDN may be mid-deploy), then ONE full-page
reload to re-fetch index.html with the fresh manifest. Use
sessionStorage as a guard so a genuinely broken bundle does not
infinite-loop.

Implemented in `packages/performance-toolkit/src/lazy-load/lazy-with-
retry.ts`. Source: dev.to/devin-rosario/fix-react-chunk-load-errors-
fast-2025-guide-2j52, codemzy.com/blog/fix-chunkloaderror-react.

---

## 6. Anthropic Prompt Caching — 90% input-token savings

Mark stable prefix sections (system prompts, tool catalogues, long
documents) with `cache_control: { type: 'ephemeral' }`. Subsequent
calls within the TTL window get a **90% discount** on cached tokens.

| Operation | Cost multiplier |
|---|---|
| Standard input | 1.0× |
| Cache write (5-min TTL) | 1.25× |
| Cache write (1-hour TTL) | 2.0× |
| **Cache read** | **0.1×** |

**Break-even:** 2 cache hits within the TTL pays back the write
premium. Recommended for any prefix stable ≥ 5 minutes — system
prompts, tool definitions, large reference contexts.

Implemented in `packages/performance-toolkit/src/prompt-cache/`.

Source: platform.claude.com/docs/build-with-claude/prompt-caching,
github.com/anthropics/anthropic-cookbook/misc/prompt_caching.ipynb,
dev.to/whoffagents/claude-prompt-caching-2026.

---

## 7. Streaming — SSE + Vercel AI SDK 5

- **Vercel AI SDK 5** (released July 2025) — `UIMessage` and
  `ModelMessage` are now separate types; streaming uses SSE natively
  (no custom protocol); tools use `inputSchema`/`outputSchema`; new
  `Agent` class wraps `generateText` for agentic loops.
- **`useObject` hook** — stream structured JSON object generation;
  partial objects arrive as they're produced.
- **`streamUI`** — stream actual React components (not JSON) via RSC.

SSE format reminder:

```
event: chunk
id: 1
data: {"text": "Hello"}

```

Implemented in `packages/performance-toolkit/src/streaming/`.

Source: vercel.com/blog/ai-sdk-5, ai-sdk.dev/docs/ai-sdk-ui,
pkgpulse.com/guides/vercel-ai-sdk-5-migration-2026.

---

## 8. Cache strategies — ETag/304, SWR, Brotli, Cache-Control presets

### ETag/304

A 100 KB response becomes a 304 empty body when the client has the
same `If-None-Match` value. Cuts response size ~99% on cache hits.

### Stale-while-revalidate

Within the SWR window, return stale value + kick off background
refetch. User sees instant data + fresh data on next read.

### Brotli compression

15-25% better compression than gzip on JSON/HTML/CSS/JS. Hono's
built-in `compress()` middleware does NOT support `br` natively
(issue honojs/hono#3543); we ship our own in
`packages/performance-toolkit/src/cache/compression.ts`.

### Cache-Control presets

| Strategy | Header |
|---|---|
| `public-immutable` | `public, max-age=31536000, immutable` |
| `public-swr` | `public, max-age=60, stale-while-revalidate=600` |
| `private-no-store` | `private, no-store, no-cache, must-revalidate, max-age=0` |
| `edge-cdn` | `private, max-age=0, s-maxage=300, stale-while-revalidate=600` |
| `private-revalidate` | `private, no-cache, must-revalidate` |

Default in api-gateway is `private-revalidate` so no API endpoint is
ever CDN-cached by accident. Routes opt into looser caching per-route.

Source: RFC 7234, RFC 5861 (SWR), ayrshare.com/http-compression-in-
node-js, dohost.us/2026/brotli-for-apis, web.dev/learn/pwa/workbox.

---

## 9. HTTP 103 Early Hints

Server sends `103 Early Hints` with link headers BEFORE the final
response is computed:

```
HTTP/2 103 Early Hints
Link: </main.css>; rel=preload; as=style
Link: <https://api.example.com>; rel=preconnect
```

Chromium starts the preload/preconnect immediately. Browser support
2026:
- Chrome/Edge 103+ — preload + preconnect (modulepreload supported)
- Firefox 123+ — preload + preconnect
- Safari 17+ — preconnect only
- Requires HTTP/2 or HTTP/3 (no HTTP/1.1 support)

Source: developer.chrome.com/docs/web-platform/early-hints,
developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/103.

---

## 10. Image optimization — AVIF + WebP + LQIP

- **AVIF** = ~50% smaller than JPEG, ~20-30% smaller than WebP. 95%
  global browser support as of early 2026.
- **WebP** = universal modern-browser fallback.
- **JPEG/PNG** = legacy safety net (Safari < 17).
- **`<picture>` element** with `type` hints and responsive `srcset`/
  `sizes` is the canonical pattern (only 9.3% of sites use it — huge
  optimization headroom).
- **LQIP** (Low-Quality Image Placeholder) — blurred base64 data URL
  shown while the full image loads. Eliminates flash-of-empty-image.
- **`fetchpriority="high"`** on the LCP image. Lazy + async on
  everything below the fold.

Implemented in `packages/performance-toolkit/src/lazy-load/lazy-image.ts`.

Source: aralroca/avif-2026, web.dev/image-cwv,
requestmetrics.com/web-performance/high-performance-images.

---

## 11. Font loading

- **`font-display: swap`** — text visible immediately with fallback,
  swapped to web font when loaded. 50% of sites use this.
- **Preload ONLY the LCP-critical font** — preloading every font
  wastes bandwidth.
- **Variable fonts** — 1 file replaces 4-8 weights. Smaller total
  size; can do interpolated weights for free.
- **`size-adjust` + `ascent-override`** on the fallback to eliminate
  layout shift when the swap happens.

Source: greadme.com/blog/best-practices/optimize-font-loading,
askseocoach.com/technical-seo/web-performance/font, fontfyi.com/blog/
font-display-strategies.

---

## 12. Virtualization — `@tanstack/react-virtual`

10,000-row tables feel instant when only ~35 rows are in the DOM at
any time. TanStack Virtual is 10-15 KB, supports vertical + horizontal
+ grid + window-scroll virtualization, both fixed and variable item
sizing.

Performance tuning:
- `useFlushSync(false)` on lower-end devices for rapid-scroll batching.
- `overscan: 5-10` to render a small buffer outside the viewport.

Source: blog.logrocket.com/speed-up-long-lists-tanstack-virtual,
tanstack.com/virtual/latest.

---

## 13. Service Worker / Workbox 7

- **Stale-while-revalidate** returns cached response instantly + kicks
  off a fresh fetch in the background. Best for content that updates
  regularly but tolerates a stale read on this view.
- **Cache-first** for hashed static assets.
- **Network-first** for time-sensitive HTML / API calls.

Mixing strategies per request type is the 2026 minimum bar.

Source: web.dev/learn/pwa/workbox, magicbell.com/blog/offline-first-
pwas-service-worker-caching-strategies, digitalapplied.com/blog/
progressive-web-apps-2026-pwa-performance-guide.

---

## 14. TanStack Query 5 — SWR for the client

Default behaviour IS stale-while-revalidate:
- Cached data shown immediately.
- Background refetch fires when `staleTime` elapsed.
- `gcTime` (formerly `cacheTime`) controls when unused data is GC'd.

Prefetch on hover:

```typescript
<Link onMouseEnter={() => queryClient.prefetchQuery(['x'])} href="/x"/>
```

Replicated in our Vite SPA via `prefetchOnHover` in
`packages/performance-toolkit/src/lazy-load/prefetch-on-hover.ts`.

Source: tanstack.com/query/v5/docs/react/guides/queries,
tanstack.com/query/v4/docs/framework/react/guides/prefetching.

---

## Decisions for this codebase

| Decision | Rationale |
|---|---|
| **`web-vitals` v5 + attribution build** | LCP element selector + INP target attribution → faster debugging. |
| **Brotli at quality 4** | Sweet spot for live HTTP — better ratio than gzip-6, similar CPU. |
| **`private-revalidate` as api-gateway default** | Prevents accidental CDN-cache of sensitive data. Routes opt-in to looser caching. |
| **Prompt-cache 5-min default** | Most LLM workloads have <5min between requests. 5-min TTL costs less to write. |
| **Bundle budgets per-app** | landing 100 KB, dashboards 250-280 KB, advisor 220 KB. CI gate via `borjie-bundle-check`. |
| **`React.lazy` + `loaderWithRetry`** | Auto-recovery from stale-chunk errors after deploys. |
| **`prefetchOnHover` on nav links** | Replicates Next.js Link default for our Vite SPA. |
| **`next/dynamic` for advisor pages** | Heavy clients (maps, forms) stay out of server build. |

---

## Out-of-scope (intentionally NOT done here)

- **HTTP/3 + QUIC** — operates at the LB / CDN layer; needs infra
  config (ALB target groups, Cloudflare zone setting). Tracked
  separately.
- **Edge runtime migration** — would move some routes to Vercel Edge /
  Cloudflare Workers. Big lift; needs infra alignment first.
- **Bun runtime experiments** — eval-only at this stage.
- **Snapshot startup** — Node 22+ has built-in snapshots; can shave
  ~300 ms off cold starts but requires app-level rework.

---

## Cited sources (≥ 12)

1. https://web.dev/inp — Interaction to Next Paint
2. https://web.dev/lcp — Largest Contentful Paint
3. https://web.dev/cls — Cumulative Layout Shift
4. https://www.corewebvitals.io/core-web-vitals — 2026 thresholds + RUM stats
5. https://react.dev/reference/react/Suspense — React 19 Suspense
6. https://nextjs.org/docs/15/app/getting-started/partial-prerendering
7. https://v6.vite.dev/ — Vite 6 docs
8. https://platform.claude.com/docs/en/build-with-claude/prompt-caching — Anthropic
9. https://github.com/anthropics/anthropic-cookbook/blob/main/misc/prompt_caching.ipynb
10. https://vercel.com/blog/ai-sdk-5 — Vercel AI SDK 5 release notes
11. https://developer.chrome.com/docs/web-platform/early-hints — 103 Early Hints
12. https://www.npmjs.com/package/web-vitals — web-vitals v5
13. https://web.dev/learn/pwa/workbox — Workbox 7 SWR
14. https://tanstack.com/query/v5/docs/framework/react/guides/queries — Query v5
15. https://tanstack.com/virtual/latest — Virtual scroll
16. https://github.com/honojs/hono/issues/3543 — Hono Brotli support tracking
17. https://dev.to/devin-rosario/fix-react-chunk-load-errors-fast-2025-guide-2j52 — Chunk retry pattern
18. https://www.codemzy.com/blog/fix-chunkloaderror-react — ChunkLoadError handling
19. https://dev.to/aralroca/avif-in-2026-the-complete-guide-to-the-image-format-that-beat-jpeg-png-and-webp-34n2 — AVIF 2026
20. https://www.greadme.com/blog/best-practices/optimize-font-loading-with-font-display-complete-guide — Font perf
