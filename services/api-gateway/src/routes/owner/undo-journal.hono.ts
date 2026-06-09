/**
 * /api/v1/owner/undo-journal - generic undo ledger (Wave SUPERPOWERS).
 *
 * Backs the `mining.ui.undo_last_action` chat superpower. Every WRITE
 * brain tool can append a row via `POST /` and the owner gets a 5-min
 * "Undo (4:58)" chip on every chat-initiated write.
 *
 * Routes:
 *   POST /                            append an undo journal entry
 *   POST /undo-last                   undo the most recent reversible action
 *   GET  /recent                      list the actor's reversible window
 *
 * Auth: Supabase JWT via authMiddleware. Tenant scope bound via
 *       databaseMiddleware (app.tenant_id GUC for RLS).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import {
  undoJournal,
  UNDO_ACTION_KINDS,
  DEFAULT_UNDO_WINDOW_SECONDS,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-undo-journal');

// ─── Generative reverse-replay (owner-undo-1) ────────────────────────
//
// Undo must ACTUALLY revert the source entity, not just stamp undoneAt.
// A journal row carries `beforeState` — a snapshot of the entity's
// pre-action column values. To replay, we write those values back onto
// the entity row. This is GENERATIVE: the dispatcher does not enumerate
// verbs, it restores whatever columns the snapshot holds, but ONLY the
// columns in a per-entityType allowlist so a tampered snapshot can never
// write an arbitrary column (e.g. tenant_id) or escape its table.
//
// `beforeState` keys may arrive as camelCase (the forward write captured
// a Drizzle row) or snake_case (a raw snapshot); we normalise to the
// physical snake_case column and intersect with the allowlist. Entity
// types without a known table, or rows with no usable beforeState, are
// reported `reverted:false` with an honest reason — never falsely
// "Undone".

interface ReverseTarget {
  /** Physical table name (already a safe literal — never request-derived). */
  readonly table: string;
  /** snake_case columns this entity allows a snapshot to restore. */
  readonly columns: ReadonlyArray<string>;
}

// entityType → physical table + restorable columns. Keys cover both the
// bulk-action entity kinds and their physical table aliases so a journal
// row written with either convention resolves.
const REVERSE_TARGETS: Readonly<Record<string, ReverseTarget>> = Object.freeze({
  reminders: { table: 'reminders', columns: ['status', 'trigger_at', 'attempt_count'] },
  event_outbox: { table: 'event_outbox', columns: ['next_retry_at', 'last_error'] },
  incidents: { table: 'incidents', columns: ['status', 'root_cause', 'closed_at', 'closed_by_user_id'] },
  mining_tasks: { table: 'mining_tasks', columns: ['status', 'completed_at'] },
  tasks: { table: 'mining_tasks', columns: ['status', 'completed_at'] },
  marketplace_bids: { table: 'marketplace_bids', columns: ['status', 'attributes'] },
  bids: { table: 'marketplace_bids', columns: ['status', 'attributes'] },
  document_uploads: { table: 'document_uploads', columns: ['deleted_at'] },
  documents: { table: 'document_uploads', columns: ['deleted_at'] },
});

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

interface ReverseOutcome {
  readonly reverted: boolean;
  readonly reason?: string;
}

/**
 * Apply a journal row's `beforeState` back onto its source entity. The
 * UPDATE is tenant-scoped (defence-in-depth atop the RLS GUC) and only
 * touches allowlisted columns. Returns an honest reverted/reason outcome.
 */
