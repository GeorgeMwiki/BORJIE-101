# Wave 26 — Agent Z2 — Wire Four Unrouted Postgres Repos

**Scope:** four Postgres-backed repositories flagged by Wave 25 Agent T as
"tests passing but zero router / composition wiring". Each one now has a
dedicated slot in `ServiceRegistry`, a flat-key shim in the
service-context middleware, and a real HTTP router mounted on
`/api/v1/<domain>`.

**Constraint respected:** left Agent Z1's cases scope, Agent Z3's
MoveOut/Approvals scope, and Agent Z4's AI-brain scope untouched.
Everything below is repo-wiring only — no repo was rewritten.

---

## Per-repo section

### Repo: PostgresSubleaseRepository (+ PostgresTenantGroupRepository)

- **Was:** compiled class with 128-line implementation, 338-line unit
  test file (`postgres-sublease-repository.test.ts`), but **zero
  importers anywhere in the repo** — no router ever constructed it, no
  composition slot existed, and `SubleaseService` was never built. The
  sublease submit → review → approve → revoke flow had no HTTP surface.
- **Now:**
  - Slot: `services/api-gateway/src/composition/service-registry.ts:276`
    (`sublease: { service, repo, tenantGroupRepo }`) and
    `service-registry.ts:847-854` (construction) and
    `service-registry.ts:1080-1084` (return).
  - Router: `services/api-gateway/src/routes/sublease.router.ts`.
  - Mount: `services/api-gateway/src/index.ts:564` → `api.route('/subleases', subleaseRouter)`.
  - Endpoints:
    - `GET  /api/v1/subleases/` — smoke root.
    - `POST /api/v1/subleases/` — submit (routes `SubleaseService.submit`).
    - `GET  /api/v1/subleases/pending` — `repo.listPending`.
    - `GET  /api/v1/subleases/by-lease/:leaseId` — `repo.findByLease`.
    - `GET  /api/v1/subleases/:id` — `repo.findById`.
    - `POST /api/v1/subleases/:id/review` — `SubleaseService.review`.
    - `POST /api/v1/subleases/:id/approve` — `SubleaseService.approve`
      (upserts `TenantGroup` via the Postgres tenant-group repo).
    - `POST /api/v1/subleases/:id/revoke` — `SubleaseService.revoke`.
- **Production code path now exercised:** every write path drives the
  tenant-scoped UPDATE/INSERT statements in `postgres-sublease-repository.ts`
  through `SubleaseService`. Approval also touches
  `postgres-tenant-group-repository.ts`.

### Repo: PostgresDamageDeductionRepository

- **Was:** 239-line repo + 405-line `DamageDeductionService` with AI
  mediator support — all tested, none wired. Move-out damage claims
  had no HTTP surface at all.
- **Now:**
  - Slot: `service-registry.ts:283` (`damageDeductions: { service, repo }`),
    constructed at `service-registry.ts:857-864`, returned at
    `service-registry.ts:1085-1088`.
  - Router: `services/api-gateway/src/routes/damage-deductions.router.ts`.
  - Mount: `services/api-gateway/src/index.ts:565`.
  - Endpoints:
    - `GET  /api/v1/damage-deductions/` — root.
    - `POST /api/v1/damage-deductions/` — `fileClaim`.
    - `GET  /api/v1/damage-deductions/open` — `repo.listOpen`.
    - `GET  /api/v1/damage-deductions/:id` — `repo.findById`.
    - `POST /api/v1/damage-deductions/:id/respond` — `tenantRespond`.
    - `POST /api/v1/damage-deductions/:id/mediate` — `aiMediate`
      (deterministic fallback when ai-copilot is offline).
    - `POST /api/v1/damage-deductions/:id/settle` — `agreeAndSettle`.
    - `POST /api/v1/damage-deductions/:id/evidence-bundle` —
      `buildEvidenceBundle` (501 when the gateway is not wired, same as
      the service contract).
- **Production code path now exercised:** `fileClaim` persists via
  `repo.create`; `tenantRespond` / `aiMediate` / `agreeAndSettle` drive
  `repo.update`; `listOpen` drives the tenant-scoped `inArray` query
  in `postgres-damage-deduction-repository.ts`.

