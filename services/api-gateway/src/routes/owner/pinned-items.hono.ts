/**
 * /api/v1/owner/pinned-items - Pinned Items (Wave SUPERPOWERS).
 *
 * Backs the `mining.ui.bookmark` chat superpower so the owner has a
 * drag-orderable strip of frequently-referenced entities above the
 * dashboard. Suggested by Mr. Mwikila after the 3rd reference to the
 * same entity.
 *
 * Routes:
 *   POST   /                          pin an entity (idempotent on re-pin)
 *   POST   /unpin                     unpin by pinnedItemId or entityRef
 *   PATCH  /:id/position              drag-reorder
 *   GET    /                          render the owner strip in order
 *
 * Auth: Supabase JWT via authMiddleware. Tenant + owner-scoped.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { pinnedItems, PIN_ENTITY_TYPES } from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-pinned-items');

const pinSchema = z.object({
  entityType: z.enum(PIN_ENTITY_TYPES),
  entityId: z.string().min(1).max(120),
  label: z.string().min(1).max(80).optional(),
  ownerId: z.string().min(1).max(120).optional(),
  provenance: z.record(z.string(), z.unknown()).optional().default({}),
});

const unpinSchema = z
  .object({
    pinnedItemId: z.string().min(1).max(120).optional(),
    entityRef: z
      .object({
        entityType: z.enum(PIN_ENTITY_TYPES),
        entityId: z.string().min(1).max(120),
      })
      .strict()
      .optional(),
    ownerId: z.string().min(1).max(120).optional(),
  })
  .refine((v) => Boolean(v.pinnedItemId ?? v.entityRef), {
    message: 'must provide pinnedItemId or entityRef',
  });

const positionSchema = z.object({
  position: z.number().int().min(0).max(50),
});

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

function defaultLabel(entityType: string, entityId: string): string {
  // Defensive default if the brain didn't pass a label - shown until
  // the FE replaces it with the canonical entity title.
  return `${entityType}:${entityId.slice(0, 12)}`;
}

// POST / - pin an entity
app.post('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'PIN_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = pinSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid pin payload', issues: parsed.error.issues } },
      400,
    );
  }
  const input = parsed.data;
  const ownerId = input.ownerId ?? auth.userId;
  const label = input.label ?? defaultLabel(input.entityType, input.entityId);

  try {
    // If a soft-deleted pin exists, reactivate; else insert fresh.
    const [existing] = await db
      .select()
      .from(pinnedItems)
      .where(
        and(
          eq(pinnedItems.tenantId, auth.tenantId),
          eq(pinnedItems.ownerId, ownerId),
          eq(pinnedItems.entityType, input.entityType),
          eq(pinnedItems.entityId, input.entityId),
        ),
      )
      .limit(1);

    if (existing) {
      if (existing.unpinnedAt) {
        const [row] = await db
          .update(pinnedItems)
          .set({
            unpinnedAt: null,
            label,
            provenance: input.provenance,
            pinnedAt: new Date(),
          })
          .where(eq(pinnedItems.id, existing.id))
          .returning();
        return c.json({
          success: true,
          data: { pinnedItemId: row.id, position: row.position, label: row.label },
        });
      }
      // Already pinned and active - return idempotent success.
      return c.json({
        success: true,
        data: {
          pinnedItemId: existing.id,
          position: existing.position,
          label: existing.label,
        },
      });
    }

    const [row] = await db
      .insert(pinnedItems)
      .values({
        tenantId: auth.tenantId,
        ownerId,
        entityType: input.entityType,
        entityId: input.entityId,
        label,
        provenance: input.provenance,
      })
      .returning();

    moduleLogger.info('owner-pinned-items: pinned', {
      tenantId: auth.tenantId,
      ownerId,
      pinnedItemId: row.id,
      entityType: input.entityType,
    });

    return c.json(
      {
        success: true,
        data: { pinnedItemId: row.id, position: row.position, label: row.label },
      },
      201,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    moduleLogger.error('owner-pinned-items: pin failed', {
      tenantId: auth.tenantId,
      error: message,
    });
    return c.json(
      { success: false, error: { code: 'PIN_INSERT_FAILED', message } },
      500,
    );
  }
});

// POST /unpin - remove from strip
app.post('/unpin', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'PIN_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = unpinSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid unpin payload', issues: parsed.error.issues } },
      400,
    );
  }
  const input = parsed.data;
  const ownerId = input.ownerId ?? auth.userId;

  const conditions = [
    eq(pinnedItems.tenantId, auth.tenantId),
    eq(pinnedItems.ownerId, ownerId),
    isNull(pinnedItems.unpinnedAt),
  ];
  if (input.pinnedItemId) {
    conditions.push(eq(pinnedItems.id, input.pinnedItemId));
  } else if (input.entityRef) {
    conditions.push(eq(pinnedItems.entityType, input.entityRef.entityType));
    conditions.push(eq(pinnedItems.entityId, input.entityRef.entityId));
  }

  const [row] = await db
    .update(pinnedItems)
    .set({ unpinnedAt: new Date() })
    .where(and(...conditions))
    .returning();

  if (!row) {
    return c.json({
      success: true,
      data: { unpinned: false, pinnedItemId: null },
    });
  }

  return c.json({
    success: true,
    data: { unpinned: true, pinnedItemId: row.id },
  });
});

// PATCH /:id/position - drag-reorder
app.patch('/:id/position', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  const id = c.req.param('id');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'PIN_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const raw = await c.req.json().catch(() => null);
  const parsed = positionSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid position payload', issues: parsed.error.issues } },
      400,
    );
  }
  const [row] = await db
    .update(pinnedItems)
    .set({ position: parsed.data.position })
    .where(
      and(
        eq(pinnedItems.tenantId, auth.tenantId),
        eq(pinnedItems.ownerId, auth.userId),
        eq(pinnedItems.id, id),
      ),
    )
    .returning();
  if (!row) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Pinned item not found' } }, 404);
  }
  return c.json({ success: true, data: { pinnedItem: row } });
});

// GET / - render the owner strip
app.get('/', async (c: any) => {
  const auth = c.get('auth') as { tenantId: string; userId: string };
  const db = c.get('db');
  if (!db) {
    return c.json(
      { success: false, error: { code: 'PIN_DB_UNAVAILABLE', message: 'Database not configured' } },
      503,
    );
  }
  const rows = await db
    .select()
    .from(pinnedItems)
    .where(
      and(
        eq(pinnedItems.tenantId, auth.tenantId),
        eq(pinnedItems.ownerId, auth.userId),
        isNull(pinnedItems.unpinnedAt),
      ),
    )
    .orderBy(asc(pinnedItems.position), asc(pinnedItems.pinnedAt));
  return c.json({ success: true, data: { pinnedItems: rows, count: rows.length } });
});

export const ownerPinnedItemsRouter = app;
export default ownerPinnedItemsRouter;
