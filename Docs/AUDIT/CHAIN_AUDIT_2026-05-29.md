# Commercial Chain Audit (Buyer -> Owner -> Worker)

**Date:** 2026-05-29
**Audit scope:** End-to-end chain integrity from buyer RFB creation through worker
fulfillment to buyer notification + money flow.
**Method:** Trace each link with: trigger -> receiver -> auth -> RLS -> audit chain
-> observability -> UI surface.

This audit follows two prior passes:
- #155 (initial wiring of orphan logic) — high level fixes.
- #181 (reality check) — found brittle stubs.
- #184 (missing endpoints) — added field-level surfaces.

This pass goes deeper: full end-to-end with no link skipped.

---

## Link 1 — Buyer creates RFB

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | PASS | `apps/buyer-mobile/app/rfb/create.tsx` (RfbCreate) submits via `useMutation(createRfb)`. Real onSubmit handler with debounce. |
| Receiver | PASS | `services/api-gateway/src/routes/marketplace/rfb.hono.ts` `POST /` mounted at `/api/v1/marketplace/rfb`. |
| Auth | PASS | `authMiddleware` applied at router level. |
| RLS | PASS | `databaseMiddleware` binds `app.current_tenant_id`. Insert uses `auth.tenantId`. |
| Audit | GAP | No append to `ai_audit_chain` or `decision_journal`. |
| Observability | GAP | No OTel span / structured log on RFB create — only on error path. |
| UI surface | PASS | Form has real submit, debounce, success toast, query invalidation, navigation. |

**Fix shipped:** Added pino info-log + cockpit event publish (`opportunity.scan_completed`)
on each RFB insert so owners pulse on new buyer demand.

---

## Link 2 — Owner sees pulse on cockpit (SSE)

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | GAP | RFB insert did NOT publish a cockpit event before this audit; no SSE fan-out. |
| Receiver | PASS | `services/api-gateway/src/routes/cockpit-stream.hono.ts` mounts SSE; bus subscribe per tenant. |
| Auth | PASS | `authMiddleware` + tenant-scoped subscription. |
| RLS | N/A | SSE channel auto-scopes by `auth.tenantId`. |
| Audit | N/A | Read-only stream. |
| Observability | PASS | Cockpit bus pub-sub instrumented. |
| UI surface | PARTIAL | `apps/owner-web/src/lib/cockpit-sse.ts` handles `opportunity.scan_completed`. No UI surfaces this for inbound RFBs specifically. |

**Fix shipped:** RFB creation publishes `opportunity.scan_completed` so SSE feed
fans the buyer demand to owner cockpit (Link 1 fix closes this gap).
**Remaining gap (LATER):** Owner marketplace UI does NOT show inbound RFBs.
Surface is `apps/owner-web/src/app/(routes)/marketplace/page.tsx` -> only outbound
listings + mocked inbound. Roadmap: extend `MarketplaceBoard` with inbound RFB
column reading `/api/v1/marketplace/rfb/nearby`. Effort: ~150 LOC + tests.

---

## Link 3 — Owner assigns to manager (creates mining_task)

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | GAP | No owner-web UI action to create a mining task from an RFB. |
| Receiver | PASS | `services/api-gateway/src/routes/mining/tasks.hono.ts` `POST /` with `requireRole(MANAGER_ROLES)`. |
| Auth | PASS | Manager-only role gate. |
| RLS | PASS | RLS FORCE per migration 0080; handler also predicates on `auth.tenantId`. |
| Audit | PASS | Hash-chain append on create / complete / block / reassign. |
| Observability | PASS | Pino logger via `createLogger('mining-tasks')`. |
| UI surface | GAP | Owner-web has zero `/api/v1/mining/tasks` consumers; workforce-mobile (manager role) has zero. |

**Remaining gap (LATER):** No UI for owners/managers to assign tasks. Manager
needs to see incoming RFBs (Link 2) and tap "Assign to worker" -> dispatch UI.
Effort: ~300 LOC across owner-web `/marketplace` and workforce-mobile
manager dispatch screen.

---

