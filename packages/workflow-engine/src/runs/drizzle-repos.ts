/**
 * Drizzle-backed adapters for the workflow-engine's three persistence ports —
 * `WorkflowRunRepository`, `WorkflowRunEventRepository`, `AuditChainRepository`.
 *
 * These replace the in-memory adapters (`in-memory-repos.ts`) so `/workflow`
 * runs, the four-eyes APPROVAL QUEUE (runs in `in_approval`), and the
 * "append-only" hashed AUDIT CHAIN survive an api-gateway restart — closing the
 * SOC2 CC7.2 durability gap (EXECUTION_SPEC_WAVES23.md L16, execution-audit
 * EX-10). Backed by migration 0307 (`workflow_runs`, `workflow_run_events`,
 * `workflow_audit_chain`) + schema `@borjie/database` workflow-engine.schema.ts.
 *
 * TENANT ISOLATION (two layers):
 *   1. RLS — all three tables FORCE row-level security on the canonical
 *      `app.current_tenant_id` GUC. Every WRITE and every tenant-scoped QUEUE
 *      read runs inside `withTenantContext(db, tenantId, …)` so the GUC is bound
 *      on the checked-out connection (workflow ops happen outside the request
 *      `databaseMiddleware`).
 *   2. Service-role bypass — the engine's globally-unique-by-id reads
 *      (`findById(runId)`, and the run-id-only `listForRun(runId)` event/audit
 *      reads) have NO tenant hint by contract; the engine treats a runId as
 *      globally unique and the caller verifies `run.tenantId` afterwards (see
 *      engine.ts loadOrThrow nosemgrep notes). Those reads run under
 *      `withServiceRoleContext`, which the 0307 service-role-bypass policy
 *      permits without a tenant GUC.
 *
 * IMMUTABILITY: every row is mapped through an explicit converter to a frozen
 * engine record; we never hand a raw Drizzle row back to the engine.
 *
 * No `console.log` — errors propagate to the engine / route handler.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import {
  withServiceRoleContext,
  withTenantContext,
  workflowAuditChain,
  workflowRunEvents,
  workflowRuns,
} from '@borjie/database';
import type {
  ApprovalDecision,
  AuditChainEntry,
  AuditChainRepository,
  ProposedChange,
  ReviewDecision,
  WorkflowKind,
  WorkflowRun,
  WorkflowRunEvent,
  WorkflowRunEventKind,
  WorkflowRunEventRepository,
  WorkflowRunRepository,
  WorkflowRunState,
} from '../types.js';

/**
 * Drizzle client seam — `any` at the builder boundary to dodge the TS2709
 * namespace/type drift through the `@borjie/database` barrel (same idiom as
 * `services/api-gateway/.../drizzle-memory-tool.ts`). Every row is mapped
 * through an explicit converter so the engine stays fully typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;

// ─────────────────────────────────────────────────────────────────────────
// Row → engine-record converters (defensive against jsonb / null drift).
// ─────────────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

interface WorkflowRunRowLike {
  readonly id: string;
  readonly tenantId: string;
  readonly definitionId: string;
  readonly kind: string;
  readonly scope: string;
  readonly scopeRef: string;
  readonly initiatedByUserId: string;
  readonly assignedReviewerUserId: string | null;
  readonly assignedApproverUserId: string | null;
  readonly state: string;
  readonly input: unknown;
  readonly proposedChange: unknown;
  readonly reviewDecision: unknown;
  readonly approvalDecision: unknown;
  readonly rejectionReason: string | null;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
  readonly committedAt: unknown;
}

function rowToRun(row: WorkflowRunRowLike): WorkflowRun {
  return Object.freeze({
    id: row.id,
    tenantId: row.tenantId,
    definitionId: row.definitionId,
    kind: row.kind as WorkflowKind,
    scope: row.scope,
    scopeRef: row.scopeRef,
    initiatedByUserId: row.initiatedByUserId,
    assignedReviewerUserId: row.assignedReviewerUserId ?? null,
    assignedApproverUserId: row.assignedApproverUserId ?? null,
    state: row.state as WorkflowRunState,
    input: Object.freeze(asRecord(row.input)),
    proposedChange: row.proposedChange
      ? (Object.freeze({ ...(row.proposedChange as object) }) as ProposedChange)
      : null,
    reviewDecision: row.reviewDecision
      ? (Object.freeze({ ...(row.reviewDecision as object) }) as ReviewDecision)
      : null,
    approvalDecision: row.approvalDecision
      ? (Object.freeze({
          ...(row.approvalDecision as object),
        }) as ApprovalDecision)
      : null,
    rejectionReason: row.rejectionReason ?? null,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    committedAt: toDateOrNull(row.committedAt),
  });
}

function runToValues(run: WorkflowRun): Record<string, unknown> {
  return {
    id: run.id,
    tenantId: run.tenantId,
    definitionId: run.definitionId,
    kind: run.kind,
    scope: run.scope,
    scopeRef: run.scopeRef,
    initiatedByUserId: run.initiatedByUserId,
    assignedReviewerUserId: run.assignedReviewerUserId,
    assignedApproverUserId: run.assignedApproverUserId,
    state: run.state,
    input: run.input ?? {},
    proposedChange: run.proposedChange,
    reviewDecision: run.reviewDecision,
    approvalDecision: run.approvalDecision,
    rejectionReason: run.rejectionReason,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    committedAt: run.committedAt,
  };
}

interface WorkflowRunEventRowLike {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly actorUserId: string | null;
  readonly payload: unknown;
  readonly occurredAt: unknown;
}

function rowToEvent(row: WorkflowRunEventRowLike): WorkflowRunEvent {
  return Object.freeze({
    id: row.id,
    runId: row.runId,
    tenantId: row.tenantId,
    kind: row.kind as WorkflowRunEventKind,
    actorUserId: row.actorUserId ?? null,
    payload: Object.freeze(asRecord(row.payload)),
    occurredAt: toDate(row.occurredAt),
  });
}

interface WorkflowAuditRowLike {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly previousHash: string;
  readonly currentHash: string;
  readonly recordedKind: string;
  readonly recordedPayload: unknown;
  readonly recordedAt: unknown;
}

function rowToAuditEntry(row: WorkflowAuditRowLike): AuditChainEntry {
  return Object.freeze({
    id: row.id,
    runId: row.runId,
    tenantId: row.tenantId,
    previousHash: row.previousHash,
    currentHash: row.currentHash,
    recordedKind: row.recordedKind as WorkflowRunEventKind,
    recordedPayload: Object.freeze(asRecord(row.recordedPayload)),
    recordedAt: toDate(row.recordedAt),
  });
}

// ─────────────────────────────────────────────────────────────────────────
// WorkflowRunRepository
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a Drizzle-backed `WorkflowRunRepository`. `db` MUST be a non-null
 * transaction-capable Drizzle client; the composition root only wires this when
 * a DB is present and otherwise leaves the engine on its in-memory default.
 */
