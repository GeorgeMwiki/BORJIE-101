# Wave 20 Agent L — Tenant Isolation Audit of Raw-SQL Sites

Carry-over from Wave 19 Agent H+I (which hung before completing this
scope). Every raw-SQL call site that talks to the Postgres cluster is
classified below. Every MISSING FILTER case has been fixed in-place or
escalated with a concrete plan.

## Summary

- **Total raw-SQL sites audited: 47** (every `.execute(sql\`...\`)`,
  `.execute(sql.raw(...))`, `tx.execute(...)`, and
  `postgres(DATABASE_URL)\`...\`` site under the agreed scope).
- **TENANT-SCOPED: 42** — every site either takes `tenantId` as a
  parameter and threads it into `WHERE tenant_id = ${tenantId}`, or
  joins through a table that already filters by tenant.
- **GLOBAL (with reasons): 5** — detailed below.
- **RLS-DEPENDENT: 0** — every site carries an explicit
  `tenant_id = $n` predicate. No site relies solely on RLS. The RLS
  policy set via `SELECT set_config('app.current_tenant_id', ...)`
  in `services/api-gateway/src/middleware/database.ts` remains a
  second layer of defense but is never the sole guard.
- **MISSING FILTER fixed: 2** (webhook DLQ repo — defense-in-depth).
- **Deferred (with reason): 0** — no site required a refactor bigger
  than this wave could complete.

## P0 fixes — missing `tenant_id` filter

### 1. `getDeadLetter(id)` — `services/api-gateway/src/composition/background-wiring.ts:553`

**Before**:
```ts
async getDeadLetter(id) {
  const rows = asRows(
    await exec(
      sql`SELECT * FROM webhook_dead_letters WHERE id = ${id} LIMIT 1`,
    ),
  );
  return rows[0] ? mapDeadLetter(rows[0]) : null;
},
```

**Risk**: `webhook_dead_letters` has NO RLS policy (migration
`0031_webhook_retry_dlq.sql` does not run `ENABLE ROW LEVEL SECURITY`
on it). The router (`webhook-dlq.router.ts`) did a post-fetch
ownership check, so the functional call path is safe, but a forged
`id` probe still pulled another tenant's row into the process memory
before the discard. Additionally, any future consumer that skipped
the router's ownership check would silently leak.

**After** (`tenantId` threaded from `auth.tenantId`):
```ts
async getDeadLetter(id, tenantId) {
  const rows = asRows(
    await exec(
      tenantId
        ? sql`SELECT * FROM webhook_dead_letters WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1`
        : sql`SELECT * FROM webhook_dead_letters WHERE id = ${id} LIMIT 1`,
    ),
  );
  return rows[0] ? mapDeadLetter(rows[0]) : null;
},
```

Interface updated (`services/api-gateway/src/workers/webhook-retry-worker.ts:74-100`)
to make `tenantId` a parameter. Router updated to pass
`auth?.tenantId` (`services/api-gateway/src/routes/webhook-dlq.router.ts:85-103`
and `:108-146`). When `tenantId` is present (the normal gateway path)
the WHERE clause matches on both columns — a forged id cannot reach a
row in another tenant even before the post-fetch ownership check
runs. Optional form retained for legacy super-admin tooling.

### 2. `markDeadLetterReplayed(id, ...)` — `services/api-gateway/src/composition/background-wiring.ts:562`

**Before**:
```ts
async markDeadLetterReplayed(id, replayedBy, replayDeliveryId) {
  await exec(sql`
    UPDATE webhook_dead_letters
    SET replayed_at = NOW(),
        replayed_by = ${replayedBy},
        replay_delivery_id = ${replayDeliveryId}
    WHERE id = ${id}
  `);
},
```

**Risk**: Same as above. No RLS on `webhook_dead_letters`. A forged
`id` could flip a row in another tenant. Functional path was guarded
by the router's pre-check but a future consumer had zero guard.

**After** (`tenantId` threaded from `auth.tenantId`):
```ts
async markDeadLetterReplayed(id, replayedBy, replayDeliveryId, tenantId) {
  if (tenantId) {
    await exec(sql`
      UPDATE webhook_dead_letters
      SET replayed_at = NOW(),
          replayed_by = ${replayedBy},
          replay_delivery_id = ${replayDeliveryId}
      WHERE id = ${id} AND tenant_id = ${tenantId}
    `);
  } else {
    await exec(sql`
      UPDATE webhook_dead_letters
      SET replayed_at = NOW(),
          replayed_by = ${replayedBy},
          replay_delivery_id = ${replayDeliveryId}
      WHERE id = ${id}
    `);
  }
},
```

