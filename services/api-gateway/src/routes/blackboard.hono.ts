/**
 * /api/v1/blackboard — the cross-surface CRDT state-bus front door (EA-05).
 *
 * The blackboard slot bus, finally reachable over HTTP. A decision / document /
 * task the MD posts in chat lives ONCE as a CRDT slot here and re-projects onto
 * owner-web + workforce-mobile + buyer-mobile by CONVERGENCE (the realtime
 * `state-bus` topic + the CRDT merge). This route is the set/read/list/handoff
 * surface over the process `SlotStore` (see composition/blackboard-slots-wiring).
 *
 * EVERY write/read is STRICTLY tenant-scoped: the tenant id comes from the JWT
 * (never a param/body), and the durable repository binds it as the RLS GUC via
 * withTenantContext — a tenant can NEVER touch another tenant's slots
 * (migration 0319 FORCE-RLS is the backstop).
 *
 * Routes:
 *   GET   /slots                 list (hydrate) my tenant's slots
 *   GET   /slots/:slotId         read one converged slot
 *   POST  /slots                 set a slot value (persists + broadcasts)
 *   POST  /slots/:slotId/delete  tombstone a slot
 *   POST  /handoff               re-project a live slot onto another surface
 *
 * The store persists via the CRDT lattice-join (idempotent upsert keyed by
 * (tenant_id, slot_id)) AND broadcasts a SlotDelta on the `state-bus` topic, so
 * a slot change fans to every subscribed surface. No realtime backend → the
 * in-process fallback keeps same-process subscribers converging.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { SLOT_KINDS, SLOT_SURFACES } from '@borjie/blackboard-sota';
import { authMiddleware } from '../middleware/hono-auth';
import { getSlotStore, getHandoffService, getSlotsRepository } from '../composition/blackboard-slots-wiring';
import { createLogger } from '../utils/logger';

const logger = createLogger('blackboard-slots-route');

const app = new Hono();
app.use('*', authMiddleware);

function tenantOf(c: { get: (k: 'auth') => unknown }): {
  tenantId: string;
  userId: string;
} {
  const auth = c.get('auth') as { tenantId?: string; userId?: string } | undefined;
  return { tenantId: auth?.tenantId ?? '', userId: auth?.userId ?? '' };
}

/** A surface-scoped actor id, e.g. `owner-web:user-42`. */
function actorIdFor(surface: string, userId: string): string {
  return `${surface}:${userId || 'anon'}`;
}

// ─── Validation ──────────────────────────────────────────────────────

const slotIdSchema = z.string().min(1).max(200);
const slotKindSchema = z.enum(SLOT_KINDS);
const surfaceSchema = z.enum(SLOT_SURFACES);

const SetSlotSchema = z
  .object({
    slotId: slotIdSchema,
    slotKind: slotKindSchema,
    value: z.record(z.unknown()),
    /** The surface performing the write (provenance + loop-suppression). */
    surface: surfaceSchema.default('owner-web'),
  })
  .strict();

const HandoffSchema = z
  .object({
    slotId: slotIdSchema,
    fromSurface: surfaceSchema,
    toSurface: surfaceSchema,
    toDevice: z.string().min(1).max(120).optional(),
  })
  .strict();

const ListQuerySchema = z
  .object({ slotKind: slotKindSchema.optional() })
  .strict();

// ─── Routes ──────────────────────────────────────────────────────────