export function createDrizzleRunRepository(
  db: DrizzleLike,
): WorkflowRunRepository {
  if (!db) {
    throw new Error('createDrizzleRunRepository requires a non-null Drizzle client');
  }

  return {
    async insert(run) {
      await withTenantContext(db, run.tenantId, async (tx: DrizzleLike) => {
        await tx.insert(workflowRuns).values(runToValues(run));
      });
    },

    async update(run) {
      await withTenantContext(db, run.tenantId, async (tx: DrizzleLike) => {
        const values = runToValues(run);
        // PK is immutable; never re-write `id` on update.
        delete values.id;
        const result = await tx
          .update(workflowRuns)
          .set(values)
          .where(eq(workflowRuns.id, run.id))
          .returning({ id: workflowRuns.id });
        if (!result || result.length === 0) {
          throw new Error(`run_not_found: ${run.id}`);
        }
      });
    },

    async findById(id) {
      // Globally-unique-by-id read — no tenant hint by contract. The engine
      // verifies `run.tenantId` afterwards (engine.ts loadOrThrow). Runs under
      // the service-role bypass policy (migration 0307).
      return withServiceRoleContext(db, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.id, id))
          .limit(1)) as ReadonlyArray<WorkflowRunRowLike>;
        return rows[0] ? rowToRun(rows[0]) : null;
      });
    },

    async listForUser(tenantId, userId) {
      return withTenantContext(db, tenantId, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select()
          .from(workflowRuns)
          .where(
            and(
              eq(workflowRuns.tenantId, tenantId),
              eq(workflowRuns.initiatedByUserId, userId),
            ),
          )
          .orderBy(desc(workflowRuns.createdAt))) as ReadonlyArray<WorkflowRunRowLike>;
        return Object.freeze(rows.map(rowToRun));
      });
    },

    async listReviewQueue(tenantId) {
      return listByState(db, tenantId, 'in_review');
    },

    async listApprovalQueue(tenantId) {
      return listByState(db, tenantId, 'in_approval');
    },

    async list(tenantId) {
      return withTenantContext(db, tenantId, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select()
          .from(workflowRuns)
          .where(eq(workflowRuns.tenantId, tenantId))
          .orderBy(desc(workflowRuns.createdAt))) as ReadonlyArray<WorkflowRunRowLike>;
        return Object.freeze(rows.map(rowToRun));
      });
    },
  };
}

