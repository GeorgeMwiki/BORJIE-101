/**
 * REAL dispatch-handler dependency wiring (Wave-3-int3).
 *
 * Replaces the silent success-shaped MINING stub in
 * `dispatch-router-wiring.ts` (`createStubMiningHandlerDeps`) with REAL
 * ports backed by the services that already live in the gateway
 * composition:
 *
 *   - AUDIT  → the real append-only, hash-chained `ai_audit_chain` via
 *              `createAuditHashChain` over the Drizzle repo (immutable,
 *              cryptographically linked — no fabricated ids).
 *   - NOTIFY → the real cross-portal bus (`CrossPortalBus.publish`), so a
 *              scheduled renewal / opened maintenance event actually fans
 *              out to every running portal SSE stream.
 *   - MINING repos → typed Drizzle inserts against the canonical mining
 *              tables `tasks`, `temporal_entities`, `maintenance_events`.
 *
 * Tenant isolation (RLS): every write binds `app.current_tenant_id`
 * transaction-locally as its FIRST statement so the INSERT is subject to
 * FORCE RLS on the gateway boot-singleton pool (a different connection
 * from the request middleware). Drizzle only; immutable inputs; no
 * `console.log` (Pino logger threaded by the caller).
 *
 * NOTE: the pre-Borjie property-era ESTATE dispatch handlers
 * (`create_lease_application` deposit through `LedgerService.post()` +
 * `post_receipt_draft`) were EXCISED. They modelled lease / tenant-deposit
 * property money with no mining-estate backing schema; a mining estate's
 * real money (royalty / sales) already flows through `LedgerService.post()`
 * in `services/payments-ledger`. No dispatch path in this file touches
 * money — mining handlers only write `tasks` / `temporal_entities` /
 * `maintenance_events`.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  createAuditHashChain,
  type AuditHashChain,
} from '@borjie/ai-copilot';
import type { MiningHandlerDeps } from '@borjie/module-templates';

import { createDrizzleAiAuditChainRepo } from './ai-audit-chain-repo.js';
import { tenantTopic, type CrossPortalBus } from './cross-portal-bus.js';

// ─────────────────────────────────────────────────────────────────────
// Structural DB client — single `execute(q)` method. The live Drizzle
// `DatabaseClient` satisfies it; we keep this file free of a hard
// compile-time dependency on `@borjie/database`'s namespace types (the
// TS2709 collision documented across the other ledger wiring files).
// ─────────────────────────────────────────────────────────────────────

interface SqlExecutor {
  execute(q: unknown): Promise<unknown>;
  transaction<T>(cb: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

export interface DispatchHandlerDepsLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

// ─────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────

function rowsOf(raw: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as ReadonlyArray<Record<string, unknown>>;
  }
  return [];
}

/**
 * Build a Postgres `ARRAY[...]` SQL fragment for a readonly string array.
 *
 * drizzle's `sql` template SPREADS a bare JS array into a parenthesized
 * param list, so `${xs}::text[]` renders `($1, $2)::text[]` (an invalid
 * record-to-text[] cast) and `${[]}::text[]` renders `()::text[]` (a
 * syntax error). The `ARRAY[...]` form is required: each element is its
 * own param and an empty array yields the valid literal `ARRAY[]`.
 * Use as `${textArray(xs)}::text[]`, which renders `ARRAY[$1, $2]::text[]`
 * (or `ARRAY[]::text[]` when empty).
 */
function textArray(xs: ReadonlyArray<string>) {
  return sql`ARRAY[${sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  )}]`;
}

/**
 * Run `body` inside a transaction whose FIRST statement binds the tenant
 * GUC transaction-locally (`set_config(..., true)`) so every write is
 * RLS-scoped to this tenant on the boot-singleton pool. Mirrors the M2
 * pattern in `accounts-provisioner.ts`.
 */
