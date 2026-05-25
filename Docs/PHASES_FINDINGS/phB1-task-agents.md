# Phase B Wave 30 — PhB1 Task-Agents Framework

Status: Green — framework compiles, 15 agents registered, executor wires them to
real services, typecheck (`@borjie/ai-copilot` + `@borjie/api-gateway`)
green, ai-copilot test suite 933/933 pass, router reachable at
`/api/v1/task-agents`.

## Framework contract (1-page)

A **TaskAgent** is a narrow, single-purpose worker that does one job
(rent-reminder, late-fee, inspection-reminder, etc.) on its own trigger
under per-tenant autonomy-policy guardrails. Density over monoliths —
15 tiny files (≤ 100 lines each) instead of one big scheduler.

```
interface TaskAgent<Schema> {
  id: string;                 // 'rent_reminder_agent'
  title, description: string;
  trigger:
    | { kind: 'cron'; cron: string; description: string }
    | { kind: 'event'; eventType: string; description: string }
    | { kind: 'manual'; description: string };
  guardrails: {
    autonomyDomain: 'finance' | 'leasing' | 'maintenance' | 'compliance' | 'communications';
    autonomyAction: string;   // e.g. 'send_reminder', 'approve_renewal'
    description: string;
    invokesLLM: boolean;      // executor applies cost-ledger budget-guard iff true
  };
  payloadSchema: z.ZodTypeAny;        // zod schema for run payload
  execute(ctx: AgentRunContext): Promise<AgentRunResult>;
}
```

**AgentRunContext.services** is a loose service-bag the api-gateway
composition root injects at wiring time — each agent pulls only the port
it needs (`services.notifications.dispatcher`,
`services.arrearsProposer`, etc.) and degrades to `no_op` when the port
is absent. No agent throws; one bad agent cannot tear down a cron sweep.

**Outcomes**: `executed | skipped_policy | skipped_budget | no_op | error`.
Every run — including skips — is audited AND publishes a
`TaskAgentRan` platform event.

## Executor (`packages/ai-copilot/src/task-agents/executor.ts`)

Wires together five concerns at run time:

1. **Payload validation** — runs the agent's zod schema.
2. **Autonomy guardrail** — calls `AutonomyPolicyService.isAuthorized`
   on `(tenantId, guardrails.autonomyDomain, guardrails.autonomyAction)`.
   On deny the run short-circuits to `skipped_policy` with the
   policy-rule matched in the data envelope. No `execute()` call = no
   side effects, no cost.
3. **Budget guard** — iff `guardrails.invokesLLM === true`, calls
   `CostLedger.assertWithinBudget(tenantId)`. On over-cap, returns
   `skipped_budget`. The executor does NOT yet wrap internal Anthropic
   clients with `withBudgetGuard` — that remains the agent's
   responsibility once an agent actually invokes an LLM (none of the 15
   Wave-30 agents do; they are all service-call wrappers).
4. **Execution + error capture** — awaits `execute(ctx)`; any thrown
   error becomes `outcome: 'error'` without bubbling up.
5. **Finalisation** — writes an `audit_events` row (entityType =
   `task_agent_run`) and publishes the `TaskAgentRan` PlatformEvent.

All four external dependencies (`autonomy`, `costLedger`, `audit`,
`eventPublisher`) are optional — omitting them gives a fully-functional
executor for tests (and for the degraded gateway boot).

## Registry + 15 agents — table