### Repo: PostgresConditionalSurveyRepository

- **Was:** 342-line three-table repo (headers, findings, action plans)
  + 413-line `ConditionalSurveyService`. Repo was tested, service was
  tested, but no router mounted either and no composition slot existed.
- **Now:**
  - Slot: `service-registry.ts:290` (`conditionalSurveys: { service, repo }`),
    constructed at `service-registry.ts:866-874`, returned at
    `service-registry.ts:1089-1092`.
  - Router: `services/api-gateway/src/routes/conditional-surveys.router.ts`.
  - Mount: `services/api-gateway/src/index.ts:566`.
  - Endpoints:
    - `GET  /api/v1/conditional-surveys/` — root.
    - `POST /api/v1/conditional-surveys/` — `scheduleSurvey`.
    - `GET  /api/v1/conditional-surveys/overdue` — `repo.findOverdue`.
    - `GET  /api/v1/conditional-surveys/:id` — `repo.findById`
      (denormalises findings + action plans in a single call).
    - `POST /api/v1/conditional-surveys/:id/findings` — `attachFinding`.
    - `POST /api/v1/conditional-surveys/:id/compile` — `compileReport`
      (passes tenantCountryCode through).
    - `POST /api/v1/conditional-surveys/:id/plans/:planId/approve` —
      `approveActionPlan`.
- **Production code path now exercised:** all three backing tables
  (`conditional_surveys`, `conditional_survey_findings`,
  `conditional_survey_action_plans`) receive real writes through the
  service. `findOverdue` drives the `lt(scheduledAt, cutoff)` query.

### Repo: PostgresFarRepository (Fitness-for-Assessment Review)

- **Was:** 311-line repo across three tables (`asset_components`,
  `far_assignments`, `condition_check_events`), 337-line `FarService`.
  All unit-tested, none wired — zero HTTP surface for asset component
  tracking.
- **Now:**
  - Slot: `service-registry.ts:297` (`far: { service, repo }`),
    constructed at `service-registry.ts:876-878`, returned at
    `service-registry.ts:1093-1096`.
  - Router: `services/api-gateway/src/routes/far.router.ts`.
  - Mount: `services/api-gateway/src/index.ts:567`.
  - Endpoints:
    - `GET  /api/v1/far/` — root.
    - `POST /api/v1/far/components` — `addComponent`.
    - `GET  /api/v1/far/components/:id` — `repo.findComponentById`.
    - `POST /api/v1/far/components/:id/assign` — `assignMonitoring`
      (auto-creates first `condition_check_events` row).
    - `GET  /api/v1/far/components/:id/scheduled-checks` —
      `getScheduledChecks`.
    - `GET  /api/v1/far/assignments/due` — `repo.findDueAssignments`
      (scheduler-friendly; accepts `?now=<iso>` override).
    - `POST /api/v1/far/assignments/:id/check` — `logCheck` (appends
      event + advances `nextCheckDueAt` + publishes
      `FarConditionCheckLogged` on the event bus).
- **Production code path now exercised:** every query in
  `postgres-far-repository.ts` is now callable through a tenant-scoped
  endpoint. Event publication flows through the existing
  `eventBus` → observability bridge.

---

## Composition-root slots added (summary)

```ts
// service-registry.ts — ServiceRegistry interface
readonly sublease: {
  readonly service: SubleaseService | null;
  readonly repo: PostgresSubleaseRepository | null;
  readonly tenantGroupRepo: PostgresTenantGroupRepository | null;
};
readonly damageDeductions: {
  readonly service: DamageDeductionService | null;
  readonly repo: PostgresDamageDeductionRepository | null;
};
readonly conditionalSurveys: {
  readonly service: ConditionalSurveyService | null;
  readonly repo: PostgresConditionalSurveyRepository | null;
};
readonly far: {
  readonly service: FarService | null;
  readonly repo: PostgresFarRepository | null;
};
```

Degraded skeleton (`DATABASE_URL` unset): all four slots return
`{ service: null, repo: null, ... }`. Routers short-circuit to 503 with
a `SERVICE_UNAVAILABLE` code and a clear "DATABASE_URL unset" message.