## Link 4 — Manager dispatches to worker

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | GAP | Same as Link 3 — no UI. |
| Receiver | PASS | `POST /:id/reassign` exists on `tasks.hono.ts`. |
| Auth | PASS | Manager-only. |
| RLS | PASS | RLS scoped. |
| Audit | PASS | Hash-chain `mining.task.reassign` event. |
| Observability | PASS | Pino. |
| UI surface | GAP | No workforce-mobile manager dispatch screen reads task queue. |

**Remaining gap (LATER):** Same as Link 3.

---

## Link 5 — Worker receives task (mining_tasks -> hero card)

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | PASS | Manager assigns via `POST /:id/reassign`. |
| Receiver | PASS | `services/api-gateway/src/routes/field/workforce.hono.ts` `GET /tasks/next`. |
| Auth | PASS | `authMiddleware`. |
| RLS | PASS | RLS + handler-level predicate. |
| Audit | PASS | Hash-chain on mark-complete + help-request. |
| Observability | PASS | `publishCockpitEvent('workforce.shift_event')` on help raise. |
| UI surface | PASS | `apps/workforce-mobile/src/components/WorkerHomeHero.tsx` reads `/api/v1/field/workforce/tasks/next` and rendersWorkerHeroCard with mark-complete + need-help buttons. |

---

## Link 6 — Worker submits shift report (photo + tonnage)

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | PASS | `apps/workforce-mobile/app/worker/*` screens have form handlers. |
| Receiver | PASS | `services/api-gateway/src/routes/mining/shift-reports.hono.ts` `POST /`. |
| Auth | PASS | `authMiddleware`. |
| RLS | PASS | RLS + scoped insert. |
| Audit | PASS | `withSecurityEvents` decorator emits security audit event. |
| Observability | PASS | Security event audit log. |
| UI surface | PARTIAL | Worker has shift report screens (W-M-02 etc.) but several use hardcoded mock SHIFT data. |

**Remaining gap (LATER):** W-M-02 has `const SHIFT: ShiftPlan = {...mock}` hardcoded. Should read live from `/api/v1/mining/shift-reports`. Effort: ~120 LOC.

---

## Link 7 — Buyer notified of fulfillment

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | GAP | When a seller responds to an RFB (`request_for_bid_responses`), no notification is fired to the buyer. |
| Receiver | GAP | No push-notification consumer in `apps/buyer-mobile`. No SSE either. |
| Auth | N/A | |
| RLS | N/A | |
| Audit | N/A | |
| Observability | GAP | No notification span. |
| UI surface | PARTIAL | `apps/buyer-mobile/app/rfb/index.tsx` shows `pendingResponseCount` if user refreshes. No live update. |

**Fix shipped:** Added pino log on each RFB response insert. **Remaining gap (LATER):** Add push-notification + buyer SSE channel. Effort: ~400 LOC (new channel infra).

---

## Link 8 — Money flow (payments-ledger entry on sale completion)

| Aspect | Status | Notes |
|--------|--------|-------|
| Trigger | GAP | When seller's response is accepted and worker delivers, no `LedgerService.post()` is invoked. |
| Receiver | PASS | `services/payments-ledger/src/services/ledger.service.ts` has the post function. |
| Auth | PASS | (when called) |
| RLS | PASS | Ledger entries are tenant-scoped. |
| Audit | PASS | Ledger is immutable double-entry per CLAUDE.md hard rule. |
| Observability | PASS | (when called) |
| UI surface | PARTIAL | `apps/owner-web/src/components/owner-os/panels/AccountingPanel.tsx` admits it's awaiting the accounting BFF; no chain-completion UI. |

**Remaining gap (LATER):** Settlement flow from RFB-accepted to ledger.post is
unwired. Effort: ~500 LOC (new domain orchestration + BFF endpoint + UI).

---

## Summary

**Verified PASS:** Link 5 (worker hero card flow).
**PARTIAL with inline fixes:** Links 1, 2, 6, 7.
**Wholly GAP (logged as roadmap):** Links 3, 4, 8.

The chain works end-to-end ONLY for the Link-5 worker hero card path.
The Buyer -> Owner -> Manager -> Worker dispatch loop is broken at
Links 2-4 because no UI surfaces inbound RFBs; manager dispatch is
not surfaced.

The Worker -> Buyer fulfilment loop (Links 7-8) requires a settlement
orchestrator that does not exist.

Total inline fixes this pass: 2 (RFB cockpit event publish + pino logging
on RFB writes).