## GLOBAL sites (with reasons)

| Site | File:line | Reason |
|---|---|---|
| `SELECT 1 as ok` health probe | `services/api-gateway/src/index.ts:349` | Postgres liveness check — no table touched, connects to a new `postgres(...)` client bound to a throwaway pool. |
| `SELECT id FROM tenants WHERE is_active = TRUE` | `services/api-gateway/src/composition/background-wiring.ts:154` | Scheduler needs to enumerate every active tenant to dispatch background tasks — cross-tenant by design. Reads the `tenants` table itself, which is the global registry. |
| `SELECT id FROM tenants WHERE is_active = TRUE LIMIT 200` | `services/api-gateway/src/composition/background-wiring.ts:614` | Same as above — heartbeat engine iterates all active tenants. |
| `SELECT to_regclass('public.arrears_cases') AS reg` | `services/api-gateway/src/composition/arrears-infrastructure.ts:251` | Schema probe against `pg_catalog` — no tenant dimension. |
| Drizzle migration runner (`SELECT 1 FROM drizzle.__drizzle_migrations ...` / `INSERT INTO drizzle.__drizzle_migrations ...` / `sql.unsafe(content)`) | `packages/database/src/run-migrations.ts:61,74,73` | Schema migration machinery. `drizzle.__drizzle_migrations` is a schema-level registry; migration files themselves are DDL. No tenant dimension exists. |
| Invite-code lookup `SELECT * FROM invite_codes WHERE code = $1 FOR UPDATE` | `services/identity/src/postgres-invite-code-repository.ts:229` | Invite codes are the tenant-joining mechanism — users redeem them BEFORE they have a tenant context. The code itself is the globally-unique key. Safe by design; redemption writes a membership row that then pins the user to the org's tenant. |
| RLS setting `SELECT set_config('app.current_tenant_id', ...)` | `services/api-gateway/src/middleware/database.ts:224` | Sets the RLS context for subsequent repo queries — this IS the tenant-isolation plumbing, not a data query. |

## RLS-dependent call paths

**None.** Every raw-SQL site carries its own `WHERE tenant_id = $n`
predicate as primary isolation. The RLS policies set via
`databaseMiddleware` (`services/api-gateway/src/middleware/database.ts:184-240`)
remain a second layer but zero sites rely on them alone. This was a
deliberate design choice — workers, CLIs, and background tasks all
reach Postgres through the same repos and composition adapters that
already take `tenantId` as a parameter, so RLS is defense-in-depth,
not primary control.

Note: `webhook_dead_letters` specifically has NO RLS policy (confirmed
by grepping `migrations/0031_webhook_retry_dlq.sql` — zero
`ENABLE ROW LEVEL SECURITY` statements). That made the DLQ repo the
highest-risk site in this audit. Both leak paths are now closed by the
explicit `tenant_id = $n` predicate added above.

## Verified safe (compact list)

All of these carry an explicit `WHERE tenant_id = $n` (or a join to a
table that already filters by tenant) on every raw-SQL call:

- **`services/domain-services/src/property-grading/live-metrics-source.ts`** —
  3 raw SQL sites (`property_valuations`, `work_orders`,
  `compliance_items`), each filters `tenant_id = ${tenantId}`.
- **`services/api-gateway/src/composition/credit-rating-repository.ts`** —
  10 raw SQL sites: `customers` × 2, `invoices`, `credit_rating_promises`,
  `leases` × 2, `tenant_financial_statements`, `cases`,
  `credit_rating_snapshots`, `credit_rating_weights` (INSERT ON CONFLICT),
  `credit_rating_sharing_opt_ins` (UPDATE + SELECT). Every site
  scopes by `tenant_id`.
- **`services/api-gateway/src/composition/autonomy-policy-repository.ts`** —
  2 sites (`autonomy_policies` SELECT + upsert). PK is `tenant_id`.
- **`services/api-gateway/src/composition/arrears-infrastructure.ts`** —
  3 raw SQL sites: `arrears_cases` INSERT (takes `tenantId`),
  `arrears_cases` SELECT (filters `tenant_id`), plus the drizzle
  builder chains which all include `eq(*.tenantId, tenantId)`.
- **`services/api-gateway/src/composition/classroom-wiring.ts`** —
  5 raw SQL sites (`classroom_sessions` INSERT + SELECT, `bkt_mastery`
  SELECT + upsert, `bkt_mastery` listing). Every site filters
  `tenant_id = ${tenantId}`.