async function replayBeforeState(
  db: any,
  tenantId: string,
  entityType: string,
  entityId: string,
  beforeState: Record<string, unknown> | null | undefined,
): Promise<ReverseOutcome> {
  const target = REVERSE_TARGETS[entityType];
  if (!target) {
    return { reverted: false, reason: `no_reverse_handler_for_${entityType}` };
  }
  if (!beforeState || typeof beforeState !== 'object' || Array.isArray(beforeState)) {
    return { reverted: false, reason: 'no_before_state_captured' };
  }
  // Build SET fragments only for allowlisted columns present in the snapshot.
  const setFragments: ReturnType<typeof sql>[] = [];
  for (const [rawKey, value] of Object.entries(beforeState)) {
    const col = toSnakeCase(rawKey);
    if (!target.columns.includes(col)) continue;
    // Identifier is from the static allowlist (never request-derived);
    // value is bound as a parameter so it cannot inject.
    setFragments.push(sql`${sql.raw(col)} = ${value as never}`);
  }
  if (setFragments.length === 0) {
    return { reverted: false, reason: 'no_restorable_columns_in_before_state' };
  }
  try {
    const result = await db.execute(sql`
      UPDATE ${sql.raw(target.table)}
         SET ${sql.join(setFragments, sql`, `)}
       WHERE id = ${entityId}
         AND tenant_id = ${tenantId}
      RETURNING id
    `);
    const rows = Array.isArray(result)
      ? result
      : ((result as { rows?: ReadonlyArray<unknown> }).rows ?? []);
    if (rows.length === 0) {
      return { reverted: false, reason: 'entity_not_found' };
    }
    return { reverted: true };
  } catch (err) {
    moduleLogger.error('owner-undo-journal: reverse-replay failed', {
      tenantId,
      entityType,
      entityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { reverted: false, reason: 'reverse_replay_error' };
  }
}

const appendSchema = z.object({
  entityType: z.string().min(1).max(60),
  entityId: z.string().min(1).max(120),
  actionKind: z.enum(UNDO_ACTION_KINDS),
  toolId: z.string().min(1).max(120).optional(),
  beforeState: z.record(z.string(), z.unknown()).optional(),
  afterState: z.record(z.string(), z.unknown()).optional(),
  windowSeconds: z
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(DEFAULT_UNDO_WINDOW_SECONDS),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
});

const undoLastSchema = z.object({
  entityRef: z
    .object({
      entityType: z.string().min(1).max(60),
      entityId: z.string().min(1).max(120),
    })
    .strict()
    .optional(),
  reason: z.string().min(1).max(400).optional(),
});

// SOTA depth (vs Linear's single-level Cmd-Z): owners can target a
// specific journal entry from the `/recent` list-view. Mirrors Notion's
// audit-log rollback UX where any row in the 5-min window can be
// undone independently.
const undoByIdSchema = z.object({
  journalId: z.string().uuid(),
  reason: z.string().min(1).max(400).optional(),
});

// SOTA depth (vs Linear's missing redo): owners can re-apply an undone
// action via Cmd-Shift-Z. Implementation re-clears `undoneAt`/`undoneById`
// on a previously-undone entry. The 5-min reversible window is enforced
// against the ORIGINAL performedAt so a user cannot resurrect ancient
// rollbacks. RLS + actor-id check guarantee only the row's own actor can
// redo their own undo.
const redoByIdSchema = z.object({
  journalId: z.string().uuid(),
  reason: z.string().min(1).max(400).optional(),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// POST / - append an undo journal entry
app.post('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'UNDO_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = appendSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid undo payload', issues: parsed.error.issues },
      },
      400,
    );
  }
  const input = parsed.data;

  try {
    const [row] = await db
      .insert(undoJournal)
      .values({
        tenantId: auth.tenantId,
        actorId: auth.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        actionKind: input.actionKind,
        ...(input.toolId !== undefined && { toolId: input.toolId }),
        ...(input.beforeState !== undefined && { beforeState: input.beforeState }),
        ...(input.afterState !== undefined && { afterState: input.afterState }),
        windowSeconds: input.windowSeconds,
        provenance: input.provenance,
      })
      .returning();
    return c.json({ success: true, data: { entry: row } }, 201);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    moduleLogger.error('owner-undo-journal: insert failed', {
      tenantId: auth.tenantId,
      error: message,
    });
    return c.json(
      { success: false, error: { code: 'UNDO_INSERT_FAILED', message } },
      500,
    );
  }
});

// GET /recent - list the actor's reversible window
app.get('/recent', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'UNDO_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  // Only entries still within their reversible window.
  const cutoff = new Date(Date.now() - DEFAULT_UNDO_WINDOW_SECONDS * 1000);
  const rows = await db
    .select()
    .from(undoJournal)
    .where(
      and(
        eq(undoJournal.tenantId, auth.tenantId),
        eq(undoJournal.actorId, auth.userId),
        isNull(undoJournal.undoneAt),
        gt(undoJournal.performedAt, cutoff),
      ),
    )
    .orderBy(desc(undoJournal.performedAt))
    .limit(20);
  return c.json({ success: true, data: { entries: rows, count: rows.length } });
});

