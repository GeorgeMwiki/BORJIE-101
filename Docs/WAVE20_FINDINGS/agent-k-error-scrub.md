# Wave 20 Agent K — routeCatch retrofit across api-gateway routers

## Files retrofitted (16)

1. `services/api-gateway/src/routes/complaints.ts`
2. `services/api-gateway/src/routes/feedback.ts`
3. `services/api-gateway/src/routes/inspections.ts`
4. `services/api-gateway/src/routes/notifications.ts`
5. `services/api-gateway/src/routes/scheduling.ts`
6. `services/api-gateway/src/routes/exceptions.router.ts`
7. `services/api-gateway/src/routes/webhook-dlq.router.ts`
8. `services/api-gateway/src/routes/scans.router.ts`
9. `services/api-gateway/src/routes/document-render.router.ts`
10. `services/api-gateway/src/routes/doc-chat.router.ts`
11. `services/api-gateway/src/routes/interactive-reports.router.ts`
12. `services/api-gateway/src/routes/autonomy.router.ts`
13. `services/api-gateway/src/routes/risk-reports.router.ts`
14. `services/api-gateway/src/routes/compliance.router.ts`
15. `services/api-gateway/src/routes/gepg.router.ts`
16. `services/api-gateway/src/routes/bff/estate-manager-app.ts`
17. `services/api-gateway/src/routes/bff/admin-portal.ts`
18. `services/api-gateway/src/routes/brain.hono.ts` (scrubMessage in handleError tail)

## Leak sites fixed (36)

| File | Sites |
|------|------:|
| complaints.ts | 4 (503 COMPLAINT_*) |
| feedback.ts | 6 (503 FEEDBACK_*, COMPLAINT_*) |
| inspections.ts | 2 (503 INSPECTIONS_QUERY_FAILED) |
| notifications.ts | 2 (503 NOTIFICATIONS_UNAVAILABLE) |
| scheduling.ts | 3 (503 SCHEDULING_QUERY_FAILED) |
| exceptions.router.ts | 1 (500 listOpen tail; 400 caller paths left intact) |
| webhook-dlq.router.ts | 2 (500 DLQ_LIST_FAILED, REPLAY_FAILED) |
| scans.router.ts | 4 (500 CREATE/UPLOAD/OCR_QUEUE/SUBMIT) |
| document-render.router.ts | 1 (500 ENQUEUE_FAILED) |
| doc-chat.router.ts | 1 (500 CREATE_FAILED) |
| interactive-reports.router.ts | 1 (500 PERSIST_FAILED; 400 caller path left intact) |
| autonomy.router.ts | 4 (500 policy get/update/enable/disable; 400 VALIDATION preserved) |
| risk-reports.router.ts | 2 (500; homegrown regex-constraint-detection replaced with mapSqlError) |
| compliance.router.ts | 3 (503 EXPORTS_UNAVAILABLE + 500 SCHEDULE_FAILED x2; 400 generate/download paths left intact) |
| gepg.router.ts | 2 (502 GEPG_ERROR — upstream gateway errors; 400 callback rejection left intact) |
| bff/estate-manager-app.ts | 8 (503 HOME/WORK_ORDERS/WORK_ORDER/INSPECTIONS/VENDORS/OCCUPANCY/COLLECTIONS) |
| bff/admin-portal.ts | 1 (503 OVERVIEW_UNAVAILABLE) |
| brain.hono.ts | 1 (500 handleError fallthrough scrubbed via scrubMessage) |

## Skipped (with reason)

- `arrears.router.ts`, `credit-rating.router.ts`, `messaging.ts`, `org-awareness.router.ts`, `property-grading.router.ts`, `bff/customer-app.ts` — **already done by H+I in Wave 19.**
- `workflows.router.ts` — regex-on-message status classifier returning 400/403/404/409 (caller-error envelope). Per constraints "Only replace the 500/503 catch tails"; no 500 tail to replace.
- `public-marketing.router.ts` — single catch returns 400 INVALID_CONTACT (caller validation), not a 500 leak.
- `applications.router.ts` — catch returns 404/400 with domain `error.code` + `error.diagnostics`; caller-error envelope.
- `ai-chat.router.ts` — three catches are typed (SupabaseAuthError, BrainConfigError) with 401/503; the remaining catch writes to an SSE stream (different envelope; intentional for client-side retry).
- `mcp.router.ts` — JSON-RPC 2.0 envelope `rpcError(id, code, msg)` is domain-standardised, not a leak.
- `hono-auth.ts` — catch emits 401 TOKEN_EXPIRED / INVALID_TOKEN literals, never echoes `err.message`.
- `gamification.router.ts` — central `mapError(c, err)` + `GamificationError` class; already uses typed-error envelope.
- `gdpr.router.ts`, `ai-costs.router.ts`, `training.router.ts`, `classroom.router.ts`, `lpms.router.ts`, `iot.router.ts`, `feature-flags.router.ts`, `maintenance-taxonomy.router.ts`, `agent-certifications.router.ts` — all use domain-typed errors with `e.code` + caller-error status (400/404/409). No raw SQL strings echoed.
- `agent-certifications.router.ts`, `tenders.router.ts`, `letters.router.ts`, `negotiations.router.ts`, `marketplace.router.ts`, `waitlist.router.ts` — no leak-shaped catches (or no catches at all).

## Verification

- `pnpm --filter @borjie/api-gateway typecheck` — **exit code 0** (green) after each batch and at the end.
- `pnpm --filter @borjie/api-gateway test` — **172 passed, 1 failed**.
  - Failure: `src/routes/__tests__/role-gate.test.ts > customers router is reachable for RESIDENT with rejection (401/403)` — **Test timed out in 10000ms**.
  - This test file is untracked (pre-existing) and exercises `customers.ts` / `leases.ts` / `properties.ts` / `units.ts` — **none of which were touched by this wave**. Unrelated flake.
- Before/after test count: 172 passing tests unchanged; same 1 pre-existing timeout. The error-envelope test (`src/__tests__/error-envelope.test.ts`) still passes.

## Notes

1. `risk-reports.router.ts` had a regex-on-message constraint detector (`/foreign key|violates|check constraint/i`). Replaced with `routeCatch` → `mapSqlError` which looks at Postgres SQLSTATE codes (23503, 23505, 23514) directly — strictly more correct, immune to driver string churn.
2. `autonomy.router.ts` PUT /policy had a `err.code === 'VALIDATION' ? 400 : 500` branch. Preserved the 400 VALIDATION path with its domain message (caller error, safe to echo), and only scrub the 500 fallthrough.
3. `brain.hono.ts` uses a bespoke `{ error, code }` envelope (no `success` wrapper). Left the envelope shape intact and just swapped the raw message for `scrubMessage(err, 'Internal error')`, preserving test contract.
4. `gepg.router.ts` 502 sites are upstream-gateway errors; `routeCatch` supports 502 via its status option. Callback 400 path (signature verification) left intact — it's a caller error.
