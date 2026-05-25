# Phase A Wave 27 — Agent PhA1 — VacancyToLeaseOrchestrator

**Agent**: PhA1
**Scope**: build the single orchestrator that stitches marketplace + waitlist +
negotiation + credit-rating + inspection + renewal into the full
vacancy → lease pipeline. Reuse only — no service rewrites.

---

## State machine diagram (as text)

```
                 StartPipeline
idle ───────────────────────────▶ listed
                                    │
                                    │ InquiryReceived
                                    ▼
                             receiving_inquiries ──ApplicantRejected──▶ rejected
                                    │
                                    │ ApplicantScreened
                                    ▼
                             screening_applicant ──ApplicantRejected──▶ rejected
                                    │                │
                                    │                └─ApplicantWithdrew──▶ withdrew
                                    │ OfferExtended
                                    ▼
                             offer_extended ──OfferExpired────────▶ expired
                                    │         │
                                    │         └─ApplicantWithdrew──▶ withdrew
                                    │ OfferSigned
                                    ▼
                             offer_signed
                                    │
                                    │ MoveInScheduled
                                    ▼
                             move_in_scheduled
                                    │
                                    │ LeaseActivated
                                    ▼
                              lease_active (TERMINAL)

Any non-terminal state + [Cancelled] ──▶ cancelled  (TERMINAL)
Any policy-gated transition + denial  ──▶ awaiting_approval
awaiting_approval + [ApprovalGranted] ──▶ resumes on intended next_state
awaiting_approval + [ApprovalDenied]  ──▶ rejected  (TERMINAL)
```

Terminal states: `lease_active`, `rejected`, `withdrew`, `expired`, `cancelled`.

All transitions are declared in a single allow-listed table in
`state-machine.ts`. `transition(current, event)` is a pure function —
no I/O, deterministic, fully unit-testable.

---

## Services orchestrated per transition

Each port is a narrow facade wired at request-time (see
`vacancy-pipeline.router.ts :: buildOrchestrator`). The orchestrator
never pokes at the concrete services directly; it calls the port, which
adapts into the real service at the composition-root boundary.

| Target state        | Domain service invoked                             | Port method                          |
| ------------------- | -------------------------------------------------- | ------------------------------------ |
| `listed`            | `services.marketplace.listing.publish(...)`        | `listing.publishListing`             |
| `receiving_inquiries` | `services.marketplace.enquiry` (lookup)          | `enquiry.latestApplicant`            |
| `screening_applicant` | `services.creditRating.computeRating(tenant, customer)` | `creditRating.score`             |
| `offer_extended`    | `services.negotiation.startNegotiation(...)` (via wrapper) | `negotiation.proposeOffer`   |
| `offer_signed`      | (no autonomous side-effect — signal from customer app)     | — (state transition only)    |
| `move_in_scheduled` | inspection scheduling + `services.renewal` first-term seed | `inspection.scheduleMoveInInspection` + `renewal.seedFirstTerm` |
| `lease_active`      | `services.waitlist.vacancyHandler` (markFilled equivalent) + emits `LeaseActivated` | `waitlist.markUnitFilled` |

Every transition also emits a `PlatformEvent` with type
`VacancyPipeline:<state>` through the composition-root `eventBus`
(`OrchestratorEventPort.emit`) so:

- Process-miner subscribers capture it into `process_observations`.
- The api-gateway autonomous-action audit records the transition.
- Downstream notifications / webhooks fan out without bespoke wiring.

---

## Endpoints added

All under `/api/v1/vacancy-pipeline` (mounted in `services/api-gateway/src/index.ts`).
All require `authMiddleware` and are tenant-scoped via `auth.tenantId`.

| Method + Path                              | Purpose                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `POST /:unitId/start`                      | Fire a new run. Body: `{ source?, correlationId? }`. Returns 201 + run. |
| `GET /:runId`                              | Current run (state + full history + foreign ids).           |
| `GET /?unitId=<id>`                        | Every run (any state) attached to a unit.                   |
| `POST /:runId/advance`                     | Manually push an event (`InquiryReceived`, `OfferSigned`, …). Admin/override. |
| `POST /:runId/cancel`                      | Terminate with `cancelled` + audit reason.                   |

Error mapping:
- `NOT_FOUND` → 404
- `INVALID_TRANSITION` / `TERMINAL` → 409
- all other catch paths → `routeCatch` (SQL→4xx, else scrubbed 500)

---

## Tests added (unit count)