// POST /undo-last - reverse the most recent reversible action
app.post('/undo-last', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'UNDO_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => ({}));
  const parsed = undoLastSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid undo-last payload', issues: parsed.error.issues },
      },
      400,
    );
  }
  const input = parsed.data;

  // Find the latest un-undone entry whose window has not lapsed.
  const conditions = [
    eq(undoJournal.tenantId, auth.tenantId),
    eq(undoJournal.actorId, auth.userId),
    isNull(undoJournal.undoneAt),
    sql`${undoJournal.performedAt} + (${undoJournal.windowSeconds} || ' seconds')::interval > now()`,
  ];
  if (input.entityRef) {
    conditions.push(eq(undoJournal.entityType, input.entityRef.entityType));
    conditions.push(eq(undoJournal.entityId, input.entityRef.entityId));
  }

  const [candidate] = await db
    .select()
    .from(undoJournal)
    .where(and(...conditions))
    .orderBy(desc(undoJournal.performedAt))
    .limit(1);

  if (!candidate) {
    return c.json({
      success: true,
      data: {
        undone: false,
        journalId: null,
        actionKind: null,
        entityType: null,
        entityId: null,
      },
    });
  }

  // owner-undo-1: ACTUALLY revert the source entity by replaying the
  // captured `beforeState` BEFORE we stamp the journal undone, so the
  // owner's "Undone" confirmation reflects a real reversal. The outcome
  // (reverted / reason) is returned honestly — a journal whose entity
  // could not be reverted is still marked undone (the owner's intent is
  // recorded) but reports `reverted:false` so the FE does not falsely
  // claim the entity changed.
  const outcome = await replayBeforeState(
    db,
    auth.tenantId,
    candidate.entityType,
    candidate.entityId,
    candidate.beforeState as Record<string, unknown> | null,
  );

  const [row] = await db
    .update(undoJournal)
    .set({
      undoneAt: new Date(),
      undoneById: auth.userId,
      ...(input.reason !== undefined && { undoReason: input.reason }),
    })
    .where(eq(undoJournal.id, candidate.id))
    .returning();

  moduleLogger.info('owner-undo-journal: undone', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    journalId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    actionKind: row.actionKind,
    reverted: outcome.reverted,
    ...(outcome.reason ? { reverseReason: outcome.reason } : {}),
  });

  return c.json({
    success: true,
    data: {
      undone: true,
      reverted: outcome.reverted,
      ...(outcome.reason ? { reverseReason: outcome.reason } : {}),
      journalId: row.id,
      actionKind: row.actionKind,
      entityType: row.entityType,
      entityId: row.entityId,
    },
  });
});

// POST /undo-by-id - reverse a specific journal entry by id.
//
// SOTA-depth equivalent of "right-click any audit-log row → Rollback"
// in Notion. The 5-minute window still applies (no resurrecting an
// entry that has already lapsed); RLS + actor-id check guarantee
// only the journal's owner can undo their own row.
app.post('/undo-by-id', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'UNDO_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = undoByIdSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid undo-by-id payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const input = parsed.data;

  const [candidate] = await db
    .select()
    .from(undoJournal)
    .where(
      and(
        eq(undoJournal.id, input.journalId),
        eq(undoJournal.tenantId, auth.tenantId),
        eq(undoJournal.actorId, auth.userId),
      ),
    )
    .limit(1);

  if (!candidate) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Journal entry not found' } },
      404,
    );
  }
  if (candidate.undoneAt) {
    return c.json(
      { success: false, error: { code: 'ALREADY_UNDONE', message: 'Already undone' } },
      409,
    );
  }
  // Window check — performedAt + windowSeconds must be in the future.
  const windowEnd = new Date(candidate.performedAt).getTime() + candidate.windowSeconds * 1000;
  if (windowEnd <= Date.now()) {
    return c.json(
      { success: false, error: { code: 'WINDOW_LAPSED', message: 'Undo window has lapsed' } },
      410,
    );
  }

  // owner-undo-1: replay beforeState onto the source entity (see undo-last).
  const outcome = await replayBeforeState(
    db,
    auth.tenantId,
    candidate.entityType,
    candidate.entityId,
    candidate.beforeState as Record<string, unknown> | null,
  );

  const [row] = await db
    .update(undoJournal)
    .set({
      undoneAt: new Date(),
      undoneById: auth.userId,
      ...(input.reason !== undefined && { undoReason: input.reason }),
    })
    .where(eq(undoJournal.id, candidate.id))
    .returning();

  moduleLogger.info('owner-undo-journal: undone-by-id', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    journalId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    actionKind: row.actionKind,
    reverted: outcome.reverted,
    ...(outcome.reason ? { reverseReason: outcome.reason } : {}),
  });

  return c.json({
    success: true,
    data: {
      undone: true,
      reverted: outcome.reverted,
      ...(outcome.reason ? { reverseReason: outcome.reason } : {}),
      journalId: row.id,
      actionKind: row.actionKind,
      entityType: row.entityType,
      entityId: row.entityId,
    },
  });
});