async function withTenantTx<T>(
  db: SqlExecutor,
  tenantId: string,
  body: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  if (!tenantId) {
    throw new Error('dispatch-handler wiring: non-empty tenantId required');
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    return body(tx);
  });
}

/**
 * Adapt the ai-copilot `AuditHashChain` (real hash-chained, append-only)
 * onto the module-templates `AuditChainPort` shape
 * (`append({ tenantId, action, parentHash, payload }) -> { id }`).
 *
 * RLS (critical): `ai_audit_chain` is FORCE row-level-security with policy
 * `ai_audit_chain_tenant_iso` (migration 0152) — both the `getLatest` read
 * and the `insertEntry` WITH CHECK require `app.current_tenant_id` to be
 * bound on the connection. The chain's read-then-insert MUST therefore run
 * inside ONE tenant-bound transaction. We construct the chain per-append
 * over a repo pinned to that transaction's `tx` rather than the bare boot
 * pool.
 *
 * Concurrency (critical): the read-then-insert is NOT race-consistent on
 * its own — two concurrent same-tenant appends both read the same
 * `MAX(sequence_id)`, compute the same next sequence, and collide on the
 * `(tenant_id, sequence_id)` unique index (23505). Because the originating
 * task/temporal writes commit in their OWN transactions, a collision here
 * would orphan an already-committed domain row and gap the tamper-evident
 * chain. We therefore take `pg_advisory_xact_lock(hashtext(tenantId))` as
 * the FIRST statement after the GUC bind so same-tenant appends serialize
 * within the tx; the lock auto-releases at commit/rollback and is keyed
 * per-tenant so different tenants never contend.
 *
 * The handler's `parentHash` (the source capture/document audit id) is
 * carried INTO the payload + used as the `turnId` correlation; the chain
 * computes its OWN cryptographic `prevHash`/`thisHash` for integrity, so
 * the row is genuinely tamper-evident rather than a free-form parent
 * pointer. `moduleId` (present on the estate variant) is folded into the
 * payload when supplied.
 */
