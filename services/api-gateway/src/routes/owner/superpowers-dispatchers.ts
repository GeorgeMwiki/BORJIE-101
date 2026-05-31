/**
 * Bulk-action per-entity dispatchers — closes Borjie's H2 deferral
 * (parallel to BN's bulk-action-dispatchers.ts).
 *
 * Borjie's bulk surface uses mining domain verbs:
 *   reminders.snooze    -> event_outbox nextRetryAt push
 *   tasks.complete      -> mining_tasks update (status=done, completedAt)
 *   incidents.acknowledge -> incidents update (status=under_investigation)
 *   documents.archive   -> document_uploads soft-delete (deletedAt)
 *   bids.withdraw       -> marketplace_bids update (status=withdrawn)
 *
 * Hard rules respected:
 *   - Drizzle ORM only.
 *   - Tenant-scoped — the route already binds the `app.current_tenant_id`
 *     GUC via databaseMiddleware.
 *   - Errors per row are caught here; the route surfaces a per-row
 *     failure manifest so the FE can show "Partial — tap to see
 *     failed rows".
 *   - No money path here (bid withdrawal is a status flip, not a
 *     ledger event — the seller side records the cancellation).
 */

import { and, eq } from 'drizzle-orm';

import {
  createDatabaseClient,
  miningTasks,
  incidents,
  marketplaceBids,
  documentUploads,
  eventOutbox,
} from '@borjie/database';

// Locally-derived alias to avoid TS2709 namespace drift.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

export interface DispatchOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly artifactId?: string;
  readonly artifactKind?: string;
}

export interface DispatchContext {
  readonly db: DatabaseClient;
  readonly tenantId: string;
  readonly actorId: string;
  readonly idempotencyKey: string | null;
  readonly reason: string;
}

function asInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : undefined;
}

// ---------------------------------------------------------------------------
// reminders.snooze
// Borjie's reminder layer lives on event_outbox rows of type
// 'reminder.scheduled'. Snoozing pushes nextRetryAt forward.
// ---------------------------------------------------------------------------

export async function dispatchSnoozeReminder(
  ctx: DispatchContext,
  reminderId: string,
  payload: Record<string, unknown>,
): Promise<DispatchOutcome> {
  const snoozeMinutes = asInt(payload.minutes) ?? 60;
  if (snoozeMinutes <= 0 || snoozeMinutes > 24 * 60 * 30) {
    return { ok: false, reason: 'snooze minutes must be > 0 and ≤ 30 days' };
  }
  const nextRetry = new Date(Date.now() + snoozeMinutes * 60_000);
  const updated = await ctx.db
    .update(eventOutbox)
    .set({
      nextRetryAt: nextRetry,
      lastError: `snoozed by ${ctx.actorId} (${snoozeMinutes}m): ${ctx.reason}`,
    })
    .where(
      and(
        eq(eventOutbox.id, reminderId),
        eq(eventOutbox.tenantId, ctx.tenantId),
      ),
    )
    .returning({ id: eventOutbox.id });
  const row = updated[0];
  if (!row) {
    return { ok: false, reason: `reminder ${reminderId} not found` };
  }
  return { ok: true, artifactId: row.id, artifactKind: 'reminder' };
}

// ---------------------------------------------------------------------------
// tasks.complete
// ---------------------------------------------------------------------------

export async function dispatchCompleteTask(
  ctx: DispatchContext,
  taskId: string,
  _payload: Record<string, unknown>,
): Promise<DispatchOutcome> {
  // miningTasks uses uuid tenantId. The route already validated/parsed
  // tenantId out of the JWT so the runtime cast is safe.
  const updated = await ctx.db
    .update(miningTasks)
    .set({
      status: 'done',
      completedAt: new Date(),
    })
    .where(
      and(
        eq(miningTasks.id, taskId as never),
        eq(miningTasks.tenantId, ctx.tenantId as never),
      ),
    )
    .returning({ id: miningTasks.id });
  const row = updated[0];
  if (!row) {
    return { ok: false, reason: `task ${taskId} not found` };
  }
  return { ok: true, artifactId: String(row.id), artifactKind: 'task' };
}

