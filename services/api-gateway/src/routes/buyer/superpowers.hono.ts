/**
 * /api/v1/buyer/superpowers — buyer-persona superpower endpoints.
 *
 * Mirrors the blessed owner superpowers wiring
 * (`routes/owner/superpowers.hono.ts` + `undo-journal.hono.ts` +
 * `pinned-items.hono.ts`) but scoped to the BUYER persona's allowed
 * verbs. buyer-mobile (`src/superpowers/*`) calls four endpoints that
 * previously had no mount and failed at runtime:
 *
 *   POST /bulk-action              bulk_rfb | bulk_watch on N entities
 *   POST /undo-journal/undo-last   reverse a batch by its journal ids
 *   POST /pinned-items             pin / bookmark an entity to watchlist
 *   GET  /search?q=&persona=buyer  universal search (listings + own RFBs)
 *
 * Auth: Supabase JWT via authMiddleware. Tenant scope bound by
 *       databaseMiddleware (app.current_tenant_id GUC → RLS FORCE).
 *       Handlers never double-filter beyond the explicit tenant guard
 *       that mirrors the owner routes.
 *
 * Persona guard: every handler asserts persona === 'buyer' and rejects
 * any non-buyer action verb server-side, so a caller cannot bypass the
 * mobile client to invoke owner/manager verbs through this surface.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  buyerBulkActionSchema,
  buyerPinSchema,
  buyerSearchQuerySchema,
  buyerUndoLastSchema,
} from './superpowers-schemas';
import {
  recordBulkAction,
  runBuyerSearch,
  undoLastBatch,
  upsertPinnedItem,
  type BuyerSuperpowersDb,
} from './superpowers-store';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('buyer-superpowers');

interface AuthContext {
  readonly tenantId?: string;
  readonly userId?: string;
}

function requireContext(
  c: { get: (k: string) => unknown; json: (b: unknown, s?: number) => unknown },
):
  | { ok: true; auth: { tenantId: string; userId: string }; db: BuyerSuperpowersDb }
  | { ok: false; response: unknown } {
  const auth = c.get('auth') as AuthContext | undefined;
  const db = c.get('db') as BuyerSuperpowersDb | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return {
      ok: false,
      response: c.json(
        {
          success: false,
          error: {
            code: 'SUPERPOWERS_UNAVAILABLE',
            message: {
              en: 'Superpowers temporarily unavailable',
              sw: 'Nguvu maalum hazipatikani kwa muda',
            },
          },
        },
        503,
      ),
    };
  }
  return { ok: true, auth: { tenantId: auth.tenantId, userId: auth.userId }, db };
}

function validationError(
  c: { json: (b: unknown, s?: number) => unknown },
  issues: ReadonlyArray<unknown>,
): unknown {
  return c.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: {
          en: 'Invalid request payload',
          sw: 'Maombi si sahihi',
        },
        issues,
      },
    },
    400,
  );
}

export const buyerSuperpowersRouter = new Hono();
buyerSuperpowersRouter.use('*', authMiddleware);
buyerSuperpowersRouter.use('*', databaseMiddleware);

// POST /bulk-action — buyer bulk_rfb | bulk_watch.
//
// Records one undo-journal row per id (journal-first, mirroring the
// owner route) so the mobile Undo toast lights up for the whole batch.
// `bulk_watch` additionally pins each entity to the buyer's watchlist
// (real DB write) so the watchlist strip reflects the selection.
buyerSuperpowersRouter.post('/bulk-action', async (c: any) => {
  const ctx = requireContext(c);
  if (!ctx.ok) return ctx.response;
  const raw = await c.req.json().catch(() => null);
  const parsed = buyerBulkActionSchema.safeParse(raw);
  if (!parsed.success) return validationError(c, parsed.error.issues);

  const idempotencyKey = c.req.header('idempotency-key') ?? null;
  try {
    const result = await recordBulkAction(ctx.db, {
      tenantId: ctx.auth.tenantId,
      actorId: ctx.auth.userId,
      input: parsed.data,
      idempotencyKey,
    });
    moduleLogger.info('buyer-superpowers: bulk action complete', {
      tenantId: ctx.auth.tenantId,
      userId: ctx.auth.userId,
      action: parsed.data.action,
      processed: result.processed,
      failed: result.failed,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    moduleLogger.error('buyer-superpowers: bulk action failed', {
      tenantId: ctx.auth.tenantId,
      error: message,
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'BULK_ACTION_FAILED',
          message: {
            en: 'Bulk action failed',
            sw: 'Kitendo cha wingi kimeshindwa',
          },
        },
      },
      500,
    );
  }
});

// POST /undo-journal/undo-last — reverse a batch by its journal ids.
//
// The mobile undo toast holds the `journalIds` returned by the bulk /
// pin calls. Marking them undone reverses a `bulk_watch` pin (so the
// entity drops off the watchlist) and flags the journal row so the
// chip cannot fire twice.
buyerSuperpowersRouter.post('/undo-journal/undo-last', async (c: any) => {
  const ctx = requireContext(c);
  if (!ctx.ok) return ctx.response;
  const raw = await c.req.json().catch(() => null);
  const parsed = buyerUndoLastSchema.safeParse(raw);
  if (!parsed.success) return validationError(c, parsed.error.issues);

  try {
    const result = await undoLastBatch(ctx.db, {
      tenantId: ctx.auth.tenantId,
      actorId: ctx.auth.userId,
      journalIds: parsed.data.journalIds,
      ...(parsed.data.reason !== undefined ? { reason: parsed.data.reason } : {}),
    });
    moduleLogger.info('buyer-superpowers: undo-last complete', {
      tenantId: ctx.auth.tenantId,
      userId: ctx.auth.userId,
      undone: result.undone,
      requested: parsed.data.journalIds.length,
    });
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    moduleLogger.error('buyer-superpowers: undo-last failed', {
      tenantId: ctx.auth.tenantId,
      error: message,
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'UNDO_FAILED',
          message: { en: 'Undo failed', sw: 'Kutendua kumeshindwa' },
        },
      },
      500,
    );
  }
});

// POST /pinned-items — bookmark / pin an entity to the watchlist.
buyerSuperpowersRouter.post('/pinned-items', async (c: any) => {
  const ctx = requireContext(c);
  if (!ctx.ok) return ctx.response;
  const raw = await c.req.json().catch(() => null);
  const parsed = buyerPinSchema.safeParse(raw);
  if (!parsed.success) return validationError(c, parsed.error.issues);

  try {
    const result = await upsertPinnedItem(ctx.db, {
      tenantId: ctx.auth.tenantId,
      ownerId: ctx.auth.userId,
      input: parsed.data,
    });
    moduleLogger.info('buyer-superpowers: pinned', {
      tenantId: ctx.auth.tenantId,
      userId: ctx.auth.userId,
      pinnedItemId: result.pinnedItemId,
      entityType: parsed.data.entityType,
    });
    return c.json({ success: true, data: result }, result.created ? 201 : 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    moduleLogger.error('buyer-superpowers: pin failed', {
      tenantId: ctx.auth.tenantId,
      error: message,
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'PIN_FAILED',
          message: { en: 'Pin failed', sw: 'Kubandika kumeshindwa' },
        },
      },
      500,
    );
  }
});

// GET /search?q=&persona=buyer&limit= — universal search.
//
// Tenant-scoped read over visible marketplace listings + the buyer's
// own request-for-bids. Returns navigate targets the mobile FAB renders.
buyerSuperpowersRouter.get('/search', async (c: any) => {
  const ctx = requireContext(c);
  if (!ctx.ok) return ctx.response;
  const parsed = buyerSearchQuerySchema.safeParse({
    q: c.req.query('q'),
    persona: c.req.query('persona'),
    limit: c.req.query('limit'),
  });
  if (!parsed.success) return validationError(c, parsed.error.issues);

  try {
    const results = await runBuyerSearch(ctx.db, {
      tenantId: ctx.auth.tenantId,
      actorId: ctx.auth.userId,
      query: parsed.data.q,
      limit: parsed.data.limit,
    });
    return c.json({ success: true, data: { results } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    moduleLogger.error('buyer-superpowers: search failed', {
      tenantId: ctx.auth.tenantId,
      error: message,
    });
    return c.json(
      {
        success: false,
        error: {
          code: 'SEARCH_FAILED',
          message: { en: 'Search failed', sw: 'Utafutaji umeshindwa' },
        },
      },
      500,
    );
  }
});

// Re-export the validated query schema type for tests / callers.
export type BuyerSearchQuery = z.infer<typeof buyerSearchQuerySchema>;

export default buyerSuperpowersRouter;
