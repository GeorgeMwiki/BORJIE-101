# Reports Service Codemap

**Last Updated:** 2026-05-22
**Module:** `services/reports/`
**Public entry:** `services/reports/src/index.ts`
**Tier scope:** platform spine (PDF/Excel/CSV generation + delivery)

## Purpose

Generates, schedules, and delivers tenant-facing documents. Output
formats: PDF, Excel, CSV. Handles financial statements, occupancy
summaries, arrears, compliance evidence packs, and interactive web
outputs. Pluggable data provider so the same templates run against
production, sandbox, or mock data.

## Entry points

- `src/index.ts` — barrel.
- `src/report-generation-service.ts` — `createReportService(deps)`,
  `generateReport(type, ctx, format)`.
- `src/data-provider.interface.ts` — `ReportDataProvider` port.
- `src/generators/` — per-format generators.
- `src/templates/` — `financial`, `occupancy`, `arrears`, etc.
- `src/scheduler/` — cron-style scheduler.
- `src/storage/` — `InMemoryReportStorage` + S3 storage.
- `src/jobs/` — long-running pipelines.
- `src/interactive/` — interactive web outputs.
- `src/compliance/` — SOX / SOC2 evidence outputs.

## Internal structure

- One folder per concern.
- `services/` — orchestration glue.
- `types/` — request/response shapes.
- `common/` — shared utilities.

## Dependencies

- Upstream: `@borjie/observability`, puppeteer/pdfkit (PDF),
  exceljs (Excel), `@borjie/forecasting` (interactive charts).
- Downstream: domain-services, owner-portal views, notifications
  (delivery).

## Common workflows

- **Generate ad-hoc** →
  `reportService.generateReport('financial', { tenantId }, 'pdf')`.
- **Schedule recurring** →
  `scheduler.add({ cron, template, recipients })`.
- **Deliver** → output piped through notifications-service.
- **List** → `reportService.listReports({ tenantId })`.

## Anti-patterns to avoid

- Never generate without tenant scope on the data provider.
- Never embed PII in filename — use opaque IDs.
- Never bypass storage interface — could leak to wrong tenant.
- Never run scheduler in two replicas without distributed lock.

## Related codemaps

- [database.md](./database.md) — data source
- [notifications-service.md](./notifications-service.md) — delivery
- [observability.md](./observability.md) — audit + metrics