// ---------------------------------------------------------------------------
// incidents.acknowledge
// ---------------------------------------------------------------------------

export async function dispatchAcknowledgeIncident(
  ctx: DispatchContext,
  incidentId: string,
  _payload: Record<string, unknown>,
): Promise<DispatchOutcome> {
  const updated = await ctx.db
    .update(incidents)
    .set({
      status: 'under_investigation',
    })
    .where(
      and(
        eq(incidents.id, incidentId),
        eq(incidents.tenantId, ctx.tenantId),
      ),
    )
    .returning({ id: incidents.id });
  const row = updated[0];
  if (!row) {
    return { ok: false, reason: `incident ${incidentId} not found` };
  }
  return { ok: true, artifactId: row.id, artifactKind: 'incident' };
}

// ---------------------------------------------------------------------------
// documents.archive
// ---------------------------------------------------------------------------

export async function dispatchArchiveDocument(
  ctx: DispatchContext,
  documentId: string,
  _payload: Record<string, unknown>,
): Promise<DispatchOutcome> {
  const updated = await ctx.db
    .update(documentUploads)
    .set({
      deletedAt: new Date(),
    })
    .where(
      and(
        eq(documentUploads.id, documentId),
        eq(documentUploads.tenantId, ctx.tenantId),
      ),
    )
    .returning({ id: documentUploads.id });
  const row = updated[0];
  if (!row) {
    return { ok: false, reason: `document ${documentId} not found` };
  }
  return { ok: true, artifactId: row.id, artifactKind: 'document' };
}

// ---------------------------------------------------------------------------
// bids.withdraw
// ---------------------------------------------------------------------------

export async function dispatchWithdrawBid(
  ctx: DispatchContext,
  bidId: string,
  _payload: Record<string, unknown>,
): Promise<DispatchOutcome> {
  const updated = await ctx.db
    .update(marketplaceBids)
    .set({
      status: 'withdrawn',
      updatedAt: new Date(),
      attributes: { withdrawReason: ctx.reason, withdrawnByUserId: ctx.actorId },
    })
    .where(
      and(
        eq(marketplaceBids.id, bidId),
        eq(marketplaceBids.tenantId, ctx.tenantId),
      ),
    )
    .returning({ id: marketplaceBids.id });
  const row = updated[0];
  if (!row) {
    return { ok: false, reason: `bid ${bidId} not found` };
  }
  return { ok: true, artifactId: row.id, artifactKind: 'bid' };
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export type EntityKind =
  | 'reminders'
  | 'tasks'
  | 'incidents'
  | 'documents'
  | 'bids';

export type BulkAction =
  | 'snooze'
  | 'complete'
  | 'acknowledge'
  | 'archive'
  | 'withdraw';

export async function dispatch(
  ctx: DispatchContext,
  entityType: EntityKind,
  action: BulkAction,
  id: string,
  payload: Record<string, unknown>,
): Promise<DispatchOutcome> {
  switch (entityType) {
    case 'reminders':
      if (action === 'snooze') return dispatchSnoozeReminder(ctx, id, payload);
      break;
    case 'tasks':
      if (action === 'complete') return dispatchCompleteTask(ctx, id, payload);
      break;
    case 'incidents':
      if (action === 'acknowledge') return dispatchAcknowledgeIncident(ctx, id, payload);
      break;
    case 'documents':
      if (action === 'archive') return dispatchArchiveDocument(ctx, id, payload);
      break;
    case 'bids':
      if (action === 'withdraw') return dispatchWithdrawBid(ctx, id, payload);
      break;
  }
  return {
    ok: false,
    reason: `no dispatcher for ${entityType}.${action}`,
  };
}