Single test file: `packages/ai-copilot/src/orchestrators/vacancy-to-lease/__tests__/state-machine.test.ts`

**17 tests passing.**

Pure state-machine (9):
- Full happy path traversal
- Unknown transition returns `allowed=false` with diagnostic
- Rejected branch at screening
- Withdrew branch at offer
- Expired branch at offer
- Cancelled from multiple starting states
- Terminal detection (`isTerminal`)
- Outgoing-edge introspection (`listAllowedEvents`)
- `routeToApproval` always lands on `awaiting_approval`

Service integration (8):
- `startPipeline` creates a run and auto-advances to `listed`
- Happy multi-step: listed → receiving_inquiries → screening_applicant → offer_extended
- Policy requires approval → run parks in `awaiting_approval`
- Policy hard-blocks → run terminates as `rejected`
- Full end-to-end: idle → lease_active (all 7 happy-path edges)
- `cancelRun` halts non-terminal run
- `advance` on terminal run throws `VacancyPipelineError('TERMINAL')`
- `listRuns` is tenant-scoped

Verification command:
```
pnpm --filter @borjie/ai-copilot test -- --run src/orchestrators/vacancy-to-lease/__tests__
# Test Files  1 passed (1)   Tests  17 passed (17)
```

---

## Migration (verified present)

File: `packages/database/src/migrations/0098_vacancy_pipeline_runs.sql`

Applied via `psql "$DATABASE_URL" -f …/0098_*.sql`. Output:
```
CREATE TABLE
CREATE INDEX  × 3
CREATE INDEX   (partial unique)
```

Post-apply `\d vacancy_pipeline_runs`:
- 15 columns (run_id PK, tenant_id FK → tenants ON DELETE CASCADE, state, unit_id,
  4 foreign-id mirrors, credit_rating_score, history_json JSONB, timestamps,
  reason fields).
- 4 btree indexes (`tenant_id`, `(tenant_id, unit_id)`, `(tenant_id, state)`,
  plus PK).
- 1 partial unique index `uq_vacancy_pipeline_runs_one_open_per_unit` guaranteeing
  at most one non-terminal run per unit (per tenant).

Idempotent — every `CREATE` uses `IF NOT EXISTS`.

---

## Autonomy-policy integration point

File: `packages/ai-copilot/src/orchestrators/vacancy-to-lease/orchestrator-service.ts`
function `autonomyActionFor(state)` maps each gated target state onto an
`AutonomyPolicyService` action key:

| Target state          | Autonomy domain | Action key               |
| --------------------- | --------------- | ------------------------ |
| `listed`              | `leasing`       | `publish_listing`        |
| `screening_applicant` | `leasing`       | `approve_application`    |
| `offer_extended`      | `leasing`       | `send_offer_letter`      |
| `lease_active`        | `leasing`       | `approve_renewal`        |

Before each such transition, the orchestrator calls
`OrchestratorPolicyPort.isAuthorized(tenantId, action, context)` which
wraps the real `AutonomyPolicyService.isAuthorized(tenantId, 'leasing',
action, context)`:

- `authorized=true, requiresApproval=false` → side-effect + transition.
- `authorized=false, requiresApproval=true` → park in `awaiting_approval`
  (state machine still records the edge in history with reason).
- `authorized=false, requiresApproval=false` → terminate as `rejected`
  with `cancelledReason=<policy reason>`.

When `autonomousModeEnabled=false` on the tenant's policy, the first
call (for `publish_listing`) returns `requiresApproval=true` so the
very first transition parks in `awaiting_approval` — i.e. a tenant who
has never opted in to autonomy mode never sees any auto-action without
explicit head approval.

---

## Known limits (stubbed for future waves)

Every stub is tagged with `TODO(WAVE-28+):` so grep surfaces them.

1. **Router uses the in-memory repo, not Postgres.** Migration 0098 is
   live and the `VacancyPipelineRunRow` shape in `types.ts` maps 1:1
   onto the columns, but the Postgres adapter is not yet wired. Runs
   reset across gateway restarts.
   *Fix:* add `PostgresVacancyPipelineRunRepository` under
   `services/api-gateway/src/composition/` + wire into `service-registry.ts`.

2. **`marketplace.listing.publish` is called with a placeholder
   `headlinePrice: 0` and empty `currency`.** `ListingService` currently
   requires `headlinePrice > 0` so the transition will fail until the
   port pulls the unit's current asking rent.
   *Fix:* in `buildOrchestrator`, read `units.monthly_rent` +
   `tenant.region_config.currency` to supply real values.

