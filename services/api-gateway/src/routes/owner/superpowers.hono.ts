/**
 * /api/v1/owner/superpowers - cross-cutting superpower endpoints.
 *
 * Hosts the entrypoints that don't fit cleanly into a single entity
 * domain:
 *   POST /bulk-action           the chat-callable bulk operation surface
 *   POST /prefill               (internal) ack a prefill emission
 *
 * Whitelist enforcement is duplicated here (matches the brain-tool
 * superRefine) so the API stays defensible even if a future caller
 * bypasses the chat tool and hits the route directly.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import { undoJournal } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createDbIdempotencyMiddleware } from '../../middleware/db-idempotency.middleware';
import { createLogger } from '../../utils/logger';
import {
  dispatch,
  type BulkAction,
  type EntityKind,
} from './superpowers-dispatchers';

const moduleLogger = createLogger('owner-superpowers');

// ─── Whitelist matrix (mirrors ui-navigate-parser.ts bulkSchema) ──────

const BULK_WHITELIST: Readonly<Record<string, ReadonlyArray<string>>> =
  Object.freeze({
    reminders: ['snooze'],
    tasks: ['complete'],
    incidents: ['acknowledge'],
    documents: ['archive'],
    bids: ['withdraw'],
  });

const bulkSchema = z
  .object({
    entityType: z.enum([
      'reminders',
      'tasks',
      'incidents',
      'documents',
      'bids',
    ]),
    ids: z.array(z.string().min(1).max(120)).min(1).max(100),
    action: z.enum(['snooze', 'complete', 'acknowledge', 'archive', 'withdraw']),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
    reason: z.string().min(1).max(400),
    provenance: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .superRefine((v, ctx) => {
    const allowed = BULK_WHITELIST[v.entityType] ?? [];
    if (!allowed.includes(v.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `action '${v.action}' not allowed on '${v.entityType}' - whitelist: ${allowed.join(',')}`,
        path: ['action'],
      });
    }
  });

const prefillSchema = z.object({
  formId: z.string().min(1).max(120),
  values: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  submitOnAccept: z.boolean().optional().default(false),
  reason: z.string().min(1).max(400).optional(),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
});

// SOTA depth (vs v0's per-field undo): owners can revert a single
// prefilled field without rolling back the entire prefill. Each field-
// level undo lands as a `prefill` journal entry keyed by `formId +
// fieldName` so the FE companion banner can stamp "Undo just N°fields"
// per-row. The entry carries `{ beforeValue, afterValue }` for replay.
const prefillUndoFieldSchema = z.object({
  formId: z.string().min(1).max(120),
  fieldName: z.string().min(1).max(120),
  beforeValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  afterValue: z
    .union([z.string(), z.number(), z.boolean(), z.null()])
    .optional(),
  reason: z.string().min(1).max(400).optional(),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);
// Server-side hard idempotency (H2 deferral closure) — scoped to the
// bulk-action endpoint only (so /prefill etc. keep their own caching
// strategy). The middleware's INSERT-or-collide pattern guarantees
// the same Idempotency-Key cannot double-fire dispatchers even under
// a Redis split-brain.
app.use(
  '/bulk-action',
  createDbIdempotencyMiddleware({ resourceKind: 'owner.bulk-action' }),
);

// POST /bulk-action - chat-callable bulk operation
//
// Records an undo journal entry per processed id so the owner gets a
// single Undo chip representing the batch, then invokes the REAL
// per-entity dispatcher (mining_tasks update / incidents update /
// marketplace_bids withdrawal / etc.). Per-row outcomes surface in
// `failedIds[]` with the rejection reason so the FE can render
// "Partial — tap to see failed rows".
app.post('/bulk-action', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'BULK_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid bulk payload', issues: parsed.error.issues } },
      400,
    );
  }
  const input = parsed.data;

  // Append one undo journal entry per id so the owner's Undo chip can
  // reverse the whole batch. Per-row before/after state capture lives
  // in the entity-specific routes (out of scope for this cross-cutting
  // route; the journal entry is enough to surface the Undo chip).
  //
  // SOTA depth (vs Notion bulk + audit-log rollback): we return a
  // per-row failure manifest with REASONS rather than just an
  // aggregate `failed` count. The FE renders a "Partial success —
  // tap to see failed rows" expansion below the bulk chip so the
  // owner never wonders WHICH rows did not land.
  // Pick up Idempotency-Key from headers; the db-idempotency middleware
  // above already enforces server-side hard uniqueness, but we still
  // fold the key into provenance so the undo-journal carries the same
  // audit trail.
  const idempotencyKey = c.req.header('idempotency-key') ?? null;
  const provenance = {
    ...input.provenance,
    ...(idempotencyKey && { idempotencyKey }),
  };

  const undoIds: string[] = [];
  const processedIds: string[] = [];
  const failedRows: Array<{ readonly id: string; readonly reason: string }> = [];
  const dispatchArtifacts: Array<{
    readonly id: string;
    readonly artifactId: string;
    readonly artifactKind: string;
  }> = [];

  for (const id of input.ids) {
    try {
      // 1. Append undo-journal row first so the Undo chip lights up
      //    even if the dispatcher fails (owner can still inspect).
      const [row] = await db
        .insert(undoJournal)
        .values({
          tenantId: auth.tenantId,
          actorId: auth.userId,
          entityType: input.entityType,
          entityId: id,
          actionKind: 'bulk_update',
          toolId: 'mining.ui.bulk_action',
          beforeState: null,
          afterState: { action: input.action, payload: input.payload },
          windowSeconds: 300,
          provenance,
        })
        .returning();
      undoIds.push(row.id);

      // 2. Invoke the REAL per-entity dispatcher.
      const outcome = await dispatch(
        {
          db,
          tenantId: auth.tenantId,
          actorId: auth.userId,
          idempotencyKey,
          reason: input.reason,
        },
        input.entityType as EntityKind,
        input.action as BulkAction,
        id,
        input.payload,
      );

      if (outcome.ok) {
        processedIds.push(id);
        if (outcome.artifactId && outcome.artifactKind) {
          dispatchArtifacts.push({
            id,
            artifactId: outcome.artifactId,
            artifactKind: outcome.artifactKind,
          });
        }
      } else {
        failedRows.push({
          id,
          reason: outcome.reason ?? `dispatch failed for ${input.action}`,
        });
        moduleLogger.warn('owner-superpowers: dispatcher reported failure', {
          tenantId: auth.tenantId,
          entityType: input.entityType,
          action: input.action,
          id,
          reason: outcome.reason,
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      failedRows.push({ id, reason });
      moduleLogger.warn('owner-superpowers: bulk row threw', {
        tenantId: auth.tenantId,
        entityType: input.entityType,
        action: input.action,
        id,
        error: reason,
      });
    }
  }

  const processed = processedIds.length;
  const failed = failedRows.length;

  moduleLogger.info('owner-superpowers: bulk action complete', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    entityType: input.entityType,
    action: input.action,
    processed,
    failed,
    ...(idempotencyKey && { idempotencyKey }),
  });

  return c.json({
    success: true,
    data: {
      accepted: true,
      processed,
      failed,
      processedIds,
      failedIds: failedRows,
      undoJournalIds: undoIds,
      dispatchArtifacts,
    },
  });
});

// POST /prefill - ack a prefill emission (audit-only)
app.post('/prefill', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const raw = await c.req.json().catch(() => null);
  const parsed = prefillSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid prefill payload', issues: parsed.error.issues } },
      400,
    );
  }
  moduleLogger.info('owner-superpowers: prefill ack', {
    tenantId: auth.tenantId,
    userId: auth.userId,
    formId: parsed.data.formId,
    valueCount: Object.keys(parsed.data.values).length,
  });
  return c.json({
    success: true,
    data: {
      accepted: true,
      formId: parsed.data.formId,
      valueCount: Object.keys(parsed.data.values).length,
      emittedAt: new Date().toISOString(),
    },
  });
});

// POST /prefill/undo-field - per-field undo banner ack
//
// Records an undo journal entry for a single field within a prefill.
// The FE companion banner reads `GET /api/v1/owner/undo-journal/recent`
// to render per-field "Undo this change" chips. Combined with the
// per-field beforeValue/afterValue captured here, the banner can offer
// granular rollback without affecting other fields the owner kept.
app.post('/prefill/undo-field', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'PREFILL_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = prefillUndoFieldSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid prefill-undo-field payload',
          issues: parsed.error.issues,
        },
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
        // entityType convention `prefill_field:<formId>` so the FE can
        // group per-form per-field journal entries when rendering the
        // companion banner.
        entityType: `prefill_field:${input.formId}`,
        entityId: input.fieldName,
        actionKind: 'prefill',
        toolId: 'mining.ui.prefill',
        beforeState:
          input.beforeValue !== undefined
            ? { value: input.beforeValue }
            : null,
        afterState:
          input.afterValue !== undefined
            ? { value: input.afterValue }
            : null,
        windowSeconds: 300,
        provenance: {
          ...input.provenance,
          formId: input.formId,
          fieldName: input.fieldName,
          ...(input.reason !== undefined && { reason: input.reason }),
        },
      })
      .returning();

    moduleLogger.info('owner-superpowers: prefill field-undo recorded', {
      tenantId: auth.tenantId,
      userId: auth.userId,
      formId: input.formId,
      fieldName: input.fieldName,
      journalId: row.id,
    });

    return c.json(
      {
        success: true,
        data: {
          journalId: row.id,
          formId: input.formId,
          fieldName: input.fieldName,
          windowSeconds: row.windowSeconds,
        },
      },
      201,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    moduleLogger.error('owner-superpowers: prefill field-undo insert failed', {
      tenantId: auth.tenantId,
      error: message,
    });
    return c.json(
      { success: false, error: { code: 'UNDO_INSERT_FAILED', message } },
      500,
    );
  }
});

export const ownerSuperpowersRouter = app;
export default ownerSuperpowersRouter;