async function listByState(
  db: DrizzleLike,
  tenantId: string,
  state: WorkflowRunState,
): Promise<ReadonlyArray<WorkflowRun>> {
  return withTenantContext(db, tenantId, async (tx: DrizzleLike) => {
    const rows = (await tx
      .select()
      .from(workflowRuns)
      .where(
        and(
          eq(workflowRuns.tenantId, tenantId),
          eq(workflowRuns.state, state),
        ),
      )
      .orderBy(asc(workflowRuns.createdAt))) as ReadonlyArray<WorkflowRunRowLike>;
    return Object.freeze(rows.map(rowToRun));
  });
}

// ─────────────────────────────────────────────────────────────────────────
// WorkflowRunEventRepository
// ─────────────────────────────────────────────────────────────────────────

export function createDrizzleRunEventRepository(
  db: DrizzleLike,
): WorkflowRunEventRepository {
  if (!db) {
    throw new Error(
      'createDrizzleRunEventRepository requires a non-null Drizzle client',
    );
  }

  return {
    async insert(event) {
      await withTenantContext(db, event.tenantId, async (tx: DrizzleLike) => {
        await tx.insert(workflowRunEvents).values({
          id: event.id,
          runId: event.runId,
          tenantId: event.tenantId,
          kind: event.kind,
          actorUserId: event.actorUserId,
          payload: event.payload ?? {},
          occurredAt: event.occurredAt,
        });
      });
    },

    async listForRun(runId) {
      // Run-id-only read — globally unique by contract; service-role bypass.
      return withServiceRoleContext(db, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select()
          .from(workflowRunEvents)
          .where(eq(workflowRunEvents.runId, runId))
          .orderBy(
            asc(workflowRunEvents.occurredAt),
            asc(workflowRunEvents.id),
          )) as ReadonlyArray<WorkflowRunEventRowLike>;
        return Object.freeze(rows.map(rowToEvent));
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// AuditChainRepository
// ─────────────────────────────────────────────────────────────────────────

export function createDrizzleAuditChainRepository(
  db: DrizzleLike,
): AuditChainRepository {
  if (!db) {
    throw new Error(
      'createDrizzleAuditChainRepository requires a non-null Drizzle client',
    );
  }

  return {
    async insert(entry) {
      await withTenantContext(db, entry.tenantId, async (tx: DrizzleLike) => {
        await tx.insert(workflowAuditChain).values({
          id: entry.id,
          runId: entry.runId,
          tenantId: entry.tenantId,
          previousHash: entry.previousHash,
          currentHash: entry.currentHash,
          recordedKind: entry.recordedKind,
          recordedPayload: entry.recordedPayload ?? {},
          recordedAt: entry.recordedAt,
        });
      });
    },

    async listForRun(runId) {
      // Run-id-only read — globally unique by contract; service-role bypass.
      return withServiceRoleContext(db, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select()
          .from(workflowAuditChain)
          .where(eq(workflowAuditChain.runId, runId))
          .orderBy(
            asc(workflowAuditChain.recordedAt),
            asc(workflowAuditChain.id),
          )) as ReadonlyArray<WorkflowAuditRowLike>;
        return Object.freeze(rows.map(rowToAuditEntry));
      });
    },

    async latestHashForTenant(tenantId) {
      // Tenant is known — bind the concrete GUC. The per-tenant head is the
      // most-recently-recorded entry; "GENESIS" when the chain is empty.
      return withTenantContext(db, tenantId, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select({ currentHash: workflowAuditChain.currentHash })
          .from(workflowAuditChain)
          .where(eq(workflowAuditChain.tenantId, tenantId))
          .orderBy(
            desc(workflowAuditChain.recordedAt),
            desc(workflowAuditChain.id),
          )
          .limit(1)) as ReadonlyArray<{ currentHash: string }>;
        return rows[0]?.currentHash ?? 'GENESIS';
      });
    },
  };
}
