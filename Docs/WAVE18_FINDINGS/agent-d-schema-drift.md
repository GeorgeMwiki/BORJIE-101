# Wave 18 — Agent D: Schema-Code Drift Audit

Scope: every drizzle column reference and raw-SQL table/column reference in
`services/` and `packages/` (excluding `apps/` and route handlers owned by
other agents). Every drift identified here could trigger a runtime 500 the
same way the `properties.currentValue` / `properties.marketValue` bug did.

All fixes are additive — no columns dropped, no tables dropped.

## Drift bugs found (7)

### 1. `invoices.issued_at` does not exist — SQLSTATE 42703 at runtime
- File: `services/api-gateway/src/composition/credit-rating-repository.ts`
  lines 90–91 (before fix)
- Problem: raw SQL used `MAX(i.issued_at)` and `MIN(i.issued_at)`. The real
  column on `invoices` is `issue_date` (see `packages/database/src/schemas/
  payment.schema.ts` line 101). This query is NOT wrapped in try/catch and
  the endpoint `GET /api/v1/credit-rating/…/inputs` would 500 the moment a
  tenant had any invoice.
- Fix: rewrote the select to `MAX(i.issue_date) … MIN(i.issue_date)`. Added a
  schema-drift comment pointing at the real column name.

### 2. `tenant_financial_statements.monthly_rent_minor_units` & `monthly_income_minor_units` do not exist
- File: `services/api-gateway/src/composition/credit-rating-repository.ts`
  lines 150–172 (before fix)
- Problem: raw SQL selected `monthly_rent_minor_units, monthly_income_minor_units`.
  The real columns are `monthly_gross_income`, `monthly_net_income`,
  `other_income`, `monthly_expenses`, `monthly_debt_service` etc. (see
  `tenant-finance.schema.ts` lines 87–97). Rent is NOT stored on this table
  at all. Also ordered by nonexistent `reported_at`.
- Fix: rewrote to `SELECT monthly_gross_income, monthly_net_income … ORDER BY
  updated_at DESC`. Pulled rent from the latest lease (`leases.rent_amount`)
  instead. Kept inside a try/catch — still a silent-degrade path if the
  probe fails.

### 3. `cases.category` does not exist; enum values wrong
- File: `services/api-gateway/src/composition/credit-rating-repository.ts`
  lines 176–196 (before fix)
- Problem: raw SQL filtered `category = 'dispute' | 'damage_deduction' | 'sublease_violation'`.
  The real column is `case_type` (enum `case_type`) and none of those values
  are in the enum. Valid values are `arrears`, `deposit_dispute`, `damage_claim`,
  `lease_violation`, `noise_complaint`, `maintenance_dispute`, `eviction`,
  `harassment`, `safety_concern`, `billing_dispute`, `other`
  (`cases.schema.ts` lines 28–40). Errors were caught but every count came
  back 0 forever, so the credit-rating dispute dimension never contributed
  signal.
- Fix: switched to `case_type` with real enum values:
  - dispute ← `billing_dispute`, `deposit_dispute`, `maintenance_dispute`, `noise_complaint`
  - damage_deduction ← `damage_claim`
  - sublease_violation ← `lease_violation`

### 4. `maintenance_cases` table does not exist — live-metrics-source
- File: `services/domain-services/src/property-grading/live-metrics-source.ts`
  lines 207–224 (before fix)
- Problem: queried `FROM maintenance_cases` with columns `resolved_at`,
  `opened_at`, `actual_cost_minor_units`. No such table in any schema or
  migration (`maintenance.schema.ts` defines `maintenance_requests`,
  `work_orders`, etc.). Error was caught, so maintenance dimension was
  permanently zero.
- Fix: rewrote to query `work_orders` (`created_at → completed_at`,
  `actual_cost`). Updated the module-level doc block and the function-level
  comment.

### 5. `maintenance_cases` table does not exist — mcp-wiring
- File: `services/api-gateway/src/composition/mcp-wiring.ts` lines 210–235
  (before fix)
- Problem: the `list_maintenance_cases` MCP handler raw-SQL’d
  `FROM maintenance_cases` with columns `id, status, severity, assigned_to,
  problem_code, description, created_at`. Again no such table. Also
  `problem_code` isn’t on `cases` either. The MCP tool returned a
  `QUERY_FAILED` every call in any real environment.
