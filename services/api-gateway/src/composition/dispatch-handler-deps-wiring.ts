/**
 * REAL dispatch-handler dependency wiring (Wave-3-int3).
 *
 * Replaces the silent success-shaped stubs in `dispatch-router-wiring.ts`
 * (`createStubEstateHandlerDeps` / `createStubMiningHandlerDeps`) with
 * REAL ports backed by the services that already live in the gateway
 * composition:
 *
 *   - MONEY  → the real double-entry `LedgerService` via
 *              `createEstateLedgerAdapter` (CLAUDE.md hard rule: money
 *              goes through `LedgerService.post()`).
 *   - AUDIT  → the real append-only, hash-chained `ai_audit_chain` via
 *              `createAuditHashChain` over the Drizzle repo (immutable,
 *              cryptographically linked — no fabricated ids).
 *   - NOTIFY → the real cross-portal bus (`CrossPortalBus.publish`), so a
 *              scheduled renewal / opened maintenance event actually fans
 *              out to every running portal SSE stream.
 *   - MINING repos → typed Drizzle inserts against the canonical mining
 *              tables `tasks`, `temporal_entities`, `maintenance_events`.
 *   - CORE entity → typed Drizzle reads/writes against `core_entity`.
 *
 * Tenant isolation (RLS): every write binds `app.current_tenant_id`
 * transaction-locally as its FIRST statement so the INSERT is subject to
 * FORCE RLS on the gateway boot-singleton pool (a different connection
 * from the request middleware). Drizzle only; immutable inputs; no
 * `console.log` (Pino logger threaded by the caller).
 *
 * Honest-failure boundary: the estate `create_lease_application` handler
 * also needs a lease-application row store and `post_receipt_draft` needs
 * a receipts table — NEITHER exists in the mining-domain schema yet. Those
 * specific ports THROW a clear `NotYetWired` error rather than fabricate a
 * fake id behind a success surface. Every OTHER estate port (core-entity,
 * the LedgerService money path, the audit chain) is real, so the failure
 * is surfaced honestly at exactly the missing seam.
 */

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  createAuditHashChain,
  type AuditHashChain,
} from '@borjie/ai-copilot';
import type {
  EstateHandlerDeps,
  MiningHandlerDeps,
} from '@borjie/module-templates';

import { createDrizzleAiAuditChainRepo } from './ai-audit-chain-repo.js';
import {
  buildLedgerService,
  createEstateLedgerAdapter,
} from './ledger/index.js';
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
 * Bind a readonly string array to a Postgres `text[]` parameter. postgres-js
 * maps a plain (mutable) JS string array onto an array param natively (same
 * idiom as `executive-brief.composition.ts`), and an empty array binds to
 * `'{}'::text[]` correctly — no manual `ARRAY[...]` construction or
 * empty-array edge case. Use as `${textArray(xs)}::text[]`.
 */
function textArray(xs: ReadonlyArray<string>): string[] {
  return [...xs];
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

/** Raised when a real backing store genuinely does not exist yet. */
export class NotYetWiredError extends Error {
  constructor(what: string) {
    super(
      `dispatch-handler wiring: ${what} has no real backing store in the ` +
        `mining-domain schema yet — refusing to fabricate a fake success id. ` +
        `Wire the real table + repository, then replace this throw.`,
    );
    this.name = 'NotYetWiredError';
  }
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
 * inside ONE tenant-bound transaction (also making the sequence read +
 * insert race-consistent against the `(tenant_id, sequence_id)` unique
 * index). We construct the chain per-append over a repo pinned to that
 * transaction's `tx` rather than the bare boot pool.
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
// ESTATE
// ─────────────────────────────────────────────────────────────────────

export interface RealEstateHandlerDepsInput {
  readonly db: SqlExecutor;
  readonly crossPortalBus: Promise<CrossPortalBus>;
  readonly logger?: DispatchHandlerDepsLogger;
}

/**
 * Build REAL estate handler deps. The MONEY path
 * (`create_lease_application` deposit) flows through `LedgerService.post()`;
 * the canonical-person resolution is a real `core_entity` read/write; the
 * audit chain is the real hash-chained `ai_audit_chain`.
 *
 * The lease-application row store and the receipt-draft store have no
 * mining-domain table yet, so those ports fail loud (`NotYetWiredError`)
 * rather than fabricating an id — see the file header.
 */
export function createRealEstateHandlerDeps(
  input: RealEstateHandlerDepsInput,
): EstateHandlerDeps {
  const { db } = input;

  const auditChainPort = makeAuditChainPort(db);
  const notifications = makeNotificationPort(input.crossPortalBus, input.logger);

  const ledger = buildLedgerService(db as never);
  const estateLedger = createEstateLedgerAdapter(db as never, ledger);

  return {
    moduleId: 'ESTATE',
    createLeaseApplication: {
      coreEntity: {
        async findById(id: string) {
          const raw = await db.execute(sql`
            SELECT id, display_name
              FROM core_entity
             WHERE id = ${id}
               AND deleted_at IS NULL
             LIMIT 1
          `);
          const row = rowsOf(raw)[0];
          if (!row) return null;
          return {
            id: String(row.id),
            displayName: String(row.display_name ?? ''),
          };
        },
        async createPerson(args) {
          const id = `ce_${randomUUID()}`;
          await withTenantTx(db, args.tenantId, async (tx) => {
            await tx.execute(sql`
              INSERT INTO core_entity (
                id, tenant_id, module_id, entity_type, display_name,
                lifecycle_state, custom_fields, created_at, updated_at, created_by
              ) VALUES (
                ${id}, ${args.tenantId}, ${args.moduleId}, 'person',
                ${args.displayName}, 'active',
                ${JSON.stringify(args.customFields ?? {})}::jsonb,
                now(), now(), 'estate-create-lease-application'
              )
            `);
          });
          return { id };
        },
      },
      // MONEY — real double-entry post via LedgerService.post().
      ledger: estateLedger,
      applications: {
        async draftApplication() {
          // No lease-application table exists in the mining-domain schema.
          throw new NotYetWiredError('estate lease-application store');
        },
      },
      auditChain: auditChainPort,
      notifications,
    },
    postReceiptDraft: {
      ledger: {
        async draft() {
          // No receipts table; the draft-ledger leg has nothing to anchor.
          throw new NotYetWiredError('estate receipt-draft ledger store');
        },
      },
      receipts: {
        async draft() {
          throw new NotYetWiredError('estate receipts store');
        },
      },
      auditChain: auditChainPort,
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
                   AND id = ANY(${[...args.licenceIds]}::text[])
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
                  ${[]}::text[], ${args.reason}, 'open',
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
