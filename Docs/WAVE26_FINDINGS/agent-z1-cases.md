# Wave 26 — Agent Z1: Cases Infrastructure Wiring

**Scope:** Take `PostgresCaseRepository` + `CaseSLAWorker` (both fully implemented and unit-tested in `services/domain-services/src/cases/`) and wire them into the api-gateway composition root + router + worker lifecycle so production code actually exercises them.

Wave-25 Agent T flagged both as "planned + tested + orphaned". This agent closes that gap.

## What was wired

### 1. `services/domain-services/src/cases/index.ts` — re-exports
Added explicit re-exports so the composition root can pull `PostgresCaseRepository` and `CaseSLAWorker` from the same subpath import used for `CaseService`:

```ts
export { PostgresCaseRepository } from './postgres-case-repository.js';
export type { PostgresCaseRepositoryClient } from './postgres-case-repository.js';
export { CaseSLAWorker, MAX_ESCALATION_LEVEL, SLA_SYSTEM_ACTOR } from './sla-worker.js';
export type { CaseSLAWorkerOptions, TickResult as CaseSLATickResult } from './sla-worker.js';
```

Prior state: the barrel only exported `CaseService` + types, so nothing outside the cases module could reach the Postgres adapter or the worker class. This was the root cause of the "dark code" audit flag.

### 2. `services/api-gateway/src/composition/service-registry.ts` — composition slot
- New import: `{ CaseService, PostgresCaseRepository } from '@borjie/domain-services/cases'` (line 91-94).
- New registry shape (`ServiceRegistry.cases`):
  ```ts
  readonly cases: {
    readonly service: CaseService | null;
    readonly repo: PostgresCaseRepository | null;
  };
  ```
- Degraded-mode entry: `cases: { service: null, repo: null }` so routers degrade cleanly without a DB.
- Live-mode construction: instantiates `PostgresCaseRepository(db)` and wires it into a `CaseService` that shares the composition-root `eventBus`. Domain events (`CaseCreated`, `CaseEscalated`, `CaseResolved`, `CaseStatusChanged`, `NoticeSent`, `CaseSLABreached`) now flow through the same bridge Wave 19 wired from the domain bus to the observability bus — no extra glue needed.

### 3. `services/api-gateway/src/composition/service-context.middleware.ts` — request access
Added flat-key exposure (live mode only):
```ts
if (registry.cases?.service) c.set('caseService', registry.cases.service);
if (registry.cases?.repo)    c.set('caseRepo', registry.cases.repo);
```
Routers can now pull `c.get('caseRepo')` or the canonical `c.get('services').cases.*`.

### 4. `services/api-gateway/src/routes/cases.hono.ts` — new endpoint (EXTEND, not rewrite)
Added `GET /:id/full` which uses `PostgresCaseRepository.findById()` to return the full aggregate (timeline + notices + evidence + resolution + relatedInvoiceIds) rolled into the `payload` JSONB column. Falls back to the legacy raw-SQL row shape when:
- `caseRepo` is not on the context (degraded mode), OR
- the repo call throws (malformed payload) — the row-shaped response still serves the dashboard.

**All existing endpoints (`GET /`, `POST /`, `GET /:id`, `POST /:id/resolve`) are untouched** — they continue to hit raw SQL and return the same shape they always did. No 2xx → 5xx regression risk.

### 5. `services/api-gateway/src/workers/cases-sla-supervisor.ts` — NEW FILE
The `CaseSLAWorker` is tenant-bound (`findOverdue(tenantId)`). Production has many tenants, so this supervisor:
1. Queries `SELECT id FROM tenants WHERE is_active=TRUE LIMIT 500` each tick (same pattern as `background-wiring.ts`).
2. Lazily constructs + caches one `CaseSLAWorker` per tenant sharing the composition-root `caseRepo` + `caseService` + `eventBus`.
3. Invokes `tick()` sequentially per tenant; per-tenant failures are logged and isolated so one tenant's bad data cannot stall the rest.
4. Default cadence 5 minutes (overridable via `CASES_SLA_INTERVAL_MS`).
5. Gating: skipped when `registry.isLive === false`, when `NODE_ENV === 'test'`, or when `BORJIE_CASES_SLA_DISABLED=true`.
6. Exposes `start()`, `stop()`, `tickOnce()` for parity with the other supervisors (`outbox-worker`, `heartbeatSupervisor`, `backgroundSupervisor`).

## Worker lifecycle hooks added

`services/api-gateway/src/index.ts`:
- Line ~119: `import { createCaseSLASupervisor } from './workers/cases-sla-supervisor';`
- Line ~733: `const casesSlaSupervisor = createCaseSLASupervisor(serviceRegistry, logger);`
- Startup (`if (require.main === module)` block): `casesSlaSupervisor.start();` alongside `heartbeatSupervisor.start()` + `backgroundSupervisor.start()`.
- `gracefulShutdown()`: `casesSlaSupervisor.stop()` after the background supervisor stop and before the HTTP drain. Wrapped in try/catch so a stop failure never blocks the SIGTERM drain.

## Migration (applied live)

`packages/database/src/migrations/0095_cases_infrastructure.sql` — idempotent:
1. `ALTER TABLE cases ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::JSONB;`
2. `CREATE INDEX IF NOT EXISTS cases_payload_gin_idx ON cases USING GIN (payload);`
3. Backfills existing rows with `{ timeline:[], notices:[], evidence:[], resolution:null, relatedInvoiceIds:[] }` so JSONB path reads never return `NULL`.

**Why this was needed:** the earlier migration `0025_repo_amendments.sql` defined the same column but was never applied to live Postgres. Without this migration the repo's INSERT/UPDATE statements would fail with `column "payload" does not exist` on first contact with real traffic.

