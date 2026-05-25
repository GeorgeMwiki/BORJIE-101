# Presentation Engine Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/presentation-engine/`
**Public entry:** `packages/presentation-engine/src/index.ts`
**Tier scope:** all tenants
**Migration:** `0209_presentation_themes.sql`

## Purpose

Piece H — slide-deck renderer. Mounts on top of
`@borjie/report-engine`'s PPTX renderer with a tenant-branded
theme override. Each slide is also emitted as a Piece-G-compatible
`DeckSlideArtifact` so the same data drives both the .pptx file and
the conversational UI (`ui_artifacts.component_type='deck_slide'`).

Built-in themes: `classic_corporate`, `modern_clean`, `minimal_dark`,
`government_serious`, `africa_warm`.

## Entry points

- `orchestrator.ts` → `createPresentationOrchestrator(deps)
  .renderPresentation({ tenantId, templateSlug, themeSlug, params })`
  returns `{ buffer, slideArtifacts, ... }`.
- `themes/built-in.ts` → `BUILT_IN_THEMES`, mirror of the 5 SQL-seeded
  themes. Each carries dimensions / colour palette / fonts / logo
  position / layouts.
- `slide-builder.ts` → fluent API:
  `addTitleSlide / addBulletSlide / addChartSlide / addImageSlide /
  addSectionDivider`.
- `chart-render.ts` → `renderChartToPng({ spec, vegaRenderer? })`
  produces a PNG. With no vega renderer it emits a coloured
  placeholder so the pipeline never breaks.

## Internal structure

- `types.ts` — `Slide`, `SlideKind`, `DeckSlideArtifact`,
  `RenderPresentationInput/Output`, `PresentationEngineError`.
- `themes/built-in.ts` — 5 themes; `PresentationTheme` type.
- `orchestrator.ts` — loads template + theme + brand, expands
  sections into slides via `SlideBuilder`, renders to `.pptx` via
  report-engine's `renderReportPptx` with the theme override.
- `slide-builder.ts` — accumulates slides; `snapshot()` returns
  immutable list.
- `chart-render.ts` — `renderChartToPng` + minimal PNG encoder
  (placeholder, used when no vega renderer is wired).
- `__tests__/orchestrator.test.ts` — renders Q3 strategy in all 5
  themes, asserts deck-artifact shape and theme-driven byte diff.

## Dependencies

- Upstream: consumers in chat-ui / Owner Portal that need slide
  artifacts alongside the .pptx (Piece G).
- Downstream: `@borjie/report-engine` (template store, data
  adapter, PPTX renderer). `packages/database` (`presentation_themes`
  table, migration 0209).
- Optional runtime dep: `vega` + `vega-lite` for chart rasterisation.
  When absent, the engine falls back to a coloured placeholder PNG.

## Common workflows

- Render a deck → `orchestrator.renderPresentation({ tenantId, templateSlug, themeSlug, params })`.
- Theme override (tenant brand) → `themeStore.registerTenantTheme(theme)`.
- Custom deck without a template → build slides directly with `SlideBuilder` and hand them to `renderReportPptx`.
- Visual diff across themes → render the same template under two themes; the two `.pptx` buffers must differ byte-wise (test asserts this).

## Anti-patterns to avoid

- Don't render `.pptx` directly from raw vega specs without going
  through `renderChartToPng` — the orchestrator handles chart
  pre-rasterisation so the .pptx is self-contained.
- Don't put a theme into a tenant-scope row with `tenantId: null` —
  the `registerTenantTheme` guard rejects that.
- Don't hardcode pptxgenjs / officegen calls anywhere. The renderer
  hooks into report-engine's `pptx` renderer; alternatives plug in
  via the orchestrator override.
- Don't emit `DeckSlideArtifact` shapes that drift from Piece G's
  `ui_artifacts.component_type='deck_slide'` schema — keep the
  artifact shape conservative.

## Related codemaps

- [report-engine.md](./report-engine.md) — provides the PPTX
  renderer + template store.
- [genui.md](./genui.md) — same Vega-Lite chart specs feed the
  in-app chart components.
- [database.md](./database.md) — `presentation_themes` table.
- [tutoring-skill-pack.md](./tutoring-skill-pack.md) — Piece H
  sibling.