- Fix: rewrote to `SELECT id, status, severity, assigned_to, case_type,
  title, description, created_at FROM cases WHERE case_type IN
  ('maintenance_dispute','damage_claim')`.

### 6. `compliance_status` enum does not include `'breached'`
- File: `services/domain-services/src/property-grading/live-metrics-source.ts`
  line 242 (before fix)
- Problem: `status IN ('breached','overdue')`. The `compliance_status` enum
  only accepts `pending, in_progress, compliant, non_compliant, overdue,
  waived, cancelled` (`compliance.schema.ts` lines 42–50). Passing
  `'breached'` raises SQLSTATE 22P02. Error was caught, so the property
  grade "complianceBreachCount" dimension was stuck at 0.
- Fix: switched to `status IN ('non_compliant','overdue')`.

### 7. `property_valuations` table referenced but never existed
- File: `services/domain-services/src/property-grading/live-metrics-source.ts`
  lines 172–192
- Problem: property-grading portfolio endpoint probes `property_valuations`
  for asset-value weighting hints; the table was never defined in any
  schema or migration, so the probe always errored and the endpoint
  equal-weighted portfolios silently. Not a runtime 500 (try/catch), but
  the feature was non-functional.
- Fix: added migration 0090 + drizzle schema (see below). Code unchanged —
  the existing SELECT now returns real rows once data is loaded.

## Migrations added (1)

| File | Description |
|---|---|
| `packages/database/src/migrations/0090_property_valuations.sql` | Additive + idempotent `CREATE TABLE IF NOT EXISTS property_valuations` with `tenant_id`, `property_id`, `amount_minor_units`, `currency`, `source`, `appraiser_name`, `report_url`, `valued_at`, `notes`, audit columns, and two indices (`(tenant_id, property_id, valued_at DESC)` and `(tenant_id, valued_at DESC)`). |

## Schema changes (1)

| File | Summary |
|---|---|
| `packages/database/src/schemas/property-valuations.schema.ts` | New drizzle schema mirroring 0090. Exports `propertyValuations` table, `propertyValuationsRelations` (tenant/property), and `$inferSelect`/`$inferInsert` types. |
| `packages/database/src/schemas/index.ts` | Added `export * from './property-valuations.schema.js';` under the property-grading block. |

## Code fixes landed (3 files)