3. **`enquiry.latestApplicant` returns `null`.** `EnquiryService` does
   not yet expose a "highest-ranked prospect" query; orchestrator
   receives no applicant id at `receiving_inquiries`, which blocks
   `screening_applicant` until someone advances manually with a
   context payload.
   *Fix:* extend `EnquiryService` with `topProspectForListing(listingId)`.

4. **`negotiation.proposeOffer` returns a synthetic `pending_<ts>` id.**
   The real `NegotiationService.startNegotiation` needs `policyId`,
   opening offer, floor, ceiling — none are available in the
   orchestrator context today.
   *Fix:* wire `LeasingOfferPolicy` lookup + pull initial offer from
   listing's `headlinePrice`.

5. **`inspection.scheduleMoveInInspection` and `renewal.seedFirstTerm`
   are no-ops.** Today both are manual operator flows. Orchestrator
   records the transition but doesn't create inspection/lease rows.
   *Fix:* plumb `InspectionService.schedule(...)` + extend
   `RenewalService` with `createInitialTerm`.

6. **`waitlist.markUnitFilled` is a no-op.** `WaitlistService` only
   exposes an event-driven `UnitVacated` flow; there's no first-class
   `markFilled` yet. The orchestrator emits the `LeaseActivated` state
   event via the bus, but waitlist state is unchanged.
   *Fix:* add `WaitlistService.markUnitFilled(tenantId, unitId)` that
   closes open subscriptions for the unit.

7. **Service-registry does NOT own the orchestrator.** By ownership
   rules, Wave 27 PhA1 MUST NOT touch `service-registry.ts` or
   `service-context.middleware.ts`. The router therefore builds a fresh
   orchestrator per request with a shared in-memory repo.
   *Fix:* in Wave 28, agree on the composition-root slot
   (`registry.orchestrators.vacancyToLease`) and migrate.

8. **Credit-score auto-approve threshold is hard-coded (620).**
   Constructor accepts `creditRatingAutoApproveMin`, but the router
   doesn't thread a per-tenant value through. The autonomy policy's
   `leasing.autoApproveApplicationScoreMin` covers this conceptually,
   so the `approve_application` autonomy check is the authoritative
   gate — the 620 default is only a fallback if policy is silent.

9. **No Postgres-backed integration test.** The 17 unit tests fully
   cover the state machine + service logic, but there's no test that
   round-trips through the real `vacancy_pipeline_runs` table.
   *Fix:* add an `integration.test.ts` that spins up against the live
   DB fixture once the Postgres repo lands.

---

## File inventory

**New files**
- `packages/ai-copilot/src/orchestrators/index.ts` (barrel — concurrently
  updated by another agent to add `MonthlyClose`; PhA1 only ships
  `VacancyToLease`)
- `packages/ai-copilot/src/orchestrators/vacancy-to-lease/index.ts`
- `packages/ai-copilot/src/orchestrators/vacancy-to-lease/types.ts`
- `packages/ai-copilot/src/orchestrators/vacancy-to-lease/state-machine.ts`
- `packages/ai-copilot/src/orchestrators/vacancy-to-lease/orchestrator-service.ts`
- `packages/ai-copilot/src/orchestrators/vacancy-to-lease/__tests__/state-machine.test.ts`
- `services/api-gateway/src/routes/vacancy-pipeline.router.ts`
- `packages/database/src/migrations/0098_vacancy_pipeline_runs.sql`

**Modified files**
- `services/api-gateway/src/index.ts` — +2 lines (import + `api.route`)
- `packages/ai-copilot/package.json` — +4 lines (`./orchestrators` subpath export)

**Not touched** (per ownership rules)
- `services/api-gateway/src/composition/service-registry.ts`
- `services/api-gateway/src/composition/service-context.middleware.ts`

---

## Verification summary

| Check                                                           | Result |
| --------------------------------------------------------------- | ------ |
| `pnpm --filter @borjie/ai-copilot typecheck`                | pass   |
| `pnpm --filter @borjie/api-gateway typecheck`               | pass   |
| `pnpm --filter @borjie/ai-copilot test -- --run src/orchestrators/vacancy-to-lease/__tests__` | 17 / 17 pass |
| `psql "$DATABASE_URL" -f …/0098_vacancy_pipeline_runs.sql`      | applied |
| `psql "$DATABASE_URL" -c '\d vacancy_pipeline_runs'`            | table + 5 indexes present |
| Router reachable via `/api/v1/vacancy-pipeline` (compile-time)  | yes (typecheck) |
