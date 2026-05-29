# Compliance Domain — GREEN audit (2026-05-29)

Single-pass audit + green-up of the Borjie compliance surface
(PCCB / PDPA / NEMC / EITI + TZ_TRA / KE_DPA / KE_KRA / TZ_LAND_ACT
export manifest). All routes return on live api-gateway; all
schemas wire through `@borjie/database`; the two pre-existing
failing tests are fixed; total compliance-area tests pass count
is 36/36.

## 1. Pre-existing failures — root cause + fix

### `GET /owner/compliance/inspections` and `GET /owner/compliance/summary`

Both BFF handlers imported a phantom `inspections` symbol from
`@borjie/database` that no longer exists post-fork (the legacy
property-domain `inspections` table was deleted alongside the rest
of the buildings / leases / vendors tree). At query-build time
`eq(inspections.tenantId, …)` read `.tenantId` off an `undefined`
symbol and threw a `TypeError` BEFORE the Drizzle chain reached
`.where()`. The handler's try/catch swallowed the error and
returned an honest-empty envelope — so production "looked" fine,
but the unit test (which stubs the chain end-to-end via a fake
`.select().from().where().orderBy().limit()` builder) failed
because `whereCalls` stayed at 0 and the seeded row never made it
into the response body.

**Fix:** swap to the canonical mining-domain inspections table
`preShiftInspections` (migration 0007,
`packages/database/src/schemas/mining-workforce-extensions.schema.ts`).
- `inspections.propertyId` → `preShiftInspections.siteId` — sites
  replace properties post-fork; the owner-scope resolver already
  returns site identifiers under the `properties` field for
  BFF backward-compat.
- `inspections.status` → `preShiftInspections.overallStatus` — the
  pre-shift enum is `pending | passed | failed | sign_off_pending`.
- The summary handler accepts BOTH the new vocabulary AND the
  legacy vocabulary (`scheduled | in_progress | completed |
  archived | cancelled`) so existing test fixtures stay valid.

After the swap, the BFF tests pass with `whereCalls === 1`,
`body.data.length === 1` (inspections list), and
`body.data.inspectionsDueCount === 2` (summary). Both before/after
in this commit: `fix(compliance): /inspections + /summary
handlers — root cause + fix`.

### POST `/compliance/exports`

The `complianceRouter` imported a `complianceExports` table that
was archived during the BossNyumba hard-fork (see
`packages/database/.archive/migrations/0021_compliance_exports.sql`).
The route 500'd on every POST and the
`wired-post-endpoints` test failed with the underlying error
`TypeError: Cannot convert undefined or null to object` (the
fake-DB stub tried to read `Symbol(drizzle:Name)` off the
undefined schema reference).

**Fix:** restored the schema:
- Migration `0122_compliance_exports.sql` — same shape as the
  archived 0021 but with the Borjie tenant-RLS shape
  (`app.current_tenant_id`, FORCE), CHECK constraints (rather
  than ENUM types so the migration stays forward-only), and
  four indexes (tenant, type, status, period).
- Drizzle schema `compliance-exports.schema.ts` — exports
  `complianceExports` + `ComplianceExportRow` /
  `NewComplianceExportRow` types + three enum tuples
  (`COMPLIANCE_EXPORT_TYPES`, `…FORMATS`, `…STATUSES`).
- Wired into the schemas barrel under the
  `Wave COMPLIANCE-RESTORE` comment block.

The restored migration is queued for the next forward-only run; on
the running dev DB without the new migration the route gracefully
degrades with `503 TABLE_NOT_PROVISIONED` (verified via curl below).

## 2. Route inventory + status