| File | Kind | Lines |
|---|---|---|
| `services/api-gateway/src/composition/credit-rating-repository.ts` | 3 drift-bug fixes (#1, #2, #3) | ~30 net changes |
| `services/api-gateway/src/composition/mcp-wiring.ts` | 1 drift-bug fix (#5) | ~12 net changes |
| `services/domain-services/src/property-grading/live-metrics-source.ts` | 2 drift-bug fixes (#4, #6) + doc touch-up | ~25 net changes |

## Tables/columns I verified exist (by reading schema + referencing code)

- `properties`: `id, tenant_id, owner_id, property_code, name, type, status,
  address_line1/2, city, state, postal_code, country, latitude, longitude,
  total_units, occupied_units, vacant_units, default_currency, amenities,
  features, manager_id, management_notes, images, documents, year_built,
  acquired_at, created_at, updated_at, created_by, updated_by, deleted_at,
  deleted_by`.
  - **No** `currentValue`, `marketValue`, `builtYear` (the last one is
    handled at `live-metrics-source.ts` line 252 with a multi-alias fallback).
- `units`: standard shape, `current_lease_id`/`current_customer_id` present.
- `invoices`: `issue_date` (NOT `issued_at`), `due_date`, `status`,
  `total_amount`, `paid_amount`, `customer_id`, `tenant_id`, `invoice_type`.
- `payments`: `completed_at`, `status`, `amount`, `invoice_id`, `customer_id`.
- `leases`: `start_date`, `end_date`, `status`, `rent_amount`, `tenant_id`,
  `customer_id`, `termination_date`, `termination_reason`.
- `cases`: `case_type` (enum, NOT `category`), `status`, `severity`,
  `resolution_due_at`, `customer_id`, `case_number`, `assigned_to`.
- `tenant_financial_statements`: `monthly_gross_income`, `monthly_net_income`,
  `other_income`, `monthly_expenses`, `monthly_debt_service`, `existing_arrears`,
  `status`, `updated_at`. (**No** `monthly_rent_minor_units`, `monthly_income_minor_units`,
  or `reported_at`.)
- `work_orders`: `created_at`, `completed_at`, `actual_cost`, `estimated_cost`,
  `status`, `priority`, `category`, `property_id`, `tenant_id`.
- `compliance_items`: `entity_type`, `entity_id`, `status` (enum), `due_date`,
  `completed_date`. Enum values: `pending, in_progress, compliant,
  non_compliant, overdue, waived, cancelled`.
- `credit_rating_snapshots`, `credit_rating_promises`, `credit_rating_weights`,
  `credit_rating_sharing_opt_ins`: fully aligned with migration 0089; every
  column accessed in repo code exists.
- `webhook_delivery_attempts`, `webhook_dead_letters`: every column used in
  `background-wiring.ts` exists.
- `classroom_sessions`, `bkt_mastery`: every column used in
  `classroom-wiring.ts` exists.
- `autonomy_policies`: every column used in `autonomy-policy-repository.ts`
  exists (verified against 0080 migration).
- `arrears_cases`: every column used in `arrears-infrastructure.ts` INSERT
  and SELECT exists.
- `tenants.is_active` (referenced by `background-wiring.ts`): present on
  the `tenants` table (confirmed line 152/251 of `tenant.schema.ts`).

## Suspicious but not-touched (with reason)

- **`live-metrics-source.ts` `extractAgeYears(row)`** tests `row.builtYear ??
  row.built_year ?? row.yearBuilt`. Only `yearBuilt` (camelCase drizzle key)
  or `year_built` (raw SQL key) can be set by the ORM. The multi-alias chain
  is belt-and-braces and harmless; leaving it for the maintainer of the
  property-grading feature to tighten when they normalize the DB client
  result shape.
- **`(u.status ?? u.status_text)`** in `live-metrics-source.ts` line 104 —
  same pattern; harmless fallback. No `status_text` column exists on `units`,
  so this always falls through to `u.status`.
- **`(account as any).balanceMinorUnits = …` and friends** in
  `services/payments-ledger/src/repositories/account.repository.ts` lines
  270–275 — these are domain-entity mutations on a POJO after a `.select()`,
  NOT drizzle column accesses. Not a schema-drift risk (though they do
  violate immutability conventions — out of scope here).
- **`credit-rating-repository.ts` uses `// @ts-nocheck`** at the top. This
  hides the drift we just fixed AND any future one. Recommend a follow-up
  task to delete that pragma and fix the resulting types properly — but
  that's Agent E’s territory and requires changes elsewhere (DatabaseClient
  type drift).
- **`property-grading.router.ts`** references only service-level DTOs, no
  direct SQL — nothing to drift.
- **`occupancy/postgres-occupancy-timeline-repository.ts`** — every column
  accessed exists on `leases` or `customers`.
- **`cases/damage-deduction/postgres-damage-deduction-repository.ts`** — all
  columns accessed exist on `damage_deduction_cases` (schema colocated in
  the same directory as the repo).

## Build verification

```
$ pnpm --filter @borjie/database build            # green
$ pnpm --filter @borjie/domain-services build     # green (tsc, no output)
$ pnpm --filter @borjie/api-gateway typecheck     # green (tsc --noEmit, no output)
```

All three commands exit 0 with no type errors after the fixes.

## Follow-up recommendations (not landed)

1. Remove the `// @ts-nocheck` from `credit-rating-repository.ts` and fix
   the resulting `DatabaseClient` typing drift — without this, the same
   class of bug can return silently.
2. Same pragma removal for `mcp-wiring.ts` and `service-registry.ts` if
   safely possible.
3. Add an integration test that spins up ephemeral Postgres, runs every
   migration, and calls each credit-rating + property-grading endpoint
   end-to-end. Type checks + unit tests with fakes did NOT catch bugs 1–6,
   because every raw SQL string sidesteps compile-time column checks.
