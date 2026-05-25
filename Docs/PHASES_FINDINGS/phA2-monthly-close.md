# Phase A Wave 28 — PhA2 · MonthlyCloseOrchestrator

Agent: **PhA2**. Goal: autonomously run the end-of-month bookkeeping
close — reconcile payments, generate owner statements, compute KRA MRI
(Kenya 7.5%), compute disbursements, propose the batch (autonomy-gated),
email statements, emit `MonthlyCloseCompleted`. No rewrites of existing
services — pure orchestration.

## Orchestrator step graph (as text)

```
triggerRun(tenantId, trigger='cron'|'manual', [period=prev month])
   │
   ▼
┌─────────────────────────────────────────────────────────────────────┐
│ idempotency: findRunByPeriod(tenant, year, month)                   │
│   ├─ existing & completed       → throw MonthlyCloseAlreadyCompleted│
│   ├─ existing & in-progress     → resume (resumed=true)             │
│   └─ none                       → createRun()                       │
└─────────────────────────────────────────────────────────────────────┘
   │
   ▼
executeRun()  (loops over MONTHLY_CLOSE_STEPS, skips terminal ones)
   │
   ├─ 1. freeze_period            → record period window
   ├─ 2. reconcile_payments       → ReconciliationPort.reconcileForPeriod
   ├─ 3. generate_statements      → StatementPort.generateOwnerStatementsForPeriod
   ├─ 4. compute_kra_mri          → 7.5% flat × gross-rent per owner → CSV
   ├─ 5. compute_disbursements    → DisbursementPort.computeBreakdown per owner
   │                                 net = gross − MRI − platformFee − maint
   ├─ 6. propose_disbursement_batch  (GATED)
   │       ├─ autonomousModeEnabled=false         → awaiting_approval
   │       ├─ total > finance.autoApproveRefunds  → awaiting_approval
   │       └─ else                                → auto_approved → executeBatch
   ├─ 7. email_statements         → NotificationPort.sendStatementEmail
   └─ 8. emit_completed_event     → EventPort.publish(MonthlyCloseCompleted)

approveStep(runId, stepName, userId)
   │
   ├─ validate step.decision === 'awaiting_approval'
   ├─ record step as 'approved' (actor = userId)
   └─ resume executeRun() — step runner re-enters and executes the work
      (final decision re-recorded as 'executed' with actor=userId)
```

Every step writes one row to `monthly_close_run_steps` (unique on
`run_id, step_name`) with `decision`, `actor`, `policy_rule`,
`started_at/completed_at/duration_ms`, `result_json`, `error_message`.
Idempotent on re-entry — a step with terminal decision (`executed`,
`auto_approved`, `skipped`) is skipped on resume.

## Services reused per step

| # | Step                       | Port (DI)              | Backing service (gateway wires)                                 |
|---|----------------------------|------------------------|-----------------------------------------------------------------|
| 1 | freeze_period              | —                      | pure (no external call)                                         |
| 2 | reconcile_payments         | ReconciliationPort     | `services/payments-ledger/src/services/reconciliation.service`  |
| 3 | generate_statements        | StatementPort          | `services/payments-ledger/src/services/statement.generator`     |
| 4 | compute_kra_mri            | —                      | pure math + CSV (stub until KRA eTIMS adapter — Wave-34)        |
| 5 | compute_disbursements      | DisbursementPort       | `services/payments-ledger/src/services/disbursement.service`    |
| 6 | propose_disbursement_batch | DisbursementPort       | `DisbursementService.processDisbursement` (per owner)           |
| 6 |    autonomy gate            | AutonomyPolicyPort     | `packages/ai-copilot/src/autonomy/autonomy-policy-service`      |
| 7 | email_statements           | NotificationPort       | notification dispatch log (migration 0091)                      |
| 8 | emit_completed_event       | EventPort              | shared `InMemoryEventBus` → process-miner / audit / subscribers |

The orchestrator imports NONE of these directly — it calls narrow port
interfaces the api-gateway composition root adapts to the concrete
services (same pattern used by the VacancyToLease orchestrator, the
intelligence-orchestrator, and the background-intelligence task
catalogue). That keeps `@borjie/ai-copilot` free of heavy payments
transitive deps.

## Autonomy-policy gating matrix

| Step                      | Policy dimension consulted                            | Decision if ON + under threshold | Decision if OFF or over threshold |
|---------------------------|-------------------------------------------------------|----------------------------------|-----------------------------------|
| freeze_period             | —                                                     | executed                         | executed                          |
| reconcile_payments        | —                                                     | executed                         | executed                          |
| generate_statements       | —                                                     | executed                         | executed                          |
| compute_kra_mri           | —                                                     | executed                         | executed                          |
| compute_disbursements     | —                                                     | executed                         | executed                          |
| propose_disbursement_batch| `finance.autoApproveRefundsMinorUnits` (batch total) + master `autonomousModeEnabled` | auto_approved → batch executes | awaiting_approval → run pauses, emits `MonthlyCloseAwaitingApproval` |
| email_statements          | —                                                     | executed                         | executed (runs after gate cleared)|
| emit_completed_event      | —                                                     | executed                         | executed                          |

