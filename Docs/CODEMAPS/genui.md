# GenUI Codemap

**Last Updated:** 2026-05-22 (Piece G)
**Module:** `packages/genui/`
**Public entry:** `packages/genui/src/index.ts`
**Server entry:** `packages/genui/src/server.ts` (leaflet- / react-vega-free)
**Tier scope:** user surface (generative UI renderer) + Piece-G artifact pipeline

## Purpose

The generative-UI renderer. The Brain returns a typed `AgUiUiPart`
descriptor (kind + props) and `AdaptiveRenderer` picks the right
primitive from a registry — Vega charts, data tables, timelines,
KPI grids, prefilled forms, approval dialogs, workflow steppers,
maps, calendars, file previews, Kanban, dashboard grids, heatmaps.
Unknown kinds render `UnknownKindCard` and emit a custom event so
ops can spot gaps.

**Piece-G extension (2026-05-22):** the package now also owns the
canonical `ui_artifacts` catalog — a snake_case vocabulary the brain
emits over the SSE `ui_artifact` event channel — plus the SSR
pipeline (Playwright in production, deterministic stub in tests)
that rasterises an artifact to PNG / PDF / SVG / HTML for WhatsApp
media-send + email-attachment downstream consumers.

## Entry points

- `src/index.ts` — barrel exporting `AdaptiveRenderer`,
  `GENUI_REGISTRY`, `GENUI_KINDS`, and each primitive component.
- `src/AdaptiveRenderer.tsx` — root component.
- `src/registry.ts` — `GENUI_REGISTRY: Record<kind, Component>`.
- `src/components/` — `VegaChart`, `DataTable`, `Timeline`, `KpiGrid`,
  `PrefillForm`, `ApprovalDialog`, `WorkflowStepper`, `MapView`,
  `CalendarView`, `FilePreview`, `Kanban`, `DashboardGrid`, `Heatmap`,
  `UnknownKindCard`.
- `src/schemas/` — Zod schemas for each kind's props.
- `src/validate.ts` — runtime validation.

## Internal structure

- `components/Frame.tsx` — wrapper providing skeleton + error boundary.
- `genui-host-actions.ts` — host action handlers (approve, submit, etc).
- `format.ts` — value formatters used by all components.

## Dependencies

- Upstream: `@borjie/design-system`, Vega-Lite, Radix, zod.
- Downstream: chat-ui (renders streamed UI parts), owner-portal,
  estate-manager-app.

## Common workflows

- **Render a UI part** → `<AdaptiveRenderer part={part} onAction={fn} />`.
- **Add a new kind** → add Zod schema + component + registry entry +
  validate.ts case.
- **Handle action** → host listens via `genui-host-actions`.

## Anti-patterns to avoid

- Never render an unvalidated UI part — always `validate(part)` first.
- Never put business logic in a GenUI component — pure render.
- Never bypass the registry — extend it.
- Never swallow unknown-kind errors — let `UnknownKindCard` show.

## Related codemaps

- [chat-ui.md](./chat-ui.md) — streams UI parts to GenUI
- [design-system.md](./design-system.md) — primitives
- [central-intelligence.md](./central-intelligence.md) — emits UI parts

## Piece-G — inline UI artifacts pipeline

### Catalog vocabulary (`packages/genui/src/catalog.ts`)

Brain may only emit one of these 32 `component_type` keys. Each entry
has a Zod schema in the same file, a `partKind` that maps to the
existing `AdaptiveRenderer` primitive, and metadata flags
(`interactive`, `ssrCapable`) consumed by the brain's
`list_artifact_types` tool surface and the SSR scheduler.