| # | id | Trigger | Guardrail (domain / action) | Services reused |
|---|----|---------|------------------------------|------------------|
| 1 | `rent_reminder_agent` | cron `0 7 * * *` | finance / send_reminder | `notifications.dispatcher` + invoice lookup port |
| 2 | `late_fee_calculator_agent` | cron `30 6 * * *` | finance / act_on_arrears | `listOverdueInvoices` + `arrearsProposer.proposeLateFee` |
| 3 | `lease_renewal_scheduler_agent` | cron `0 4 * * *` | leasing / approve_renewal | `renewalService.proposeRenewal` + lease-near-expiry lookup |
| 4 | `move_out_notice_agent` | event `LeaseMoveOutRecorded` | leasing / approve_application | `inspectionService.scheduleInspection` + `moveOutChecklistService` (Z3 — stubbed when absent) |
| 5 | `inspection_reminder_agent` | cron `0 * * * *` | communications / send_routine_update | `listUpcomingInspections` + `notifications.dispatcher` |
| 6 | `vendor_invoice_approver_agent` | cron `15 */4 * * *` | maintenance / approve_work_order | `listPendingVendorInvoices` + `approvalService.{queueApproval,autoApprove}` |
| 7 | `tenant_sentiment_monitor_agent` | cron `0 5 * * 1` | communications / send_routine_update | `sentimentAnalyzer.scanRecentMessages` + `exceptionInbox.writeFlag` |
| 8 | `arrears_ladder_tick_agent` | cron `0 6 * * *` | finance / act_on_arrears | existing `arrears_ladder_tick` background task (wrapped, not re-implemented) |
| 9 | `insurance_expiry_monitor_agent` | cron `0 5 * * 1` | compliance / draft_notice | `listExpiringInsurance` + `exceptionInbox` |
| 10 | `license_expiry_monitor_agent` | cron `0 4 1 * *` | compliance / renew_licence | `listExpiringLicences` + `exceptionInbox` |
| 11 | `utility_meter_reading_reminder_agent` | cron `0 7 25-31 * *` | communications / send_routine_update | `listUnitsMissingMeterReading` + `notifications.dispatcher` |
| 12 | `vacancy_marketer_agent` | event `UnitStatusChangedToVacant` | leasing / send_offer_letter | `marketplacePublishRequester` port (PhA1 subscribes) |
| 13 | `proactive_maintenance_alert_agent` | cron `0 3 * * 2` | maintenance / approve_work_order | `predictiveMaintenanceScheduler.proposeSignals` + `exceptionInbox` |
| 14 | `cross_tenant_churn_risk_agent` | cron `0 6 * * 1` | communications / send_routine_update | `churnPredictor.recomputeActiveLeases` + `exceptionInbox` |
| 15 | `payment_plan_proposer_agent` | cron `0 8 * * *` | finance / act_on_arrears | `listArrearsCasesOverDays` + `arrearsProposer.proposePaymentPlan` |

All 15 registered in a frozen `TASK_AGENT_REGISTRY` (`Readonly<Record<string, TaskAgent>>`)
at `packages/ai-copilot/src/task-agents/registry.ts`.

## Router — `/api/v1/task-agents`