Rule names recorded into `monthly_close_run_steps.policy_rule`:

- `master_switch_off` — `autonomousModeEnabled=false`
- `finance.batch_over_threshold` — batch net > ceiling
- `finance.batch_auto_approved` — under ceiling, auto-executed
- `null` on non-gated steps

## Endpoints added

All under `api.route('/monthly-close', monthlyCloseRouter)` (mounted
from `services/api-gateway/src/index.ts`). All admin-only
(`SUPER_ADMIN | ADMIN | TENANT_ADMIN`). Every mutation wraps the
orchestrator call in try/catch → `routeCatch` for safe errors.

| Verb | Path                                              | Semantics                                                                                                |
|------|---------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| POST | `/api/v1/monthly-close/trigger`                   | Manual run for the caller's tenant. Body: `{ periodYear?, periodMonth? }`. 409 if period already closed. |
| GET  | `/api/v1/monthly-close`                           | List recent runs (most recent first). Query: `?limit=` (default 20, max 100).                            |
| GET  | `/api/v1/monthly-close/:runId`                    | One run's step-by-step state (`steps[]` included).                                                       |
| POST | `/api/v1/monthly-close/:runId/approve-step`       | Body: `{ stepName }`. 409 if step is not currently `awaiting_approval`. Resumes the run on success.      |

The router degrades to 503 `MONTHLY_CLOSE_UNAVAILABLE` when
`services.monthlyClose?.orchestrator` is unset — matches the existing
degrade-gracefully convention on the other Wave 26/27 routers. (The
service-registry/service-context wiring is owned by a different agent
per Phase A fencing.)

## Migration applied verification

Migration: `packages/database/src/migrations/0099_monthly_close_runs.sql`.

Applied against `postgres://georgesmackbookair@127.0.0.1:5432/borjie`.
Registered into `drizzle.__drizzle_migrations` so `pnpm db:migrate` skips it.

```
\d monthly_close_runs
  id                       text  PK
  tenant_id                text  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  period_year              integer NOT NULL
  period_month             integer NOT NULL
  period_start / _end      timestamptz NOT NULL
  status                   text DEFAULT 'running'    CHECK status IN (running, awaiting_approval, completed, failed, skipped)
  trigger                  text DEFAULT 'cron'
  started_at / completed_at
  triggered_by             text DEFAULT 'system'
  reconciled_payments      integer DEFAULT 0
  statements_generated     integer DEFAULT 0
  kra_mri_total_minor      bigint  DEFAULT 0
  disbursement_total_minor bigint  DEFAULT 0
  currency                 text
  summary_json             jsonb   DEFAULT '{}'
  last_error               text
  created_at / updated_at
Indexes:
  PK (id)
  UNIQUE (tenant_id, period_year, period_month)  ← idempotency guard
  (tenant_id, status)
  (tenant_id, started_at DESC)
Checks:
  period_month ∈ [1,12], period_year ∈ [2020,2100]
FK:
  tenant_id → tenants(id) ON DELETE CASCADE
Referenced by:
  monthly_close_run_steps.run_id

\d monthly_close_run_steps
  id              text PK
  run_id          text NOT NULL  → monthly_close_runs(id) ON DELETE CASCADE
  tenant_id       text NOT NULL  → tenants(id) ON DELETE CASCADE
  step_name       text NOT NULL
  step_index      integer NOT NULL
  decision        text NOT NULL  CHECK IN (executed, auto_approved, awaiting_approval, approved, skipped, failed)
  actor           text DEFAULT 'system'
  policy_rule     text
  started_at / completed_at / duration_ms
  result_json     jsonb DEFAULT '{}'
  error_message   text
  created_at
Indexes:
  PK (id)
  UNIQUE (run_id, step_name)              ← idempotency on re-entry
  (tenant_id, run_id)
  (run_id, step_index)
```

## Idempotency test summary

`__tests__/monthly-close.test.ts` — 14 tests, all passing.

- `returns resumed=true for an in-progress re-trigger` — second
  `triggerRun` for the same `(tenant, period)` while the first is
  paused at `awaiting_approval` returns the same run id with
  `resumed: true`. No duplicate row (SQL uniqueness index
  `idx_monthly_close_runs_tenant_period` enforces this at the DB
  level too).
- `throws MonthlyCloseAlreadyCompletedError for completed re-trigger`
  — second trigger after completion throws `409 CONFLICT` (router
  returns `{ success: false, error: { code, runId } }`, status 409).
