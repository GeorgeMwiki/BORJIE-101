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

  // Mark the journal entry as undone. The actual replay of
  // `beforeState` into the source entity is dispatched by the
  // entity-specific undo handler (a follow-up worker). Keeping this
  // route focused on journal state means each entity owner can supply
  // its own reverse strategy without coupling.
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
  });

  return c.json({
    success: true,
    data: {
      undone: true,
      journalId: row.id,
      actionKind: row.actionKind,
      entityType: row.entityType,
      entityId: row.entityId,
    },
  });
});

export const ownerUndoJournalRouter = app;
export default ownerUndoJournalRouter;