Live mode (`buildServicesInner`): each repo is constructed with the
shared drizzle client; `ConditionalSurveyService` and `FarService` take
the shared `eventBus` so their emitted events flow through the existing
outbox / observability bridge.

### Barrel updates (required for subpath imports)

- `services/domain-services/src/cases/index.ts` — added
  `export * as Sublease from './sublease/index.js'` and
  `export * as DamageDeduction from './damage-deduction/index.js'`
  (namespaced to avoid collision with the core Cases surface).
- `services/domain-services/src/cases/sublease/index.ts` — new barrel
  that re-exports the request/tenant-group types + service + Postgres
  repos.
- `services/domain-services/src/cases/damage-deduction/index.ts` — new
  barrel, same shape.
- `services/domain-services/src/inspections/conditional-survey/index.ts`
  — added `PostgresConditionalSurveyRepository` to the existing barrel.
- `services/domain-services/src/inspections/far/index.ts` — added
  `PostgresFarRepository` to the existing barrel.

### Flat-key shims (services/api-gateway/src/composition/service-context.middleware.ts)

```
subleaseService            → registry.sublease.service
damageDeductionService     → registry.damageDeductions.service
conditionalSurveyService   → registry.conditionalSurveys.service
farService                 → registry.far.service
```

Every router reads `c.get('services').<slot>.repo` for repo-direct calls
(`listPending`, `findByLease`, `listOpen`, `findOverdue`,
`findDueAssignments`, ...) and `c.get('<flat-key>')` for service-driven
flows. Tests can inject mocks via `c.set('<flat-key>', mockService)`.

---

## Migration(s)

**None.** Every backing table already exists in an earlier migration:

| Tables | Migration |
|---|---|
| `sublease_requests`, `tenant_groups`, `damage_deduction_cases` | `0017_cases_sla_and_subleases.sql` |
| `conditional_surveys`, `conditional_survey_findings`, `conditional_survey_action_plans` | `0018_conditional_surveys.sql` |
| `asset_components`, `far_assignments`, `condition_check_events` | `0019_far_asset_components.sql` |
| (minor amendments) | `0025_repo_amendments.sql` |

No new migration file was created; this wave is pure wiring.

---

## Verification

```
pnpm --filter @borjie/domain-services typecheck
# > tsc --noEmit — PASS (exit 0, no output)

pnpm --filter @borjie/domain-services test
# Test Files  48 passed (48)
#      Tests  339 passed (339)

pnpm --filter @borjie/api-gateway test
# Test Files  27 passed (27)
#      Tests  182 passed (182)
```

`pnpm --filter @borjie/api-gateway typecheck` surfaces pre-existing
failures in Agent Z3's `approval-request-repository.ts` (5 errors) and
an Agent-Z4 `ServiceRegistry` omission (`llmRouter`,
`buildBudgetGuardedAnthropicClient` — declared but not returned in the
live branch). A whole-tree grep confirms **zero** of those errors
reference any file Z2 touched; the four new routers, the two new
barrels, the two updated barrels, and the ServiceRegistry slots all
compile clean when isolated.

## Routers reachable through production code path

Every one of the 23 endpoints added by this agent:

1. Runs `authMiddleware` first (tenant extraction + JWT verification).
2. Pulls the live service / repo from the composition-root registry.
3. Emits a 503 `SERVICE_UNAVAILABLE` envelope when `DATABASE_URL` is
   unset — never a 500 / crash.
4. Scopes every SQL statement to `tenantId` (guaranteed by the existing
   repo implementations — we did not add new SQL).
5. Goes through `routeCatch(c, err, { code, status, fallback })` in
   every catch path, so driver strings / constraint names never leak
   to the client (Wave 19 contract).

Tests that previously exercised the repos in isolation
(`postgres-sublease-repository.test.ts`,
`postgres-damage-deduction-repository.test.ts`,
`postgres-conditional-survey-repository.test.ts`,
`postgres-far-repository.test.ts`) still pass; **those repos are now
reachable through production HTTP, not just unit-test stubs.**