- `does not re-run steps that were already executed` — after a pause
  + approval resume, the `generate_statements` row id is unchanged
  (the runner's terminal-decision skip path is exercised).
- Plus 11 other tests covering the end-to-end path, KRA MRI math,
  CSV escaping, policy-gate OFF, over-threshold gate, and
  per-disbursement failure isolation.

```
Test Files  1 passed (1)
     Tests  14 passed (14)
```

Typechecks clean:

- `pnpm --filter @borjie/ai-copilot typecheck` → OK
- `pnpm --filter @borjie/api-gateway typecheck` → OK

## Known limits

- **KRA eTIMS submission is stubbed.** `compute_kra_mri` produces the
  CSV + per-owner line items + totals, and records
  `submissionStatus: 'pending_etims_adapter'` in the step's
  `result_json`. Actual submission lands in Wave-34 when the KRA
  eTIMS adapter is wired. Marker: `TODO(WAVE-34): KRA eTIMS adapter`
  in `orchestrator-service.ts`.
- **Registry slot now plumbed.** The router looks up
  `services.monthlyClose?.orchestrator` off the `services` Hono
  context key. As of commit `f3f02d2` the
  `services/api-gateway/src/composition/monthly-close-wiring.ts`
  factory constructs the `MonthlyCloseOrchestrator` against the
  Drizzle-backed `RunStorePort` (commit `e33cebc`,
  `packages/database/src/services/monthly-close-runs.service.ts`)
  and the slot is wired onto `ServiceRegistry.monthlyClose`. The
  router still returns 503 `MONTHLY_CLOSE_UNAVAILABLE` when
  `DATABASE_URL` is unset (the wiring returns `null` to preserve
  the degraded-mode contract), but the orchestrator now persists run
  + step state to Postgres in normal operation.
- **Reconciliation / Statement / Disbursement / Notification ports
  now backed by real Drizzle period-bulk adapters** (commit `0ac239f`).
  Files under `services/api-gateway/src/services/monthly-close/`:
  - `reconciliation-adapter.ts` aggregates `payments` joined with
    `invoices` for the closing window in one round-trip, returning
    `{ reconciled, unmatched, grossRentMinor, currency }`.
  - `statement-adapter.ts` walks owners with active leases in the
    period, computes per-owner gross, writes `draft` rows into
    `owner_statements`. PDF rendering stays a follow-up worker —
    rows persist with `degraded_reason: 'no_pdf_renderer'`.
  - `disbursement-adapter.ts` computes per-owner breakdown from
    `payments → leases → properties`; records every
    `executeDisbursement` call into `event_outbox` as
    `MonthlyCloseDisbursementProposed` for the eventual payouts
    worker.
  - `notification-adapter.ts` inserts one row per (owner, statement)
    into `notification_dispatch_log` with `status='pending'`.
  Each adapter is tenant-scoped and never crashes the orchestrator —
  errors degrade to logged warnings + safe-default returns. The
  remaining stub is `AutonomyPolicyPort` (still defaults
  `autonomousModeEnabled = false` so disbursement batches park as
  `awaiting_approval` — money never auto-moves until the concrete
  autonomy adapter lands).
- **Disbursement destination is pass-through.** The orchestrator
  reads `destination` from the existing `DisbursementService`
  breakdown. If the owner has no registered bank account, that
  service already throws — the orchestrator records the per-owner
  failure and continues (overall run still completes).
- **Platform fee percentage is configuration.** Defaults to 10% but
  can be overridden via `MonthlyCloseOrchestratorDeps.platformFeePct`.
  A per-tenant override is a future follow-up — the simplest place
  is to read it off the same tenant region-config the rest of the
  payments stack uses.
- **`monthly_close` cron task registers unconditionally.** Unlike
  `recompute_property_grades` (which only registers when the
  property-grading slot is present), the monthly-close task is
  always registered so `listScheduledTasks()` is complete and ops
  can flip `ai.bg.monthly_close` without redeploying. When the
  orchestrator slot is absent the task body reports zero work.

## Files touched / created

NEW:
- `packages/ai-copilot/src/orchestrators/monthly-close/types.ts`
- `packages/ai-copilot/src/orchestrators/monthly-close/orchestrator-service.ts`
- `packages/ai-copilot/src/orchestrators/monthly-close/index.ts` (barrel)
- `packages/ai-copilot/src/orchestrators/monthly-close/__tests__/monthly-close.test.ts`
- `services/api-gateway/src/routes/monthly-close.router.ts`
- `packages/database/src/migrations/0099_monthly_close_runs.sql`
- `Docs/PHASES_FINDINGS/phA2-monthly-close.md` (this file)

EDITED:
- `packages/ai-copilot/src/orchestrators/index.ts` — added `export * as MonthlyClose`
- `packages/ai-copilot/src/background-intelligence/types.ts` — added `'monthly_close'` to `TaskName`
- `services/api-gateway/src/composition/background-wiring.ts` — registered the `monthly_close` cron task (0 2 1 * *)
- `services/api-gateway/src/index.ts` — imported + mounted `monthlyCloseRouter` at `/api/v1/monthly-close`

Not touched (per instructions): `service-registry.ts`, `service-context.middleware.ts`.