**Live-apply verification:**
```
$ psql "$DATABASE_URL" -f packages/database/src/migrations/0095_cases_infrastructure.sql
BEGIN / ALTER TABLE / CREATE INDEX / UPDATE 1 / COMMIT

$ psql "$DATABASE_URL" -c "\d cases" | grep payload
 payload | jsonb | ... | not null | '{}'::jsonb

$ psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE indexname='cases_payload_gin_idx';"
 cases_payload_gin_idx

$ psql "$DATABASE_URL" -f ...0095_cases_infrastructure.sql   # idempotency check
NOTICE:  column "payload" of relation "cases" already exists, skipping
NOTICE:  relation "cases_payload_gin_idx" already exists, skipping
COMMIT
```

## BackgroundTaskScheduler / TaskName registration

**Deliberately NOT registered.** The `CaseSLAWorker` ships its own `setInterval`-based scheduler in `services/domain-services/src/cases/sla-worker.ts` because its tick semantics (per-tenant escalation ladder with strict ceiling + SLA-breach event emission) don't match the `BackgroundTaskScheduler`'s dedupe-keyed insight-writing shape. Forcing it into the generic catalogue would require either (a) an `insight` side-channel that discards the worker's structured result, or (b) a catalogue-entry wrapper that loses per-tenant isolation. The dedicated supervisor is the cleaner fit — same lifecycle convention as `outbox-worker` and `heartbeatSupervisor`, which also run outside the `BackgroundTaskScheduler`.

## Tests that now actually exercise production code path

### New: `services/api-gateway/src/__tests__/cases-sla-supervisor.test.ts` (4 tests, passing)
- Ticks per active tenant and escalates overdue cases below ceiling.
- Emits `CaseSLABreached` envelope once `escalationLevel >= 3`.
- No-ops in degraded mode (`isLive=false`) without throwing.
- Respects `enabled=false`.

Each test drives `tickOnce()` directly — no real timers, no real DB — but the supervisor's control flow (list tenants → get worker → call `tick()` → propagate results) is the exact production path.

### Existing tests now reach production code
- `services/domain-services/src/cases/sla-worker.test.ts` (4 tests) — was passing in isolation; the classes it tests are now reachable from api-gateway at runtime.
- `services/domain-services/src/cases/postgres-case-repository.test.ts` — same story. The repo is constructed in `buildServices()` and attached to a live `CaseService`.

### Whole-suite green
- `pnpm --filter @borjie/domain-services test` → **339 tests passing**.
- `pnpm --filter @borjie/api-gateway test` → **182 tests passing** (178 pre-existing + 4 new).
- `pnpm --filter @borjie/api-gateway typecheck` → clean in Agent Z1 scope. Remaining errors are all in Agent Z2's parallel sublease/damage-deduction/approval wiring (not my files).

## Behaviour changes the user will see

1. **Overdue cases auto-escalate.** Every 5 minutes the gateway scans each active tenant's `cases` where `resolution_due_at < NOW()` and `status NOT IN ('resolved','closed')`. Cases below escalation level 3 get bumped one level with a `Auto-escalated by SLA worker: overdue` timeline event and a `CaseEscalated` domain event. No manual intervention needed.
2. **SLA breach events fire.** Once a case hits escalation level 3, the worker stops escalating and publishes a `CaseSLABreached` event through the shared bus. Downstream subscribers (notifications, autonomy audit) see it automatically via the Wave-19 domain→observability bridge.
3. **New endpoint: `GET /api/v1/cases/:id/full`.** Returns the full aggregate (timeline, notices, evidence, resolution) instead of the flat SQL row shape. The existing `/:id` endpoint is unchanged.
4. **`createCase` / `updateCase` / `resolveCase` via `CaseService` now persist to real Postgres.** Previously the service pattern was unreachable from HTTP because no router pulled it from a composition slot. Internal callers (e.g. the arrears-ladder's auto-open-case path, the notification webhooks that open maintenance cases) can now opt into the service via `registry.cases.service`.
5. **No existing endpoint regresses.** The legacy raw-SQL handlers in `cases.hono.ts` remain the default for all four original endpoints. The new wiring is purely additive.

## Files touched (final count: 6 new + modified)

| Path | Change |
|---|---|
| `services/domain-services/src/cases/index.ts` | re-exports added |
| `services/api-gateway/src/composition/service-registry.ts` | import + `cases` slot + live-mode construction |
| `services/api-gateway/src/composition/service-context.middleware.ts` | flat-key exposure |
| `services/api-gateway/src/routes/cases.hono.ts` | new `GET /:id/full` endpoint |
| `services/api-gateway/src/workers/cases-sla-supervisor.ts` | NEW — multi-tenant supervisor |
| `services/api-gateway/src/index.ts` | import + construct + start + stop |
| `services/api-gateway/src/__tests__/cases-sla-supervisor.test.ts` | NEW — 4 tests |
| `packages/database/src/migrations/0095_cases_infrastructure.sql` | NEW — idempotent, applied live |

## Stop-condition check

- [x] `PostgresCaseRepository` constructible from the composition root (live mode only; degraded returns `null`).
- [x] Readable from routers via `c.get('caseRepo')` and `c.get('services').cases.repo`.
- [x] `CaseSLAWorker` started via `createCaseSLASupervisor` alongside existing supervisors.
- [x] Graceful-shutdown wiring stops the supervisor before HTTP drain.
- [x] Typecheck clean in Agent Z1 scope.
- [x] `pnpm test` green for both domain-services and api-gateway.
- [x] Migration written, applied live, verified idempotent.
- [x] Report under 300 lines.