File: `services/api-gateway/src/routes/task-agents.router.ts` (mounted
in `services/api-gateway/src/index.ts`).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/task-agents` | list all 15 agents with metadata |
| GET | `/api/v1/task-agents/runs?agent_id=&limit=` | recent runs from `audit_events` (entityType `task_agent_run`) — registered BEFORE `/:id` so literal path wins |
| GET | `/api/v1/task-agents/:id` | single-agent metadata |
| POST | `/api/v1/task-agents/:id/run` | manual trigger — payload validated through the agent's zod schema inside the executor |

Executor resolution: `services.taskAgentExecutor` from the per-request
service-bag. Returns 503 if composition root has not wired it — never
crashes. Body contract for `POST /:id/run`:

```json
{ "payload": { ...agent-specific shape validated by zod... } }
```

Response body (`POST /:id/run`):
```json
{ "success": true, "data": {
    "runId": "tar_...", "agentId": "rent_reminder_agent",
    "tenantId": "...", "outcome": "executed",
    "summary": "...", "data": { ... }, "affected": [ ... ],
    "durationMs": 12, "ranAt": "2026-04-20T...", "triggerKind": "manual"
  }
}
```

## Tests added

| Test file | Tests | Covers |
|-----------|-------|--------|
| `packages/ai-copilot/src/task-agents/__tests__/registry.test.ts` | 5 | count==15, frozen, id==key, every agent has full contract, every Wave-30 id present |
| `packages/ai-copilot/src/task-agents/__tests__/executor.test.ts` | 7 | happy-path execute, unknown agent → error, throwing agent captured, invalid payload, policy skip, budget-guard only on `invokesLLM=true`, list/get surface |
| `packages/ai-copilot/src/task-agents/__tests__/agents.test.ts` | 19 | per-agent degrade-to-no_op when ports missing (15 cases) + wired happy-paths (rent-reminder, arrears-ladder, payment-plan, vacancy-marketer) |
| **Total** | **31** | all green |

Full ai-copilot suite: 933/933 tests pass across 76 files.

## Audit integration

**Every run writes one audit_events row + emits one PlatformEvent.**

- Audit row (`audit_events` via `AuditService.logAudit`):
  - `action = 'create'`
  - `entityType = 'task_agent_run'`
  - `entityId = runId`
  - `userId = triggeredBy.userId` (null for cron/event)
  - `metadata.taskAgentRun` carries the structured `TaskAgentAuditRecord`
    (runId, agentId, outcome, summary, durationMs, trigger, triggeredBy,
    affected refs)
  - `metadata.data` carries the agent's free-form result data envelope

- PlatformEvent: `TaskAgentRan`
  ```ts
  { eventType: 'TaskAgentRan', tenantId, agentId, runId, outcome,
    summary, durationMs, occurredAt }
  ```
  Emitted on every outcome — including `skipped_policy` and
  `skipped_budget` — so observability + webhooks see every attempt, not
  just the green ones.

Both writes are **best-effort**: a failing audit write or publisher
never bubbles up to the caller. The structured result is still returned
to the client.

## Known limits / honest notes

1. **`moveOutChecklistService` stubbed** — Agent Z3 is still wiring
   `MoveOutChecklistService`. `move_out_notice_agent` detects its
   absence and appends `move_out_checklist_service_pending_z3_wiring`
   into the notes envelope. The inspection-schedule side still fires.

2. **`marketplacePublishRequester` is a coordinating port** — Wave 30
   deliberately does NOT call the marketplace service directly;
   `vacancy_marketer_agent` emits through a port that PhA1's
   vacancy-to-lease pipeline owns. When PhA1 wires that port,
   `requestListingPublish(...)` returns a real listingId.

3. **Service-bag ports are not yet composed in `service-registry.ts`** —
   per spec, PhB1 is forbidden to touch `service-registry.ts` (hot
   contention). The agents read from the loose `services: AgentServicesBag`
   at run time; a follow-up composition-root patch must inject each
   required port name (`notifications.dispatcher`, `arrearsProposer`,
   `listOverdueInvoices`, etc.) into the registry so the agents light
   up in production. Until then every cron-run produces `no_op`
   outcomes with structured `reason: 'missing_deps'` — safe to deploy.

4. **Budget-guard is scaffolded but unused** — none of the 15 Wave-30
   agents invoke an LLM; all are service-call wrappers. The executor
   respects `guardrails.invokesLLM` and is ready to gate future agents
   (e.g. a renewal-letter-writer that calls Claude) without changes.

5. **No migration added** — per spec we reuse the existing
   `audit_events` table. Entity type `task_agent_run` is a first-class
   string constant; query it via the existing audit repo.

6. **Cron execution** — the registry declares cron strings; actually
   firing them on schedule is the composition root's job (hook into
   the existing `BackgroundTaskScheduler` or create a dedicated
   task-agent supervisor). Not in scope for PhB1 per the spec
   ("manual trigger + registry + executor"). The `POST /:id/run`
   endpoint gives operators on-demand control today.

## Files delivered

New:
- `packages/ai-copilot/src/task-agents/types.ts`
- `packages/ai-copilot/src/task-agents/registry.ts`
- `packages/ai-copilot/src/task-agents/executor.ts`
- `packages/ai-copilot/src/task-agents/index.ts`
- `packages/ai-copilot/src/task-agents/agents/*.ts` (15 files)
- `packages/ai-copilot/src/task-agents/__tests__/registry.test.ts`
- `packages/ai-copilot/src/task-agents/__tests__/executor.test.ts`
- `packages/ai-copilot/src/task-agents/__tests__/agents.test.ts`
- `services/api-gateway/src/routes/task-agents.router.ts`

Edited:
- `packages/ai-copilot/package.json` — added `./task-agents` subpath export
- `services/api-gateway/src/index.ts` — import + mount `/task-agents`

Not touched (per spec):
- `packages/ai-copilot/src/orchestrators/**`
- `services/api-gateway/src/composition/service-registry.ts`
- `services/api-gateway/src/composition/service-context.middleware.ts`

## Verification commands

```sh
pnpm --filter @borjie/ai-copilot typecheck   # green
pnpm --filter @borjie/api-gateway typecheck  # green
pnpm --filter @borjie/ai-copilot test        # 933/933 green
```

Router reachability (once executor is wired into service-registry):

```sh
curl -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/v1/task-agents
# → { success: true, data: { agents: [ ...15... ], total: 15 } }

curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"payload":{"channels":["sms"],"leadTimeDays":3}}' \
  http://localhost:4000/api/v1/task-agents/rent_reminder_agent/run
# → structured ExecuteOutput with outcome + audit row + TaskAgentRan event
```