| key | partKind | interactive | ssrCapable |
| --- | --- | --- | --- |
| `kpi_tile` | kpi-grid | no | yes |
| `bar_chart` | chart-vega | no | yes |
| `line_chart` | chart-vega | no | yes |
| `pie_chart` | chart-vega | no | yes |
| `data_table` | data-table | yes | yes |
| `form` | prefill-form | yes | no |
| `deck_slide` | markdown-card | no | yes |
| `doc_section` | markdown-card | no | yes |
| `map_view` | map | yes | yes |
| `heatmap` | heatmap | no | yes |
| `timeline` | timeline | no | yes |
| `kanban` | kanban | yes | yes |
| `gantt` | workflow | no | yes |
| `funnel` | chart-vega | no | yes |
| `metric_grid` | kpi-grid | no | yes |
| `image` | media-grid | no | yes |
| `video` | media-grid | yes | no |
| `code_block` | code-block | no | yes |
| `markdown` | markdown-card | no | yes |
| `callout` | markdown-card | no | yes |
| `comparison` | comparison-table | no | yes |
| `pivot_table` | data-table | yes | yes |
| `sparkline` | metric-sparkline | no | yes |
| `treemap` | chart-vega | no | yes |
| `sankey` | chart-vega | no | yes |
| `scatter` | chart-vega | no | yes |
| `gauge` | gauge | no | yes |
| `radar` | chart-vega | no | yes |
| `box_plot` | chart-vega | no | yes |
| `histogram` | chart-vega | no | yes |
| `org_chart` | org-chart | no | yes |
| `workflow` | workflow | no | yes |

### Streaming contract

Brain emits an artifact via a typed SSE event:

```text
event: ui_artifact
data: {
  "id": "art-…",
  "tenantId": "tenant-…",
  "componentType": "kpi_tile",
  "props": { … },
  "data": { … },
  "title": "Optional title",
  "streaming": false        // true while accumulating; false on complete
}
```

`packages/chat-ui/src/generative-ui/ChatArtifactStream.tsx` is the
client receiver: it renders a shimmer placeholder for `streaming:
true` candidates and a full `<UiArtifact>` for completed ones. It
fires the host-supplied `persistArtifact` callback once per
completed row to write into `ui_artifacts`.

### Render pipeline (server side)

- Composition: `services/api-gateway/src/composition/artifact-render-wiring.ts`
- Router:      `services/api-gateway/src/routes/artifacts.hono.ts`
- Adapters:    `createPlaywrightArtifactRenderer` (prod) +
               `createStubArtifactRenderer` (tests)
- Endpoint:    `GET /api/v1/artifacts/:id/render?format=png|pdf|svg|html`
- Cache:       `artifact_render_cache` (Postgres) keyed by
               (artifact_id, format); cascades on parent delete.

The Playwright adapter spins up Chromium, navigates to the customer-
app's `/artifact-renderer?id=…` page, waits for the
`[data-testid="ui-artifact"]` mount, and exports via `page.screenshot`
/ `page.pdf`. The deterministic stub is bytes-perfect for testing.

### Persistence schema

Three migrations land in `packages/database/src/migrations/`:

- `0205_ui_artifacts.sql` — canonical store; RLS gold pattern.
- `0206_tenant_brand_themes.sql` — per-tenant theme tokens; deferred
  FK from 0205 added in this migration.
- `0207_artifact_render_cache.sql` — Playwright output cache; RLS
  via SECURITY DEFINER resolver so the cache table does not duplicate
  `tenant_id`.

### Validation layers (defence-in-depth)

1. Brain emits a `tool-call` to `emit_artifact(component_type, props, data)`.
2. Server-side schema check via the catalog Zod schema before writing.
3. Client-side schema check at `<UiArtifact>` mount (delegates to
   `validateAndRender`).
4. Per-primitive `safeParse` inside the React component (legacy).

Any failure routes to `UnknownKindCard` with a structured diagnostic.

### Tests landed in Piece G

- `packages/genui/src/__tests__/catalog.test.ts` — 100 tests (1 acceptance
  + 2 rejection per catalog entry plus catalog-shape checks).
- `packages/genui/src/__tests__/ui-artifact.test.tsx` — 17 tests
  (validator + React render).
- `packages/chat-ui/src/__tests__/chat-artifact-stream.test.tsx` — 6
  tests covering the streaming contract.
- `services/api-gateway/src/composition/__tests__/artifact-render-wiring.test.ts`
  — 13 tests (stub renderer + service orchestration).
- `services/api-gateway/src/routes/__tests__/artifacts.router.test.ts`
  — 9 tests (HTTP contract).
