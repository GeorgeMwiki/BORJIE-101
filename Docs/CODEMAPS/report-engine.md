# Report Engine Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/report-engine/`
**Public entry:** `packages/report-engine/src/index.ts`
**Tier scope:** all tenants
**Migration:** `0208_report_templates.sql`

## Purpose

Piece H — AI-powered reports. Given a template slug ("q3_strategy",
"monthly_revenue", "condition_survey", "board_pack", etc.) and a
target output format (`pdf` / `docx` / `pptx`), the orchestrator
resolves placeholders against live tenant data and emits the file in
the tenant's brand. Built-in templates ship with the platform; tenants
can author overrides via the `report_templates` table.

The renderer is dependency-free for the standard fast path — PDF is
hand-rolled (1.4 spec), DOCX + PPTX synthesise the minimal OOXML
package. Composition roots can swap in Playwright (PDF) or
docxtemplater / pptxgenjs via the `RendererOverrides` injection point.

## Entry points

- `orchestrator.ts` → `createReportOrchestrator(deps).renderReport({
  tenantId, templateSlug, outputFormats, params })` — returns
  `{ files: RenderedReportFile[] }`.
- `templates/built-in.ts` → `BUILT_IN_TEMPLATES`,
  `InMemoryReportTemplateStore`. TS mirror of the 7 SQL-seeded
  built-ins.
- `data-source.ts` → `InMemoryReportDataAdapter`,
  `createDevDataAdapter()` — reference data-adapter for tests and dev.
- `renderers/{pdf,docx,pptx}.ts` → `renderReportPdf`,
  `renderReportDocx`, `renderReportPptx`. Functional, no class
  required.
- `ooxml-zip.ts` → `writeZip` + `escapeXml`. Shared by DOCX/PPTX.

## Internal structure

- `types.ts` — `ReportTemplate`, `ReportFormat`, `ResolvedReportSection`,
  `ReportDataAdapter`, `TenantBrandResolver`, `ReportTemplateStore`,
  `RenderReportInput/Output`, `ReportEngineError`.
- `templates/built-in.ts` — 7 platform built-ins: `monthly_revenue`,
  `occupancy_report`, `arrears_aging`, `condition_survey`,
  `q3_strategy`, `board_pack`, `customer_statement`.
- `renderers/pdf.ts` — minimal PDF 1.4 (text + tables + KPIs); 8.5"x11"
  pagination.
- `renderers/docx.ts` — OOXML wordprocessingml synthesizer; valid
  in Word / LibreOffice / Google Docs.
- `renderers/pptx.ts` — OOXML presentationml synthesizer; 16:9
  default, configurable via theme override.
- `presentation-types.ts` — `PresentationSlideMasterSpec` shared
  with `@borjie/presentation-engine`.
- `data-source.ts` — adapter contract + in-memory dev adapter with
  seeded handlers for every built-in template's data keys.
- `__tests__/` — `orchestrator.test.ts` (7 × all formats), parity
  test against migration 0208, renderer-level unit tests, adapter
  tests.

## Dependencies

- Upstream: composition roots in `services/api-gateway/` and
  `services/reports/` wire the orchestrator with real
  payments-ledger / occupancy / KPI repositories as data adapter.
- Downstream:
  - `packages/database` (`report_templates` table, migration 0208)
  - `packages/presentation-engine` reuses the `pptx` renderer +
    `PresentationSlideMasterSpec`.
- Zero new third-party deps. The hand-rolled OOXML/PDF synthesizers
  mirror the existing pattern in
  `services/domain-services/src/documents/renderers/`.

## Common workflows

- Render a built-in report → `orchestrator.renderReport({ tenantId, templateSlug, outputFormats, params })`.
- Register a tenant override → `store.registerTenantOverride(template)`.
- Swap to Playwright PDF → pass `renderers: { pdf: ... }` to the orchestrator constructor.
- Add a data source → register a `DataSourceHandler` on the adapter; production version delegates to a typed repository.

## Anti-patterns to avoid

- NEVER construct SQL from LLM output. Data adapters MUST dispatch
  to typed repository methods.
- Never hard-code KES / TZS / NGN currency symbols — the brand
  resolver carries `displayName` plus an optional `fontFamily`; the
  rendered tenant brand is the only place currency literals belong.
- Never edit shipped migrations. The seed list in 0208 + the TS
  mirror in `templates/built-in.ts` must stay parity-tested.
- Renderers MUST NOT mutate inputs — output is a pure function of
  inputs.
- For PDFs that need pixel-accurate fonts / images, switch to the
  Playwright override; the default fast path is intentionally
  text-only.

## Related codemaps

- [presentation-engine.md](./presentation-engine.md) — mounts on
  top of this engine's PPTX renderer.
- [svc-reports.md](./svc-reports.md) — legacy reports service;
  ongoing migration to this engine.
- [database.md](./database.md) — `report_templates` table.
- [tutoring-skill-pack.md](./tutoring-skill-pack.md) — Piece H
  sibling.