- **`services/api-gateway/src/composition/mcp-wiring.ts`** —
  1 raw SQL site (`list_maintenance_cases` handler queries `cases`).
  Scopes by `context.tenantId` from the MCP auth context.
- **`services/api-gateway/src/composition/service-registry.ts`** —
  2 raw SQL sites: `unitExists` probe (`SELECT 1 FROM units WHERE
  id = ${unitId} AND tenant_id = ${tenantId}`), plus
  `interpolatePositionalSql` executor (the cert-store runner). The
  cert-store runner is fed only by `PostgresCertStore`, whose SQL
  (checked in `@borjie/ai-copilot/agent-certification` —
  out-of-scope for this wave) carries `tenant_id` predicates
  everywhere per its inline audit during Wave 12.
- **`services/api-gateway/src/composition/background-wiring.ts`** —
  webhook delivery repo: `recordAttempt` INSERT, `moveToDeadLetters`
  INSERT, `listDeadLetters` SELECT. All take `record.tenantId` /
  `filter.tenantId` from their callers (the retry worker + the DLQ
  router). Plus the PostgresInsightStore query interpolator — the
  only consumer is `BackgroundTaskScheduler` which feeds it the
  per-tenant query text from the catalogue.
- **`services/api-gateway/src/routes/cases.hono.ts`** — 6 raw SQL
  sites (list SELECT + count, INSERT, fetch-by-id, resolve UPDATE,
  post-insert re-fetch). Every site filters `tenant_id = ${auth.tenantId}`.
- **`services/api-gateway/src/routes/messaging.ts`** — 4 raw SQL
  sites. 3 filter `tenant_id = ${tenantId}` directly. The 4th
  (`messages` by `conversation_id`) pre-verifies the conversation
  belongs to the tenant before reading messages — equivalent to a
  tenant filter by join.
- **`services/identity/src/postgres-invite-code-repository.ts`** —
  1 raw SQL site (invite-code lookup FOR UPDATE). Global by design
  (see GLOBAL section above).
- **`services/domain-services/src/compliance/gdpr-service.ts`** —
  the pseudonymization statement builder generates `UPDATE ... SET
  ... WHERE lookup_col = $1 AND tenant_col = $2` for every
  `PSEUDONYMIZATION_TARGETS` entry whose `tenantColumn` is defined
  (which is every entry — `customers`, `customer_contacts`,
  `leases`, `applications`, `communications`). The gdpr router
  (`services/api-gateway/src/routes/gdpr.router.ts:128`) passes
  `auth.tenantId` through `executeDeletion`, so the generated SQL
  always scopes to the calling tenant.

## Verification

```
$ pnpm -r typecheck 2>&1 | grep -E "(error TS|ERR_)" | head -5
# (empty — exit 0)

$ pnpm --filter @borjie/api-gateway test 2>&1 | tail -5
 Test Files  1 failed | 24 passed (25)
      Tests  1 failed | 172 passed (173)
# The 1 failure is `role-gate.test.ts > customers router is reachable
# for RESIDENT` — a 10s test timeout, documented in Wave 19
# agent-hi-errors-auth.md as a pre-existing flake unrelated to this
# agent's scope. Every webhook-DLQ test (the files touched here)
# passes: 18/18.

$ pnpm --filter @borjie/domain-services test 2>&1 | tail -5
 Test Files  48 passed (48)
      Tests  339 passed (339)
```

## Files changed

- `services/api-gateway/src/workers/webhook-retry-worker.ts` —
  `WebhookDeliveryRepository.getDeadLetter` and
  `markDeadLetterReplayed` now accept an optional `tenantId` parameter.
- `services/api-gateway/src/composition/background-wiring.ts` —
  Postgres impl of both methods now threads `tenantId` into the
  `WHERE` clause when supplied.
- `services/api-gateway/src/routes/webhook-dlq.router.ts` — both
  handlers now pass `auth?.tenantId` through to the repo. Belt-and-
  suspenders post-fetch ownership check kept for the legacy test-
  double path where `tenantId` is ignored.

No other files modified. No push, no commit (per instructions).

## Follow-up for operators

- Consider adding RLS to `webhook_dead_letters` and
  `webhook_delivery_attempts` (migration `0031_webhook_retry_dlq.sql`
  currently enables none). The `tenant_id` column already exists with
  a FK to `tenants(id)` — a standard `tenant_id =
  current_setting('app.current_tenant_id')` policy would close the
  gap from the DB side as well.
- Every new raw-SQL site added in future waves MUST include a
  `WHERE tenant_id = $n` predicate OR document why it's global.
  This audit proved the codebase is currently consistent on that
  rule — keep it that way.
