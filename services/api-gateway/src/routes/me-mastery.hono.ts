/**
 * GET /api/v1/me/mastery — serve the caller's progressive-disclosure
 * mastery score.
 *
 * Backs `<MasteryGate>` in the apps. The engine
 * (packages/chat-ui/.../user-mastery) had no gateway route, so the
 * component rendered nothing — this route runs the mastery computation
 * over the caller's `user_action_tracker` rows and returns the score.
 *
 * Security:
 *   - Supabase JWT canonical auth (`authMiddleware`).
 *   - RLS FORCE-enabled on `user_action_tracker`; `databaseMiddleware`
 *     binds `app.current_tenant_id` so the read is tenant-scoped. We
 *     filter by `user_id` (the per-user dimension) only — no tenant
 *     double-filter.
 *   - Empty rows → novice baseline (the engine handles empty).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import pino from 'pino';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { computeMasteryScore } from '../services/me-progression/engines.js';
import { readUserActions, type DbExec } from '../services/me-progression/repo.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'me-mastery',
});

// No query params today; the schema reserves the seam + rejects junk.
const MasteryQuerySchema = z.object({}).strict();

export const meMasteryRouter = new Hono();
meMasteryRouter.use('*', authMiddleware);
meMasteryRouter.use('*', databaseMiddleware);

meMasteryRouter.get('/', async (c) => {
  // Reject unexpected query params so a malformed caller fails loudly.
  const parsed = MasteryQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_QUERY',
          message: 'This endpoint accepts no query parameters.',
        },
      },
      400,
    );
  }

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
    const score = computeMasteryScore(records);
    return c.json({ success: true, data: score });
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'me-mastery: query failed',
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'MASTERY_QUERY_FAILED',
          // Static client-facing message — detail stays in the server log
          // above so a driver/internal error string never reaches the UI.
          message: 'Failed to compute mastery score',
        },
      },
      500,
    );
  }
});

export default meMasteryRouter;
