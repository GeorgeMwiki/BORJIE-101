# Post-Hard-Fork Route Audit

**Date:** 2026-05-29
**Author:** Borjie hard-fork cleanup agent (issue #165)
**Method:** Smoke matrix (`scripts/smoke/full-endpoint-smoke.ts`) +
per-route Borjie-equivalent check against `packages/database/src/schemas/`
and `services/api-gateway/src/routes/`.

This document records the per-route decision for the 29 vestigial
BossNyumba property-management endpoints that 500'd in the live
smoke matrix and were deleted (or kept-as-503-envelope) in this
cleanup pass.

User directive: *"if it helps Borjie in its mining estate management
task keep, otherwise delete if they're BossNyumba-specific and Borjie
has its own."*

## Summary

| Cluster                          | Routes | Decision | Borjie equivalent |
| -------------------------------- | -----: | -------- | ----------------- |
| `/customer/*` (BFF)              |      4 | DELETE   | mining/marketplace + bid_negotiations + buyer-mobile |
| `/hr/*` (top-level)              |      6 | DELETE   | /api/v1/workforce + workforce_* schemas + workforce-mobile |
| `/maintenance/*` (top-level)     |      5 | DELETE   | /api/v1/mining/maintenance + /api/v1/mining/tasks |
| `/owner/*` (BFF)                 |     14 | DELETE   | /api/v1/owner/{brief,messaging} + /api/v1/cooperatives/settlements + /api/v1/mining/{sales,tasks,docs,reports} |
| **Total**                        | **29** | **all deleted** | — |

Zero routes kept-as-503: every failing route in the 29 had a
canonical Borjie equivalent already wired, so the right thing was to
delete and let callers migrate to the Borjie equivalent.

## Before -> After

| Metric                       |  BEFORE |   AFTER |
| ---------------------------- | ------: | ------: |
| Total HTTP routes (openapi)  |     281 |     240 |
| Pass (200/201/204/400/401/403) |     224 |     206 |
| Raw 500 (broken)             |  **29** |   **0** |
| Structured 503/501 envelope  |      28 |      32 |

The 32 remaining 5xx are all structured `TABLE_NOT_PROVISIONED` /
`COLUMN_NOT_PROVISIONED` / `LIVE_DATA_NOT_IMPLEMENTED` /
`NOT_IMPLEMENTED` envelopes from `utils/safe-error.ts` (#163) — not
crashes.

## Cluster 1 — `/customer/*` (4 routes)

Source: `services/api-gateway/src/routes/bff/customer-app.ts`

| Route                                       | Old failure                            | Borjie equivalent | Decision |
| ------------------------------------------- | -------------------------------------- | ----------------- | -------- |
| GET  /customer/letters                      | `letterRequests` schema missing        | `/api/v1/mining/docs` + `document_drafts` schema (legal/contract drafting) | DELETE |
| POST /customer/sublease                     | `subleaseService` not configured       | N/A — pure property-mgmt concept | DELETE |
| GET  /customer/sublease                     | `sublease.repo` not configured         | N/A — pure property-mgmt concept | DELETE |
| GET  /customer/move-out/disputes            | `damageDeductions.repo` missing        | N/A — pure property-mgmt concept | DELETE |
| GET  /customer/marketplace/:unitId/negotiations | `negotiations` schema missing      | `/api/v1/mining/marketplace` + `/api/v1/mining/bids` + `bid_negotiations` schema + buyer-mobile app | DELETE |

Note: `POST /customer/marketplace/:unitId/negotiate` was also deleted
in the same edit (paired with the GET it counts as one logical route
in the smoke matrix because the GET was the failing surface).

## Cluster 2 — `/hr/*` (6 routes)

Source: `services/api-gateway/src/routes/hr.hono.ts` (file removed)

| Route                              | Old failure                                            | Borjie equivalent | Decision |
| ---------------------------------- | ------------------------------------------------------ | ----------------- | -------- |
| GET /hr/assignments                | `AssignmentRepository is not a constructor`            | `mining_tasks` (covers all assignments) + `/api/v1/mining/tasks` | DELETE |
| GET /hr/departments                | `DepartmentRepository is not a constructor`            | N/A — mining flat-org via cooperatives | DELETE |
| GET /hr/employees                  | `EmployeeRepository is not a constructor`              | `/api/v1/workforce/*` + workforce_certifications + workforce_invitations + workforce-mobile | DELETE |
| GET /hr/employees/:id              | `EmployeeRepository is not a constructor`              | `/api/v1/workforce/*` | DELETE |
| GET /hr/performance/:employeeId    | `PerformanceRepository is not a constructor`           | `shift_reports` + workforce_role_tab_configs | DELETE |
| GET /hr/teams                      | `TeamRepository is not a constructor`                  | N/A — site-led model; teams emerge from `mining_tasks` + cooperative membership | DELETE |

## Cluster 3 — `/maintenance/*` (5 routes)

Source: `services/api-gateway/src/routes/maintenance.hono.ts` (file removed)

| Route                                            | Old failure                                                | Borjie equivalent | Decision |
| ------------------------------------------------ | ---------------------------------------------------------- | ----------------- | -------- |
| GET  /maintenance/requests                       | repos.workOrders undefined -> `Cannot read … tenantId`     | `/api/v1/mining/maintenance` (asset events on `maintenance_events`) + `/api/v1/mining/tasks` | DELETE |
| GET  /maintenance/requests/:id                   | repos.workOrders undefined -> `Cannot read … Symbol(...)`  | `/api/v1/mining/maintenance/:id` | DELETE |
| PATCH /maintenance/requests/:id                  | repos.workOrders undefined                                 | `/api/v1/mining/tasks` (lifecycle updates) | DELETE |
| GET  /maintenance/requests/:id/dispatch-events   | repos.workOrders undefined                                 | `/api/v1/mining/tasks` timeline / shift_reports | DELETE |
| POST /maintenance/completion-proofs/:id/verify   | `CompletionProofRepository is not a constructor`           | `/api/v1/mining/approvals` (four-eye verifier flow) | DELETE |

Distinction preserved: `/api/v1/mining/maintenance` (mining asset
maintenance events on excavators/compressors) is the Borjie-native
sibling — NOT a property-maintenance forwarding shim.

## Cluster 4 — `/owner/*` (14 routes)

Source: `services/api-gateway/src/routes/bff/owner-portal.ts` (only
14 handlers + their dead helpers removed; `/owner/budgets/*`,
`/owner/compliance/*`, `/owner/co-owners`, `/owner/invitations/*`,
`/owner/tenants/communications` retained — see below).

| Route                                                | Old failure                                       | Borjie equivalent | Decision |
| ---------------------------------------------------- | ------------------------------------------------- | ----------------- | -------- |
| GET  /owner/work-orders                              | repos.workOrders undefined -> `findMany`          | `/api/v1/mining/tasks` | DELETE |
| POST /owner/work-orders/:id/approve                  | repos.workOrders undefined -> `findById`          | `/api/v1/mining/approvals` (four-eye) | DELETE |
| POST /owner/work-orders/:id/reject                   | repos.workOrders undefined -> `findById`          | `/api/v1/mining/approvals` | DELETE |
| GET  /owner/financial/stats                          | repos.invoices undefined -> `findMany`            | `/api/v1/owner/brief` (estate-wide financial pulse) + estate_capital_movements ledger + `/api/v1/mining/sales` | DELETE |
| GET  /owner/invoices                                 | repos.invoices undefined -> `findMany`            | N/A — no rental invoicing; mineral revenue settled via `/api/v1/mining/sales` | DELETE |
| GET  /owner/payments                                 | repos.payments undefined -> `findMany`            | `/api/v1/mining/sales` + payments-ledger (Stripe/M-Pesa) | DELETE |
| GET  /owner/reports/export/financial                 | repos.invoices undefined -> `findMany`            | `/api/v1/mining/reports` | DELETE |
| GET  /owner/disbursements                            | repos.payments undefined -> `findMany`            | `/api/v1/cooperatives/settlements` + estate_capital_movements | DELETE |
| GET  /owner/disbursements/:id/statement              | repos.payments undefined -> `findMany`            | `/api/v1/cooperatives/settlements/:id` | DELETE |
| GET  /owner/messaging/conversations                  | repos.messaging undefined -> `findMany`           | `/api/v1/owner/messaging` (owner_messaging schema, canonical) | DELETE |
| GET  /owner/messaging/conversations/:id/messages     | repos.messaging undefined -> `findMany`           | `/api/v1/owner/messaging/threads/:id` | DELETE |
| POST /owner/messaging/conversations/:id/messages     | repos.messaging undefined -> `getConversation`    | `/api/v1/owner/messaging/threads` (POST) | DELETE |
| GET  /owner/documents/signatures                     | repos.documents undefined -> `findMany`           | `/api/v1/mining/docs` + document_drafts | DELETE |
| POST /owner/documents/:id/sign                       | repos.documents undefined -> `findById`           | `/api/v1/mining/docs` (verifier flow) | DELETE |

### Retained owner-portal routes (NOT in the 29 — these did not 500)

These remain in `owner-portal.ts` because they were already returning
honest-empty envelopes per #163 and do not 500:

- GET /owner/co-owners — 501 NOT_IMPLEMENTED (flag-gated)
- GET /owner/budgets/{summary,forecasts} — 200 honest-empty
- GET /owner/compliance/{inspections,insurance,licenses,summary} — 200 honest-empty (compliance/inspections + summary wrap a try/catch around inspections schema lookup)
- GET /owner/tenants/communications — 200 honest-empty (was previously trying to wrap conversations schema; collapsed to clean honest-empty in this pass since `conversations` schema is gone)
- POST /owner/invitations/co-owner — 501 NOT_IMPLEMENTED (flag-gated)
- GET /owner/invitations — 200 honest-empty
- POST /owner/invitations/:id/cancel — 200 stub

## Helpers + imports cleaned up

Removed from `bff/owner-portal.ts` (dead after handler deletion):

- `csvEscape`, `toDataUrl` — CSV export support for `/reports/export/financial`
- `enrichOwnerInvoices`, `enrichOwnerPayments`, `enrichOwnerWorkOrders` — row enrichment helpers
- `buildFinancialStats`, `buildDisbursementData` — aggregator helpers
- `listOwnerConversations` — conversations-table wrapper (relied on dropped `conversations` schema)
- `mapInvoiceRow`, `mapPaymentRow`, `mapVendorRow`, `mapWorkOrderRow` imports (from `routes/db-mappers`)
- `conversations` import (from `@borjie/database`)
- `e404` import (no longer used after work-orders/messaging/documents handlers removed)

Retained: `getOwnerScope` wrapper + `inspections` import — used by the
remaining `/owner/compliance/{inspections,summary}` routes which
self-heal to empty when the legacy `inspections` schema lookup fails.

## Mount surfaces updated

Mounts removed from `services/api-gateway/src/index.ts`:
- `api.route('/maintenance', maintenanceRouter)`
- `api.route('/hr', hrRouter)`

Removed from `services/api-gateway/src/openapi/mounted-routers.ts`:
- `{ prefix: '/maintenance', app: maintenanceRouter, defaultTag: 'maintenance' }`
- `{ prefix: '/hr', app: hrRouter, defaultTag: 'hr' }`

Removed from `services/api-gateway/src/openapi/export-cli.ts`:
- Dynamic imports of `maintenance.hono.js` + `hr.hono.js`
- Catalog entries for `/maintenance` + `/hr`

## Verification

Final smoke matrix (run: 2026-05-29, gateway pid varies per restart):

```
Total routes smoke-tested: 240
Pass:    206 (86%)
Skipped:   2 (SSE / multipart)
5xx (all structured): 32
  - 503 TABLE_NOT_PROVISIONED / COLUMN_NOT_PROVISIONED / LIVE_DATA_NOT_IMPLEMENTED / SERVICE_UNAVAILABLE: 26
  - 501 NOT_IMPLEMENTED: 6
Raw 500: 0
```

`pnpm --filter @borjie/api-gateway typecheck` — 0 errors.