function makeAuditChainPort(db: SqlExecutor): {
  append(args: {
    readonly tenantId: string;
    readonly moduleId?: string;
    readonly action: string;
    readonly parentHash: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
} {
  return {
    async append(args) {
      return withTenantTx(db, args.tenantId, async (tx) => {
        // Serialize concurrent same-tenant appends so the chain's
        // read-then-insert (getLatest → insertEntry) cannot race the
        // (tenant_id, sequence_id) unique index and orphan the already
        // committed task/temporal rows. Auto-released at commit/rollback.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${args.tenantId}))`,
        );
        const txRepo = createDrizzleAiAuditChainRepo(tx);
        if (!txRepo) {
          throw new Error(
            'dispatch-handler wiring: audit-chain repo unavailable inside tx',
          );
        }
        const chain: AuditHashChain = createAuditHashChain({ repo: txRepo });
        const entry = await chain.append({
          tenantId: args.tenantId,
          // Correlate the chain row to the originating capture/proposal. A
          // genesis (null parent) maps to a fresh correlation id.
          turnId: args.parentHash ?? randomUUID(),
          action: args.action,
          payload: {
            ...args.payload,
            ...(args.moduleId ? { module_id: args.moduleId } : {}),
            source_parent_hash: args.parentHash,
          },
        });
        return { id: entry.id };
      });
    },
  };
}

/**
 * Adapt the `CrossPortalBus` onto the module-templates `NotificationPort`
 * shape. Publishes a real `notification` event onto the tenant's
 * cross-portal channel so every running portal SSE stream receives it.
 * The handler's logical `channel` string + subject + correlation ride in
 * the payload; tenant isolation is structural (the topic is derived from
 * the tenantId via `tenantTopic`, never a caller-supplied channel).
 */
function makeNotificationPort(
  busPromise: Promise<CrossPortalBus>,
  logger?: DispatchHandlerDepsLogger,
): {
  publish(args: {
    readonly tenantId: string;
    readonly channel: string;
    readonly subject: string;
    readonly correlation: Readonly<Record<string, unknown>>;
  }): Promise<void>;
} {
  return {
    async publish(args) {
      try {
        const bus = await busPromise;
        await bus.publish(tenantTopic(args.tenantId), {
          kind: 'notification',
          payload: {
            channel: args.channel,
            subject: args.subject,
            correlation: args.correlation,
          },
          emittedBy: 'system',
          emittedAt: new Date().toISOString(),
        });
      } catch (err) {
        // A notification fan-out failure must NOT roll back a committed
        // money/task write — the durable row is the source of truth. Log
        // and continue (best-effort, like the announcement dispatcher).
        logger?.warn?.(
          {
            wiring: 'dispatch-handler-notifications',
            tenantId: args.tenantId,
            error: err instanceof Error ? err.message : String(err),
          },
          'dispatch-handler notification publish failed — continuing',
        );
      }
    },
  };
}

/** Stable id factory — real crypto UUIDs (handlers stay pure). */
function makeIdGenerator(): { newId(prefix: string): string } {
  return {
    newId(prefix: string): string {
      return `${prefix}_${randomUUID()}`;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// MINING
// ─────────────────────────────────────────────────────────────────────

export interface RealMiningHandlerDepsInput {
  readonly db: SqlExecutor;
  readonly crossPortalBus: Promise<CrossPortalBus>;
  readonly logger?: DispatchHandlerDepsLogger;
}

/**
 * Build REAL mining handler deps. All three actions write real Drizzle
 * rows: `schedule_licence_renewal` → `tasks` + `temporal_entities`,
 * `open_equipment_maintenance` → `maintenance_events` + `tasks`,
 * `bulk_mark_licences_for_renewal` → N `tasks` rows. Audit is the real
 * hash chain; notifications fan out on the real cross-portal bus.
 */
export function createRealMiningHandlerDeps(
  input: RealMiningHandlerDepsInput,
): MiningHandlerDeps {
  const { db } = input;

  const auditChainPort = makeAuditChainPort(db);
  const notifications = makeNotificationPort(input.crossPortalBus, input.logger);
  const ids = makeIdGenerator();

  // ── tasks insert (shared by 3 actions) ──────────────────────────────
  async function insertTask(args: {
    readonly id: string;
    readonly tenantId: string;
    readonly ownerUserId: string | null;
    readonly title: string;
    readonly kind: string;
    readonly priority: number;
    readonly siteId: string | null;
    readonly licenceId: string | null;
    readonly dueDate: string | null;
    readonly requiredEvidence: ReadonlyArray<string>;
    readonly riskIfDelayed: string;
    readonly aiFollowupCadence: 'daily' | 'every_3d' | 'weekly' | 'monthly';
    readonly attributes: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }> {
    await withTenantTx(db, args.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tasks (
          id, tenant_id, owner_user_id, title, kind, priority,
          site_id, licence_id, due_date, required_evidence,
          risk_if_delayed, status, ai_followup_cadence, attributes, created_at
        ) VALUES (
          ${args.id}, ${args.tenantId}, ${args.ownerUserId}, ${args.title},
          ${args.kind}, ${args.priority}, ${args.siteId}, ${args.licenceId},
          ${args.dueDate}::date,
          ${textArray(args.requiredEvidence)}::text[],
          ${args.riskIfDelayed}, 'open', ${args.aiFollowupCadence},
          ${JSON.stringify(args.attributes ?? {})}::jsonb, now()
        )
      `);
    });
    return { id: args.id };
  }

  const tasksPort = {
    insert: insertTask,
  };

  return {
    moduleId: 'MINING',
    clock: {
      nowIso: () => new Date().toISOString(),
      todayIso: () => new Date().toISOString().slice(0, 10),
    },
    scheduleLicenceRenewal: {
      tasks: tasksPort,
      temporalEntities: {
        async insert(args) {
          await withTenantTx(db, args.tenantId, async (tx) => {
            await tx.execute(sql`
              INSERT INTO temporal_entities (
                id, tenant_id, entity_type, entity_key, attributes,
                valid_from, valid_to, recorded_at, confidence,
                evidence_ids, source
              ) VALUES (
                ${args.id}, ${args.tenantId}, ${args.entityType},
                ${args.entityKey},
                ${JSON.stringify(args.attributes ?? {})}::jsonb,
                ${args.validFrom}::timestamptz,
                ${args.validTo}::timestamptz,
                now(), ${args.confidence},
                ${textArray(args.evidenceIds)}::text[],
                ${args.source}
              )
            `);
          });
          return { id: args.id };
        },
      },
      auditChain: auditChainPort,
      notifications,
      ids,
    },
    openEquipmentMaintenance: {
      maintenanceEvents: {
        async insert(args) {
          await withTenantTx(db, args.tenantId, async (tx) => {
            await tx.execute(sql`
              INSERT INTO maintenance_events (
                id, tenant_id, asset_id, kind, status, summary,
                downtime_hours, performed_by_user_id, scheduled_for,
                evidence_ids, attributes, created_at
              ) VALUES (
                ${args.id}, ${args.tenantId}, ${args.assetId}, ${args.kind},
                ${args.status}, ${args.summary}, ${args.downtimeHours},
                ${args.performedByUserId},
                ${args.scheduledFor}::timestamptz,
                ${textArray(args.evidenceIds)}::text[],
                ${JSON.stringify(args.attributes ?? {})}::jsonb, now()
              )
            `);
          });
          return { id: args.id };
        },
      },
      tasks: tasksPort,
      auditChain: auditChainPort,
      notifications,
      ids,
    },
    bulkMarkLicencesForRenewal: {
      licenceTasks: {
        async bulkCreateRenewalTasks(args) {
          // One task per existing licence, all in a SINGLE transaction so
          // the bulk op (HITL-gated — "one approve flips N rows") commits
          // atomically. Licences that don't exist (or belong to another
          // tenant) are skipped with an honest `not_found` rather than
          // aborting the whole batch on an FK violation. The FK on
          // `tasks.licence_id` requires the licence to exist at insert
          // time, so we resolve the existing set first inside the same tx.
          const created: Array<{ licenceId: string; taskId: string }> = [];
          await withTenantTx(db, args.tenantId, async (tx) => {
            const existingRows = rowsOf(
              await tx.execute(sql`
                SELECT id FROM licences
                 WHERE tenant_id = ${args.tenantId}
                   AND id = ANY(${textArray(args.licenceIds)}::text[])
              `),
            );
            const existing = new Set(
              existingRows.map((r) => String(r.id)),
            );
            for (const licenceId of args.licenceIds) {
              if (!existing.has(licenceId)) continue;
              const taskId = `task_${randomUUID()}`;
              await tx.execute(sql`
                INSERT INTO tasks (
                  id, tenant_id, owner_user_id, title, kind, priority,
                  site_id, licence_id, due_date, required_evidence,
                  risk_if_delayed, status, ai_followup_cadence, attributes,
                  created_at
                ) VALUES (
                  ${taskId}, ${args.tenantId}, NULL,
                  ${`Licence renewal — ${licenceId}`}, 'licence_renewal', 3,
                  NULL, ${licenceId}, ${args.dueDate}::date,
                  ${textArray([])}::text[], ${args.reason}, 'open',
                  ${args.followupCadence},
                  ${JSON.stringify({ ...args.attributes, licence_id: licenceId })}::jsonb,
                  now()
                )
              `);
              created.push({ licenceId, taskId });
            }
          });
          const createdIds = new Set(created.map((c) => c.licenceId));
          const skipped = args.licenceIds
            .filter((id) => !createdIds.has(id))
            .map((id) => ({ licenceId: id, reason: 'not_found' }));
          return { created, skipped };
        },
      },
      auditChain: auditChainPort,
    },
  };
}