// POST /redo-by-id - re-apply a previously undone action.
//
// SOTA-depth equivalent of Cmd-Shift-Z in Linear / Notion. The original
// performedAt + windowSeconds gates the redo so a user cannot resurrect
// rollbacks beyond the reversible window. Provenance keeps an audit
// trail of every redo: an array of timestamps + reasons appended to
// `provenance.redoHistory` so the chain is reconstructable.
app.post('/redo-by-id', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'UNDO_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = redoByIdSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid redo-by-id payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const input = parsed.data;

  const [candidate] = await db
    .select()
    .from(undoJournal)
    .where(
      and(
        eq(undoJournal.id, input.journalId),
        eq(undoJournal.tenantId, auth.tenantId),
        eq(undoJournal.actorId, auth.userId),
      ),
    )
    .limit(1);

  if (!candidate) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Journal entry not found' } },
      404,
    );
  }
  if (!candidate.undoneAt) {
    return c.json(
      { success: false, error: { code: 'NOT_UNDONE', message: 'Entry has not been undone — nothing to redo' } },
      409,
    );
  }
  // Window check — performedAt + windowSeconds must be in the future.
  // The redo is bounded by the original action's window so an ancient
  // undone entry cannot be revived.
  const windowEnd = new Date(candidate.performedAt).getTime() + candidate.windowSeconds * 1000;
  if (windowEnd <= Date.now()) {
    return c.json(
      { success: false, error: { code: 'WINDOW_LAPSED', message: 'Redo window has lapsed' } },
      410,
    );
  }

  // Preserve a redo history trail in provenance so audits can reconstruct
  // the toggle chain. The journal row's `undoneAt` is cleared (so the
  // entry returns to its "active" pre-undo state) and the provenance log
  // accrues entries.
  const priorProvenance =
    (candidate.provenance as Record<string, unknown> | null) ?? {};
  const priorRedoHistory = Array.isArray(priorProvenance.redoHistory)
    ? (priorProvenance.redoHistory as ReadonlyArray<Record<string, unknown>>)
    : [];
  const nextProvenance = {
    ...priorProvenance,
    redoHistory: [
      ...priorRedoHistory,
      {
        redoneAt: new Date().toISOString(),
        redoneById: auth.userId,
        priorUndoneAt:
          candidate.undoneAt instanceof Date
            ? candidate.undoneAt.toISOString()
            : String(candidate.undoneAt),
        priorUndoneById: candidate.undoneById ?? null,
        ...(input.reason !== undefined && { reason: input.reason }),
      },
    ],
  };

  const [row] = await db
    .update(undoJournal)
    .set({
      undoneAt: null,
      undoneById: null,
      undoReason: null,
      provenance: nextProvenance,
    })
    .where(eq(undoJournal.id, candidate.id))
    .returning();

  moduleLogger.info('owner-undo-journal: redone-by-id', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    journalId: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    actionKind: row.actionKind,
  });

  return c.json({
    success: true,
    data: {
      redone: true,
      journalId: row.id,
      actionKind: row.actionKind,
      entityType: row.entityType,
      entityId: row.entityId,
    },
  });
});

export const ownerUndoJournalRouter = app;
export default ownerUndoJournalRouter;
