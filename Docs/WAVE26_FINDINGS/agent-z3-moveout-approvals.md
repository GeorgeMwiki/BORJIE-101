# Wave 26 Agent Z3 — Move-Out + Approval Workflow Wiring

Both services that Wave 25 Agent T flagged as "passing tests, no HTTP
surface, no composition wiring" are now reachable through real HTTP
endpoints that execute against live Postgres.

## MoveOutChecklistService wiring

**Service chosen**: `services/domain-services/src/lease/move-out-checklist.ts`
(the step-based end-of-tenancy workflow — `completeFinalInspection`,
`recordUtilityReadings`, `reconcileDeposit`, `issueResidencyProofLetter`).
The richer inspection-backed variant under `inspections/move-out/` is a
separate aggregate and was already wired via `InspectionRepository`.

### Barrel export
- `services/domain-services/src/lease/index.ts` — added re-export of
  `MoveOutChecklistService`, `createMoveOutChecklist`, `MoveOutRepository`,
  `MoveOutChecklist`, `MoveOutError`, step-state types.

### Composition root slot
- `services/api-gateway/src/composition/service-registry.ts` — new slot
  `moveOut: { service: MoveOutChecklistService | null }`. Live-mode
  constructs `new MoveOutChecklistService(new PostgresMoveOutRepository(db))`.
  Degraded mode returns `{ service: null }`.

### Postgres repository
- `services/api-gateway/src/composition/move-out-repository.ts` —
  `PostgresMoveOutRepository` implements `findByLeaseId` and `save` over
  the new `move_out_checklists` table. Full checklist aggregate stored
  as JSONB; `is_finalized`, `currency`, `total_deposit` mirrored into
  scalar columns for dashboards. Tenant-scoped by composite PK
  `(tenant_id, lease_id)`.

### Service-context shim
- `services/api-gateway/src/composition/service-context.middleware.ts` —
  flat key `moveOutChecklistService` set when `registry.moveOut.service`
  is present, matching the Wave-9/26 shim pattern.

### Router file
- `services/api-gateway/src/routes/move-out.router.ts` — mounted at
  `/api/v1/move-out` in `services/api-gateway/src/index.ts`.
  - `POST /:leaseId/checklist` — initialise (create or upsert-idempotent).
    `requireRole(TENANT_ADMIN, PROPERTY_MANAGER, SUPER_ADMIN, ADMIN)`.
  - `GET  /:leaseId/checklist` — fetch state + `meta.completed` flag.
  - `POST /:leaseId/checklist/:itemId/complete` — dispatch table over
    four itemIds: `final_inspection`, `utility_readings`,
    `deposit_reconciliation`, `residency_proof_letter`. Each branch
    validates its own zod body, maps to the matching service method,
    and surfaces `CHECKLIST_NOT_FOUND → 404`, `INVALID_INPUT → 400`,
    any other service error → 409.
  - `POST /:leaseId/finalize` — refuses when `service.isCompleted()` is
    false (409); otherwise returns the deposit-disposition summary
    computed off the checklist (totalDeposit/totalDeductions/refund).

### Tests
- `services/api-gateway/src/routes/__tests__/move-out.router.test.ts` —
  4 auth-gate smoke tests. Existing
  `services/domain-services/src/lease/__tests__/*` (Wave 25) covers
  service-level behaviour; no duplication here.

## ApprovalService wiring

**Service chosen**: `services/domain-services/src/approvals/approval-service.ts`
(richer workflow — policy-aware, auto-approve rules, escalation, timeout,
per-tenant policy overrides). The legacy in-file class in
`approvals/index.ts` is retained for back-compat but is NOT the one
wired — the richer one is re-exported under the alias
`ApprovalWorkflowService` to avoid the duplicate-name collision.

### Barrel export
- `services/domain-services/src/approvals/index.ts` — appended
  `export { ApprovalService as ApprovalWorkflowService, … } from
  './approval-service.js'` plus typed aliases
  (`ApprovalWorkflowRequest`, `ApprovalWorkflowType`,
  `ApprovalWorkflowErrorResult`, etc.), repository interfaces
  (`ApprovalRequestRepository`, `ApprovalPolicyRepository`),
  `asApprovalRequestId`, `getDefaultPolicyForType`.

### Composition root slot
- `approvals: { service: ApprovalWorkflowService | null }`. Live-mode
  constructs the service with a Postgres request repo + a policy-repo
  adapter that wraps the existing `PostgresApprovalPolicyRepository`
  (migration 0018) so per-tenant overrides continue to work.

