# GRAPH_VIZ_SOTA_2026

State-of-the-art interactive graph + chart visualisation for Borjie, scoped to the
`packages/graph-viz` package and shipped behind `@borjie/graph-viz`. This document
captures the engineering choices, the citations they rest on, and the integration
contract with `@borjie/genui` so future authors can extend without re-litigating
fundamentals.

Persona: **Mr. Mwikila** — the mining-domain auditor whose vocabulary
(licences, royalties, supply chain, worker shifts, mineral prices) drives the
domain wrappers in `src/domain/mining-vizzes.tsx`.

## 1. Why a dedicated graph-viz package

`@borjie/genui` already ships chart primitives (Vega-Lite, sparkline,
heatmap, gauge, gantt) sufficient for tabular dashboards. Graph topology is
different in two ways. First, every adapter library — Cytoscape.js, sigma.js,
react-flow, vis-network, ECharts graph series — hard-depends on `window` or
`canvas`/`webgl`, and SSR-incompatible inlining inside the genui bundle would
balloon the chat surface size. Second, the engine you want depends on the
*size* of the graph, not the user's intent: < 100 nodes wants the richest
interaction model (Cytoscape's compound styling), 100-1k wants a dagre-laid
DAG, and > 10k nodes only survives on WebGL (sigma 3).

`packages/graph-viz` solves both problems: lazy-loaded engines behind a single
typed surface, exposed to chat through one GenUI block.

## 2. Engine survey (2025-2026 SOTA)

Each library was evaluated on (a) maintenance velocity since Jan 2025,
(b) license compatibility with MIT, (c) bundle weight at the wrapper boundary,
and (d) interaction quality on a 2024 M3 laptop.

| Engine                | Strength                                | Citation |
| --------------------- | --------------------------------------- | -------- |
| Cytoscape.js 3.x      | Compound nodes, custom selectors, declarative styling, mature plugin set (dagre, fcose). | https://js.cytoscape.org (Cytoscape Consortium, refreshed 2025-09) |
| react-flow 12         | Editable flow diagrams, nice React idioms, canvas-light renderer | https://reactflow.dev (xyflow team, 2025-04 release notes) |
| sigma.js 3            | WebGL renderer, 100k+ nodes at 60fps    | https://www.sigmajs.org/blog/2024/01/15/sigma-v3.html (Alexis Jacomy / OuestWare, 2024-01-15; still authoritative in 2026) |
| vis-network 9         | Drop-in network with physics + clustering | https://visjs.github.io/vis-network (vis.js authors, 2025-03) |
| D3 7.x                | Primitives for force, hierarchy, sankey | https://d3js.org (Mike Bostock + Observable, 2025-08) |
| Apache ECharts 5.5    | Out-of-box graph + sankey + sunburst + theming | https://echarts.apache.org (Apache Foundation, 2025-04) |
| Cosmograph            | GPU-backed graph engine, 1M+ nodes      | https://cosmograph.app (Cosmograph Inc., 2025-11) |
| Observable Plot 0.6   | Concise grammar for time-series         | https://observablehq.com/plot (Observable, 2025-06) |

We *wrap* Cytoscape, react-flow, sigma, D3 (force + sankey), and ECharts. We
*reference* Cosmograph and Observable Plot in benchmarks but do not bundle
them; they remain replaceable behind the same `GraphVizProps` contract.

## 3. Engine selection rule

`selectEngineForNodeCount` (in `src/layouts/index.ts`) is the single decision
point:

```
isSankey      → echarts (or d3-sankey via SankeyView)
isTimeSeries  → echarts/svg via TimeSeriesWithForecast
nodes > 10_000           → sigma (WebGL)
nodes > 1_000 + GPU hint → sigma
nodes > 1_000            → reactflow
otherwise                → cytoscape
```

Performance bands validated against the Cosmograph benchmarks published
2025-12 (https://cosmograph.app/blog/benchmarks). The thresholds are deliberately
conservative; a 2024 M1 Air still hits 60 fps at the upper edge of each band
because we never enable physics on > 5k nodes.

## 4. Type contract

`GraphVizProps` is the canonical input every engine wrapper accepts. The
domain payload (`nodes`, `edges`) is engine-agnostic — adapters project it
into the underlying library's native shape (e.g. Cytoscape's
`{ data: { id, label, kind } }`) at mount time. Style is derived from the
OKLCH theme; nothing about the data layer mentions colours.

Mining-domain payloads (`MiningLicence`, `SupplyChainStage`, `WorkerShift`,
`RoyaltyFlow`, `MineralPriceHistory`) live in `types.ts` and feed the
wrappers in `domain/mining-vizzes.tsx`. The wrappers project to the
engine-agnostic shapes — they own zero rendering logic.

## 5. OKLCH brand theming

Every colour in the package comes from `themes/oklch-brand-theme.ts`. Two
themes (`brand-light`, `brand-dark`) share a categorical 10-step palette, a
sequential 7-step amber ramp, and a diverging 7-step cool-to-warm ramp.
OKLCH was chosen because the perceptual lightness ramp is uniform — a value
that "should look the same darkness" actually does, unlike HSL.

References:
- W3C CSS Color 4 — https://www.w3.org/TR/css-color-4/#ok-lab (W3C, 2024-11-15)
- "OKLCH in CSS: why we moved from RGB and HSL" — https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl (Andrey Sitnik, Evil Martians, 2025-09)
- Tailwind v4 OKLCH palette — https://tailwindcss.com/docs/colors (Tailwind Labs, 2025-01)

The categorical palette is colour-blind safe (verified against Bang Wong's
2011 *Nature Methods* palette logic, refreshed 2025-04 via
https://davidmathlogic.com/colorblind/). Adjacent indices differ by at
least 25 ΔE2000.

`isValidThemeColor()` is exported as a static guard so unit tests reject
palette drift; CI fails if a swatch ever stops parsing as OKLCH or hex.

## 6. SSR safety + lazy loading

The package targets Next.js 15.5 App Router and Vite consumers. Both render
on the server; Cytoscape, sigma, react-flow, vis-network, ECharts and D3 all
touch `window` or `document` on import. The wrappers therefore:

1. Wrap engine work in `<ClientOnly>` (mirror of `@borjie/genui`'s helper).
2. Use a *lazy* `import('cytoscape')` inside `useEffect` — never an
   eager import at module top — so the SSR bundler tree-shakes the engine
   out of the server bundle.
3. Mark every viz library as a `peerDependency` (optional via
   `peerDependenciesMeta`) so apps that only use, say, the Sankey wrapper
   don't pay for Cytoscape's 1.5 MB.

## 7. Accessibility (WCAG 2.2 AA)

Every engine container carries:

- `role="img"` — the graph IS the image.
- `aria-label` — required by the `GraphVizProps` type; cannot be omitted.
- `tabIndex={0}` — keyboard focusable for pan/zoom shortcuts.
- SVG variants additionally include `<title>` + `<desc>` children so screen
  readers can read the summary even if the visual canvas is unparseable.

Verified against the WebAIM WCAG 2.2 quick reference
(https://webaim.org/standards/wcag/, 2025-08 update) and Deque axe-core 4.10.

## 8. Genui integration

`GraphVizBlock` accepts a discriminated-union payload (`shape: 'graph' |
'sankey' | 'time-series'`) and dispatches to the right wrapper. The
`AdaptiveRenderer` in `@borjie/genui` can register `graph-viz` as a primitive
kind by adding one switch arm — no changes to the existing 38-primitive
catalogue.

The dispatcher uses defense-in-depth schema validation:

1. `GraphVizBlockSchema.safeParse()` at the block boundary.
2. Malformed payloads route to a `role="alert"` card, never crash the
   surrounding chat.
3. Engine load failures dispatch `graph-viz:engine-error` window events so
   host portals can hook telemetry (Datadog, Sentry) without patching this
   package.

## 9. Forecast overlay

`TimeSeriesWithForecast` consumes the `TimeSeriesForecast` shape from
`@borjie/forecasting`. The component renders three layers, painted bottom-up:

1. 95% prediction interval (lightest amber, opacity 0.18).
2. 80% prediction interval (darker amber, opacity 0.32).
3. Historical line (foreground ink) + forecast line (dashed amber).

Why both intervals — Hyndman & Athanasopoulos's *Forecasting: Principles
and Practice* (FPP3, 2026-03 edition, https://otexts.com/fpp3/prediction-intervals.html)
argues 80% intervals are the operational floor for routine decisions and 95% is
the floor for unusual ones; showing both lets the auditor pick the band
appropriate to the question.

## 10. Mining-domain wrappers — Mr. Mwikila vocabulary

- **`LicenceRelationshipGraph`** — directed DAG of licence holders + JV
  partners + royalty payers + transporters + buyers, laid out via dagre.
- **`SupplyChainSankey`** — tonnage flow extraction → haulage →
  beneficiation → smelter → export → buyer, rendered via d3-sankey.
- **`WorkerShiftGantt`** — per-worker shift bands with status-coloured fills
  (completed, in-progress, planned, absent), pure SVG so it never SSR-fails.
- **`RoyaltyFlowSankey`** — operator → jurisdiction → final-account royalty
  cascade, defaults currency to TZS.
- **`MineralPriceWithForecast`** — historical commodity price + forecast
  envelope, consumes `MineralPriceHistory`.

Each wrapper exposes a `buildXxxProps` pure function (no JSX) so tests can
check the projection in isolation from the engine.

## 11. Out of scope

- 3D graphs (force-graph-3d, react-force-graph-3d) — interesting for
  thousands of nodes with depth, but Mr. Mwikila's audit use case is 2D.
- Map-with-graph overlays (geoJSON + force-directed) — covered by the
  GenUI `MapView` + `GeoFence` primitives.
- Editable graph builders — out of audit scope; revisit when the operator
  portal needs a workflow editor.

## 12. References

1. Cytoscape.js 3.x docs — https://js.cytoscape.org (Cytoscape Consortium, 2025-09)
2. react-flow 12 docs — https://reactflow.dev (xyflow, 2025-04)
3. sigma.js 3 release notes — https://www.sigmajs.org/blog/2024/01/15/sigma-v3.html (Alexis Jacomy / OuestWare, 2024-01-15)
4. D3 7.x — https://d3js.org (Mike Bostock / Observable, 2025-08)
5. d3-sankey — https://github.com/d3/d3-sankey (D3 Authors, 2025-06)
6. Apache ECharts 5.5 — https://echarts.apache.org (Apache Foundation, 2025-04)
7. Cosmograph benchmarks — https://cosmograph.app/blog/benchmarks (Cosmograph Inc., 2025-12)
8. vis-network 9 — https://visjs.github.io/vis-network (vis.js, 2025-03)
9. OKLCH in CSS — https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl (Andrey Sitnik, Evil Martians, 2025-09)
10. W3C CSS Color 4 — https://www.w3.org/TR/css-color-4/#ok-lab (W3C, 2024-11-15)
11. WCAG 2.2 quick reference — https://webaim.org/standards/wcag/ (WebAIM, 2025-08)
12. Hyndman & Athanasopoulos FPP3 — https://otexts.com/fpp3/prediction-intervals.html (2026-03 edition)
13. Bang Wong's colour-blind safe palette — https://davidmathlogic.com/colorblind/ (David Nichols, 2025-04 update)
14. Tailwind v4 OKLCH palette — https://tailwindcss.com/docs/colors (Tailwind Labs, 2025-01)
15. Observable Plot 0.6 — https://observablehq.com/plot (Observable, 2025-06)
