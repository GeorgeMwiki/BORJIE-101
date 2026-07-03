/**
 * Bulk-action per-entity dispatchers — closes Borjie's H2 deferral
 * (parallel to BN's bulk-action-dispatchers.ts).
 *
 * Borjie's bulk surface uses mining domain verbs:
 *   reminders.snooze    -> reminders update (trigger_at pushed forward)
 *   tasks.complete      -> mining_tasks update (status=done, completedAt)
 *   incidents.acknowledge -> incidents update (status=under_investigation)
 *   documents.archive   -> document_uploads soft-delete (deletedAt)
 *   bids.withdraw       -> marketplace_bids update (status=withdrawn)
 *
 * Hard rules respected:
 *   - Drizzle ORM only.
 *   - Tenant-scoped — the route already binds the `app.tenant_id`
 *     GUC via databaseMiddleware, so every statement runs under the
 *     owner's RLS context (no service-role GUC needed on this path).
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
  reminders,
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
//
// Owner reminders live ONLY in the `reminders` table (INSERT in
// routes/owner/reminders.hono.ts; schema owner-reminders.schema.ts). The
// reminders-dispatch worker polls `reminders WHERE trigger_at <= now() AND
// status = 'scheduled'`. Snoozing pushes `trigger_at` forward by the
// requested delta so the worker re-picks the row once it moves — no reminder
// is ever written to event_outbox, so this UPDATES `reminders` directly.
//
// Only a still-scheduled reminder is snoozable: a sent / sending /
// acknowledged / failed / cancelled row is immutable (mirrors the PATCH
// route's `status !== 'scheduled'` guard). An immutable or missing row
// returns an honest ok:false with a distinguishable reason — never a
// fabricated success.
//
// The snooze delta accepts BOTH the persona-prompt contract's
// `payload.hours` and an explicit `payload.minutes`: minutes wins when
// present, else hours*60, else the 60-minute default.
// ---------------------------------------------------------------------------

/** Statuses that can still be snoozed. Anything else is terminal / in-flight. */
const SNOOZABLE_REMINDER_STATUS = 'scheduled';

/** Resolve the snooze delta (minutes) from the payload contract. Pure. */
function resolveSnoozeMinutes(payload: Record<string, unknown>): number {
  const explicitMinutes = asInt(payload.minutes);
  if (explicitMinutes !== undefined) return explicitMinutes;
  const hours = asInt(payload.hours);
  if (hours !== undefined) return hours * 60;
  return 60;
}

export async function dispatchSnoozeReminder(
  ctx: DispatchContext,
  reminderId: string,
  payload: Record<string, unknown>,
): Promise<DispatchOutcome> {
  const snoozeMinutes = resolveSnoozeMinutes(payload);
  if (snoozeMinutes <= 0 || snoozeMinutes > 24 * 60 * 30) {
    return { ok: false, reason: 'snooze minutes must be > 0 and ≤ 30 days' };
  }

  // Read the current row under the caller's tenant RLS so we can (a) tell a
  // missing row apart from an immutable one and (b) push trigger_at forward
  // from its own scheduled time rather than wall-clock now.
  const [existing] = await ctx.db
    .select({
      id: reminders.id,
      status: reminders.status,
      triggerAt: reminders.triggerAt,
    })
    .from(reminders)
    .where(
      and(
        eq(reminders.id, reminderId),
        eq(reminders.tenantId, ctx.tenantId),
      ),
    )
    .limit(1);

  if (!existing) {
    return { ok: false, reason: `reminder ${reminderId} not found` };
  }
  if (existing.status !== SNOOZABLE_REMINDER_STATUS) {
    return {
      ok: false,
      reason: `cannot snooze a ${existing.status} reminder`,
    };
  }

  // Push trigger_at forward from the later of its current value or now, so
  // snoozing an already-due reminder still lands in the future (and a batch
  // snooze of many rows keeps each row's relative order).
  const from = Math.max(existing.triggerAt.getTime(), Date.now());
  const nextTrigger = new Date(from + snoozeMinutes * 60_000);

  // NB: the `reminders` table has no updated_at column (see
  // owner-reminders.schema.ts); the PATCH route mutates the same table
  // without one. Trigger_at IS the mutation the worker observes.
  const updated = await ctx.db
    .update(reminders)
    .set({
      triggerAt: nextTrigger,
    })
    .where(
      and(
        eq(reminders.id, reminderId),
        eq(reminders.tenantId, ctx.tenantId),
        eq(reminders.status, SNOOZABLE_REMINDER_STATUS),
      ),
    )
    .returning({ id: reminders.id });
  const row = updated[0];
  if (!row) {
    // Lost a race (row flipped out of 'scheduled' between select + update).
    return { ok: false, reason: `reminder ${reminderId} no longer snoozable` };
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