### Postgres repository
- `services/api-gateway/src/composition/approval-request-repository.ts`
  - `PostgresApprovalRequestRepository` — implements `findById`,
    `findPendingByApprover`, `findHistory` (filter-chained sql with
    bind parameters — no string interpolation), `create`, `update`
    over the new `approval_requests` table.
  - `PostgresApprovalPolicyRepositoryAdapter` — wraps the existing
    override-only `PostgresApprovalPolicyRepository` in the full
    `ApprovalPolicyRepository` shape the service expects, so defaults
    (from `default-policies.ts`) remain the fallback floor.

### Service-context shim
- `approvalWorkflowService` flat key set from
  `registry.approvals.service` for legacy consumers / test mocks.

### Router file
- `services/api-gateway/src/routes/approvals.router.ts` — mounted at
  `/api/v1/approvals` in `index.ts`. Every handler uses
  `routeCatch(…)` for unknown errors and returns structured envelopes
  (`{success, error:{code,message}}`) for known service errors.
  - `POST /` — create pending request (any authed user).
  - `GET /` — list pending approvals assigned to current user.
  - `GET /:id` — fetch one (reads the service's private
    `requestRepo` so we don't have to rewrite the service to expose
    `findById` directly).
  - `POST /:id/approve` — `requireRole(TENANT_ADMIN, PROPERTY_MANAGER,
    ACCOUNTANT, OWNER, SUPER_ADMIN, ADMIN)`. Surfaces
    `REQUEST_NOT_FOUND → 404`, `UNAUTHORIZED_APPROVER → 403`, other → 409.
  - `POST /:id/reject` — same role gate + status mapping.
  - `POST /:id/escalate` — same role gate (minus OWNER).
  - `GET /policies/:type` — effective policy (override then default).
  - `PUT /policies/:type` — admin-only upsert.
  - `GET /history` — admin-only, filtered paginated history.

### Autonomy-policy integration point

The autonomy-policy thresholds from Wave 18 (`requireHumanApproval`) are
consumed by callers of autonomy actions. When a threshold is crossed,
the caller now has a real endpoint to route through:
`POST /api/v1/approvals` with `type` + `details` + `justification`. The
approval service picks the right approver chain (auto-approve rules,
role-based chain, timeout + escalation) from the policy it loads via
`PostgresApprovalPolicyRepositoryAdapter`, which first consults the
per-tenant override table and falls back to `getDefaultPolicyForType`.
The richer service already accepts an optional `ProximityRouter` and
`ApproverResolver` — those ports are left `undefined` here until the
user-directory lookup lands, and the service degrades gracefully
(approverId stays null, status stays `pending`, routers list by
requester).

### Tests
- `services/api-gateway/src/routes/__tests__/approvals.router.test.ts` —
  8 auth-gate smoke tests covering every endpoint + role-gated
  operation. Service-level decision/escalation tests already exist in
  the domain-services package.

## Migration `0097_move_out_approvals.sql`

- Two new tables: `move_out_checklists` (PK `(tenant_id, lease_id)`,
  JSONB aggregate, scalar mirrors) and `approval_requests` (PK `id`,
  tenant_id FK with cascade, full audit columns for each state
  transition).
- Tenant-scoped indexes for every hot lookup path (approver, requester,
  escalated_to_user, type, status).
- Idempotent — every statement uses `IF NOT EXISTS`.

**Live-apply verification**:
```
$ psql "$DATABASE_URL" -f packages/database/src/migrations/0097_move_out_approvals.sql
CREATE TABLE
CREATE INDEX × 2
CREATE TABLE
CREATE INDEX × 6
```
Tables confirmed present via `\d move_out_checklists` and `\d approval_requests`.

## Verification

- `pnpm --filter @borjie/domain-services typecheck` → clean.
- `pnpm --filter @borjie/api-gateway typecheck` → clean.
- `pnpm --filter @borjie/api-gateway test` → 194/194 passed
  (includes 12 new tests for the two routers).

## Deferrals

1. **ApproverResolver port** — user-directory lookup from role is left
   `undefined`. Requests are created with `approverId=null` until the
   port lands. Routers still list by requester and allow admin override.
2. **ProximityRouter** — the approval service already supports it
   (NEW 18), but wiring the station-master lookup into the composition
   root is out of scope for Z3. Open follow-up ticket.
3. **Legacy `ApprovalService`** — the simpler in-file class in
   `approvals/index.ts` is still exported with the old `ApprovalService`
   name. Consumers (if any surface outside tests) continue to work. A
   future refactor should remove it, but Wave-26 constraint forbids
   rewrites.
4. **/move-out/:leaseId/checklist/:itemId POST** accesses `service.repo`
   via bracket-notation because `MoveOutChecklistService` does not
   expose a creation method on its public surface. A future pass should
   add `service.createChecklist(...)` to avoid the reach-through.
5. **Deposit-return trigger on finalize** — currently the finalize
   endpoint returns the computed summary but does not publish a
   `DepositReturned` event. Downstream payout automation should subscribe
   to a `MoveOutFinalized` event once the service learns to emit it.