/** GET /slots — hydrate every slot for my tenant (optionally by kind). */
app.get('/slots', zValidator('query', ListQuerySchema), async (c) => {
  const { tenantId } = tenantOf(c);
  if (!tenantId) {
    return c.json(
      { success: false, error: { code: 'TENANT_REQUIRED', message: 'No tenant context' } },
      400,
    );
  }
  const { slotKind } = c.req.valid('query');
  try {
    const repo = getSlotsRepository(logger);
    const slots = await repo.list(tenantId, slotKind ? { slotKind } : undefined);
    return c.json({ success: true, data: slots, meta: { count: slots.length } }, 200);
  } catch (err) {
    logger.warn('blackboard: list failed', {
      tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      { success: false, error: { code: 'SLOT_LIST_FAILED', message: 'Could not list slots' } },
      500,
    );
  }
});

/** GET /slots/:slotId — read one converged slot. */
app.get('/slots/:slotId', async (c) => {
  const { tenantId } = tenantOf(c);
  const slotId = c.req.param('slotId');
  if (!tenantId || !slotId) {
    return c.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'Missing tenant context or slotId' } },
      400,
    );
  }
  try {
    const slot = await getSlotStore(logger).read(tenantId, slotId);
    if (!slot) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Slot not found' } },
        404,
      );
    }
    return c.json({ success: true, data: slot }, 200);
  } catch (err) {
    logger.warn('blackboard: read failed', {
      tenantId,
      slotId,
      err: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      { success: false, error: { code: 'SLOT_READ_FAILED', message: 'Could not read slot' } },
      500,
    );
  }
});

/** POST /slots — set a slot value (persists via CRDT merge + broadcasts). */
app.post('/slots', zValidator('json', SetSlotSchema), async (c) => {
  const { tenantId, userId } = tenantOf(c);
  if (!tenantId) {
    return c.json(
      { success: false, error: { code: 'TENANT_REQUIRED', message: 'No tenant context' } },
      400,
    );
  }
  const body = c.req.valid('json');
  try {
    const slot = await getSlotStore(logger).set({
      tenantId,
      slotId: body.slotId,
      slotKind: body.slotKind,
      value: body.value as Record<string, unknown>,
      actorId: actorIdFor(body.surface, userId),
      surface: body.surface,
    });
    return c.json({ success: true, data: slot }, 200);
  } catch (err) {
    logger.warn('blackboard: set failed', {
      tenantId,
      slotId: body.slotId,
      err: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      { success: false, error: { code: 'SLOT_SET_FAILED', message: 'Could not set slot' } },
      500,
    );
  }
});

/** POST /slots/:slotId/delete — tombstone a slot (persists + broadcasts). */
app.post(
  '/slots/:slotId/delete',
  zValidator('json', z.object({ surface: surfaceSchema.default('owner-web') }).strict()),
  async (c) => {
    const { tenantId, userId } = tenantOf(c);
    const slotId = c.req.param('slotId');
    if (!tenantId || !slotId) {
      return c.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Missing tenant context or slotId' } },
        400,
      );
    }
    const { surface } = c.req.valid('json');
    try {
      const slot = await getSlotStore(logger).remove({
        tenantId,
        slotId,
        actorId: actorIdFor(surface, userId),
        surface,
      });
      return c.json({ success: true, data: slot }, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const notFound = message.includes('does not exist');
      logger.warn('blackboard: delete failed', { tenantId, slotId, err: message });
      return c.json(
        {
          success: false,
          error: {
            code: notFound ? 'NOT_FOUND' : 'SLOT_DELETE_FAILED',
            message: notFound ? 'Slot not found' : 'Could not delete slot',
          },
        },
        notFound ? 404 : 500,
      );
    }
  },
);

/** POST /handoff — re-project a live slot onto another surface/device. */
app.post('/handoff', zValidator('json', HandoffSchema), async (c) => {
  const { tenantId, userId } = tenantOf(c);
  if (!tenantId) {
    return c.json(
      { success: false, error: { code: 'TENANT_REQUIRED', message: 'No tenant context' } },
      400,
    );
  }
  const body = c.req.valid('json');
  try {
    const projection = await getHandoffService(logger).handoff({
      tenantId,
      slotId: body.slotId,
      fromSurface: body.fromSurface,
      toSurface: body.toSurface,
      actorId: actorIdFor(body.fromSurface, userId),
      ...(body.toDevice ? { toDevice: body.toDevice } : {}),
    });
    return c.json({ success: true, data: projection }, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const notFound = message.includes('does not exist') || message.includes('tombstoned');
    logger.warn('blackboard: handoff failed', { tenantId, slotId: body.slotId, err: message });
    return c.json(
      {
        success: false,
        error: {
          code: notFound ? 'HANDOFF_INVALID' : 'HANDOFF_FAILED',
          message: notFound ? message : 'Could not hand off slot',
        },
      },
      notFound ? 409 : 500,
    );
  }
});

export const blackboardRouter = app;