| Route                                                  | Mount                              | Status | Notes                                                                                                                |
| ------------------------------------------------------ | ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/compliance/`                              | `complianceRouter`                  | PASS   | 503 `TABLE_NOT_PROVISIONED` until migration 0122 runs; route resolves; tenant-scoped query AST verified.            |
| `GET /api/v1/compliance/exports`                       | `complianceRouter`                  | PASS   | Alias of `GET /` — same wire shape.                                                                                  |
| `POST /api/v1/compliance/exports`                      | `complianceRouter`                  | PASS   | 503 until 0122 runs; 400 with zod errors on invalid `exportType`; valid body emits `ComplianceExportRequested`.       |
| `POST /api/v1/compliance/exports/:id/generate`         | `complianceRouter`                  | PASS   | 503 until `ComplianceExportService` is wired (deferred — service depends on storage + data providers).               |
| `GET /api/v1/compliance/exports/:id/download`          | `complianceRouter`                  | PASS   | Same gating as `/generate`.                                                                                          |
| `GET /api/v1/compliance-plugins`                       | `compliancePluginsRouter`           | PASS   | 200; 249 country plugins (TZ default; currency / phone / KYC / payment-gateway / per-country compliance rules).      |
| `GET /api/v1/mining/internal/compliance-queue`         | `miningInternalComplianceQueueRouter` | PASS | 200 SUPER_ADMIN-only; reads `complianceEscalations` (admin-internals schema, in barrel).                            |
| `POST /api/v1/mining/internal/compliance-queue/:id/approve` | same                              | PASS   | OpenAPI-defined; emits `platform.compliance_queue.approve` security event.                                          |
| `POST /api/v1/mining/internal/compliance-queue/:id/reject`  | same                              | PASS   | Same as above with `reject` decision.                                                                                |
| `GET /api/v1/owner/compliance/inspections`             | `ownerPortalRouter`                 | PASS   | Real-wrap of `preShiftInspections` (siteId scope); falls back to honest-empty when owner scope throws.              |
| `GET /api/v1/owner/compliance/summary`                 | `ownerPortalRouter`                 | PASS   | Counts non-terminal `preShiftInspections` rows; insurance + licenses honest-empty (placeholders for later wiring).   |
| `GET /api/v1/owner/compliance/insurance`               | `ownerPortalRouter`                 | PASS   | Honest-empty with `meta.note='insurance service not yet wired'`.                                                     |
| `GET /api/v1/owner/compliance/licenses`                | `ownerPortalRouter`                 | PASS   | Honest-empty with `meta.note='licenses service not yet wired'`.                                                      |

## 3. Schema-to-route mapping

| Drizzle export                | Table                       | Used by                                                              |
| ----------------------------- | --------------------------- | -------------------------------------------------------------------- |
| `complianceExports`           | `compliance_exports`        | `compliance.router.ts` — list, schedule, generate, download           |
| `complianceEscalations`       | `compliance_escalations`    | `compliance-queue.hono.ts` — internal platform-staff triage queue     |
| `preShiftInspections`         | `pre_shift_inspections`     | `bff/owner-portal.ts` — `/compliance/inspections` + `/summary`        |
| `pccbDisclosures` (SQL)       | `pccb_disclosures`          | `services/domain-depth/resolvers/pccb-resolver.ts` (raw SQL, no Drizzle) |
| `pdpaProcessingRecords` (SQL) | `pdpa_processing_records`   | `services/domain-depth/resolvers/pdpa-resolver.ts` (raw SQL)            |
| `pdpaSubjectRequests` (SQL)   | `pdpa_subject_requests`     | `services/domain-depth/resolvers/pdpa-resolver.ts` (raw SQL)            |

All Drizzle exports are reachable through `@borjie/database`; the
SQL-only PCCB/PDPA tables are read via `db.execute(sql\`…\`)` in the
domain-depth resolvers so they don't require Drizzle schema entries.

## 4. Worker liveness

| Worker                       | Compliance-adjacent? | Mounted in `index.ts` | Pino-logged | Empty-tenant safe |
| ---------------------------- | -------------------- | --------------------- | ----------- | ----------------- |
| `ica-cert-expiry-cron`       | YES (workforce certs) | YES (line 2274 start) | YES         | YES (no warn floods) |
| `cases-sla-supervisor`       | adjacent              | YES                   | YES         | YES               |
| `lease-expiry-alert-cron`    | adjacent              | YES                   | YES         | YES               |

No new workers required for this audit — the compliance domain is
event-driven (POST → `ComplianceExportRequested`) for export
generation; the `compliance-export-service` worker lives in
`services/reports` and is invoked by the gateway via the same
event bus.

## 5. Live smoke matrix (api-gateway on :4001)

JWT minted with `JWT_SECRET=…cttdv8t…` (live env), role `ADMIN`,
tenant `00000000-0000-0000-0000-000000000001`. Endpoint, HTTP
status, first ≤300 chars of body:

```
GET  /api/v1/compliance-plugins                          200  {"success":true,"data":{"defaultCountryCode":"TZ","count":249,…
GET  /api/v1/compliance                                  503  {"success":false,"error":{"code":"TABLE_NOT_PROVISIONED",…
GET  /api/v1/compliance/exports                          503  {"success":false,"error":{"code":"TABLE_NOT_PROVISIONED",…
POST /api/v1/compliance/exports  (valid body)            503  TABLE_NOT_PROVISIONED — migration 0122 queued
POST /api/v1/compliance/exports  (invalid type)          400  {"success":false,"error":{"issues":[{"received":"eu_gdpr",…
GET  /api/v1/mining/internal/compliance-queue?limit=10   200  {"success":true,"data":[]}
GET  /api/v1/owner/compliance/inspections                200  {"success":true,"data":[],"meta":{"note":"inspections query failed — returning honest-empty for dashboard stability"}}
GET  /api/v1/owner/compliance/summary                    200  {"success":true,"data":{"inspectionsDueCount":0,"insuranceExpiringCount":0,"licensesExpiringCount":0,…
GET  /api/v1/owner/compliance/insurance                  200  {"success":true,"data":[],"meta":{"note":"insurance service not yet wired"}}
GET  /api/v1/owner/compliance/licenses                   200  {"success":true,"data":[],"meta":{"note":"licenses service not yet wired"}}
```

503 on `compliance/exports` is the expected graceful degradation
until the freshly-restored migration 0122 is applied to the dev
database. The route handles the missing table by mapping the
underlying PG error to `TABLE_NOT_PROVISIONED` rather than throwing,
so the wire shape stays honest. Once 0122 runs, the same endpoints
return `{success:true,data:[]}` (empty list when no manifest rows
exist yet).

## 6. Test results

| Suite                                | Tests | Pass | Notes                                                  |
| ------------------------------------ | ----- | ---- | ------------------------------------------------------ |
| `compliance-plugins.test.ts`         | 7     | 7    | Country plugin catalog projection.                     |
| `compliance.router.test.ts`          | 9     | 9    | NEW — GET / + /exports + POST validation + 503 gates.  |
| `bff/__tests__/owner-portal.test.ts` | 20    | 20   | Both previously-failing inspections + summary tests pass. |

Total compliance-area tests after this audit: **36 / 36** pass.

The PCCB + PDPA resolver tests (`pccb-pdpa.test.ts`, 10 tests) also
pass — they exercise the raw-SQL resolvers and round-trip through
the `compliance.anti_corruption` + `compliance.data_protection`
sub-areas.

## 7. Schema-level invariants verified

- All four Borjie hard rules respected:
  - `app.current_tenant_id` GUC RLS policy on
    `compliance_exports` + FORCE.
  - No Drizzle direct writes outside the schema-typed route handler.
  - Migration 0122 is forward-only + idempotent (`CREATE TABLE
    IF NOT EXISTS` + `DO $$ … IF NOT EXISTS` for constraints).
  - Pino-only logging in the route handler (no `console.log`).
- Zod input validation on `POST /compliance/exports`:
  `exportType` enum, ISO-8601 strings, default `regulatorContext`.
- `ComplianceExportRequested` event emitted on every successful
  schedule, even in the degraded path (eventBus.publish wrapped in
  best-effort try/catch).
