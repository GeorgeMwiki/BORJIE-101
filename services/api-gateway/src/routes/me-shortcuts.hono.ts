/**
 * GET /api/v1/me/shortcuts — serve the caller's ranked learned shortcuts.
 *
 * Backs `<LearnedShortcutsPanel>` in the apps. The ranker
 * (packages/chat-ui/.../learned-shortcuts) had no gateway route, so the
 * panel rendered nothing — this route runs the ranker over the caller's
 * `user_action_tracker` rows and returns the top-N shortcuts.
 *
 * Query: `?topN=<1..50>` (optional, default 5).
 *
 * Security:
 *   - Supabase JWT canonical auth (`authMiddleware`).
 *   - RLS FORCE-enabled on `user_action_tracker`; `databaseMiddleware`
 *     binds `app.current_tenant_id` so the read is tenant-scoped. We
 *     filter by `user_id` only — no tenant double-filter.
 *   - Empty rows → empty list (the ranker handles empty).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import pino from 'pino';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { rankShortcuts } from '../services/me-progression/engines.js';
import { readUserActions, type DbExec } from '../services/me-progression/repo.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'me-shortcuts',
});

const ShortcutsQuerySchema = z
  .object({
    topN: z.coerce.number().int().min(1).max(50).optional().default(5),
  })
  .strict();

export const meShortcutsRouter = new Hono();
meShortcutsRouter.use('*', authMiddleware);
meShortcutsRouter.use('*', databaseMiddleware);

meShortcutsRouter.get('/', async (c) => {
  const parsed = ShortcutsQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'topN must be an integer between 1 and 50.',
        },
      },
      400,
    );
  }
  const { topN } = parsed.data;

  const auth = c.get('auth') as { userId: string; tenantId: string };
  const db = c.get('db') as DbExec | null;
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }

  try {
    const records = await readUserActions(db, auth.userId);
    const shortcuts = rankShortcuts(records, { topN });
    return c.json({
      success: true,
      data: shortcuts,
      meta: { total: shortcuts.length, topN },
    });
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'me-shortcuts: query failed',
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'SHORTCUTS_QUERY_FAILED',
          // Static client-facing message — detail stays in the server log
          // above so a driver/internal error string never reaches the UI.
          message: 'Failed to load shortcuts',
        },
      },
      500,
    );
  }
});

export default meShortcutsRouter;
