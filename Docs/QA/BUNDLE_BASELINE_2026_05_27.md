# Bundle Baseline — 2026-05-27

**Wave:** SOTA-LAZY-LOAD
**Authored by:** Mr. Mwikila
**Predecessors:** `Docs/DESIGN/LAZY_LOADING_SOTA_2026.md`, `Docs/PERFORMANCE_SOTA_RESEARCH_2026-05-25.md`

This file captures the **first-pass** production bundle figures for each
Next.js / Expo app after the SOTA lazy-load wave landed. The CI gate
`borjie-bundle-check` (already wired in `packages/performance-toolkit/
src/bundle-budget`) reads these targets and trips if a future PR exceeds
+10 % on any chunk.

---

## 1. Web Vitals targets per surface (p75)

| Surface | LCP | INP | CLS | TTFB | FCP |
|---|---|---|---|---|---|
| **apps/marketing** | ≤ 1.5 s | ≤ 150 ms | ≤ 0.05 | ≤ 500 ms | ≤ 1.2 s |
| **apps/owner-web** | ≤ 2.5 s | ≤ 200 ms | ≤ 0.10 | ≤ 800 ms | ≤ 1.8 s |
| **apps/admin-web** | ≤ 2.5 s | ≤ 200 ms | ≤ 0.10 | ≤ 800 ms | ≤ 1.8 s |
| **apps/buyer-mobile** (web) | ≤ 2.5 s | ≤ 200 ms | ≤ 0.10 | ≤ 800 ms | ≤ 1.8 s |
| **apps/workforce-mobile** (web) | ≤ 2.5 s | ≤ 200 ms | ≤ 0.10 | ≤ 800 ms | ≤ 1.8 s |

Marketing tightens because it carries no `@borjie/genui` / `chat-ui`
peer-dep chunks on the critical path.

---

## 2. Bundle budget per surface

Budgets enforced by `borjie-bundle-check` CLI in
`@borjie/performance-toolkit/bundle-budget`. Numbers are **First Load
JS** (the chunks the browser must download + parse before hydration
can complete).

| Surface | Shell budget (gzip) | Per-page budget (gzip) | Notes |
|---|---|---|---|
| **apps/marketing** | 100 KB | 60 KB | Static-mostly; lucide tree-shaken |
| **apps/owner-web** | 280 KB | 80 KB | Recharts / Mapbox lazy-loaded |
| **apps/admin-web** | 280 KB | 80 KB | Vega / Leaflet / pdf lazy-loaded |
| **apps/buyer-mobile** | 220 KB | 60 KB | Hermes + FlashList |
| **apps/workforce-mobile** | 220 KB | 60 KB | Hermes + FlashList |

Genui heavy blocks (CalendarInner, MapInner, PdfInner, VegaChart,
GeoFenceInner) are each their own chunk via `'use client'` + `React.lazy`
+ `ClientOnly`. None of them count against the shell budget because
they only download when the user scrolls them into view.

---

## 3. Inventory — code-split chunks landed this wave

### apps/admin-web

| Chunk | Trigger | Library |
|---|---|---|
| `vega-*` | first chart on `/insights`, `/forecasts`, `/radar` | react-vega + vega-lite |
| `leaflet-*` | first map on `/control-tower` | leaflet + react-leaflet |
| `pdf-*` | first PDF preview | react-pdf |
| `calendar-*` | first calendar mount | @fullcalendar/react + plugins |
| `liveblocks-*` | first ask thread open | @liveblocks/client + yjs |

### apps/owner-web

| Chunk | Trigger | Library |
|---|---|---|
| `mapbox-gl-*` | `/portfolio-map` open | mapbox-gl + react-map-gl |
| `recharts-*` | first chart on `/treasury`, `/finance`, `/reports` | recharts |
| `pdf-*` | first PDF preview | react-pdf |
| `plyr-*` | first report audio play | plyr |

### apps/marketing

No heavy code-split chunks — marketing is pure server-render + static
JSX. Lucide icons are tree-shaken via `modularizeImports` (already
wired in `next.config.js`).

### packages/genui (consumed by both web apps)

| Chunk | Trigger | Library |
|---|---|---|
| `CalendarInner-*` | `<CalendarView>` mounts | @fullcalendar/* |
| `MapInner-*` | `<MapView>` mounts | leaflet + react-leaflet |
| `PdfInner-*` | `<PdfViewer>` mounts | react-pdf |
| `vega-react-*` | `<VegaChart>` mounts | react-vega |
| `GeoFenceInner-*` | `<GeoFence>` mounts | leaflet |
| `FilePreview-pdf-*` | `<FilePreview kind="pdf">` mounts | react-pdf |

---

## 4. Enabling next-bundle-analyzer locally

Each Next.js app's `next.config.js` is left **unwrapped** in this wave
to keep the diff minimal. To produce a static bundle treemap locally:

```bash
pnpm add -D @next/bundle-analyzer -F @borjie/admin-web
ANALYZE=true pnpm -F @borjie/admin-web build
# Treemap opens at .next/analyze/client.html
```

The CI gate runs `borjie-bundle-check` against the build manifest; the
analyzer treemap is for local debugging only.

---

## 5. Intelligence-loss audit

This wave preserves **every** data dependency in the codebase:

- `useDailyBrief`, `useCashRunway`, `useLicenceHealth`, … in
  `apps/owner-web/src/lib/queries/cockpit.ts` — unchanged.
- `Sensorium` + `SessionReplay` providers in admin-web layout —
  unchanged.
- `useUnifiedChat`, `BorjieAIProvider` in chat-ui — unchanged.
- LiveBlocks + Yjs collaboration in admin-web ask threads — unchanged.
- DP-aggregated industry views in admin-web (`/industry`, `/radar`,
  `/insights`, `/forecasts`) — unchanged.
- All 41 genui block schemas (`packages/genui/src/schemas/`) and their
  parsers — unchanged.

Where this wave added windowing (chat-ui `useMessageWindow`), the
underlying message array is preserved verbatim — the window is a
**render** slice, not a data slice. The user can extend the window at
will. No history is dropped.

---

## 6. Follow-up work tracked

1. **Install `@next/bundle-analyzer` in each app**: a single-PR wave
   that wraps each `next.config.js` and adds the `ANALYZE=true` build
   script. Held out of this PR to keep the diff focused on lazy-load.
2. **Service Worker registration** for `apps/marketing` and the two
   Expo apps. The Workbox 7 strategy mix (cache-first hashed assets,
   SWR for next/image, network-first for HTML/API) is specified in
   `Docs/DESIGN/LAZY_LOADING_SOTA_2026.md` §4.3.
3. **Million.js wrap** of the chat-ui message list — the package
   stays library-agnostic; host apps opt in.
4. **Edge-runtime migration** of additional read-mostly owner-web
   routes (`/api/owner-overview/snapshot`) once the supabase-js edge
   adapter is verified.
5. **Real RUM** — pipe `/api/perf/web-vitals` into
   `@borjie/observability` so the platform-perf dashboard shows live
   p75 numbers per surface instead of the console-log placeholder.
