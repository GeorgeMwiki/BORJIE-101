/**
 * Pilot feedback router — capture rating + free-text from the in-app
 * "Niarifu Borjie" widget during the pilot window.
 *
 *   POST /api/v1/pilot/feedback
 *     body: { rating: 1-5, message: string, screenId?, sessionContext? }
 *     auth: required (Supabase JWT; tenant + user bound by hono-auth)
 *
 * Persists to `pilot_feedback` (migration 0077). RLS keeps cross-tenant
 * reads impossible; this router only writes — listing/reading flows
 * through a separate admin surface in a follow-up.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth.js';
import { databaseMiddleware } from '../middleware/database.js';
import { createLogger } from '../utils/logger.js';

const moduleLogger = createLogger('pilot-feedback');

const PilotFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  message: z.string().min(1).max(5000),
  screenId: z.string().min(1).max(120).optional(),
  sessionContext: z.record(z.unknown()).optional(),
});

export type PilotFeedbackInput = z.infer<typeof PilotFeedbackSchema>;

/**
 * Hono app factory. Tests can substitute their own composition (no DB)
 * by mounting a fake `databaseMiddleware` that supplies an in-memory
 * drizzle client on `c.get('db')`.
 */
export function createPilotFeedbackRouter(): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.post('/', async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId?: string; userId?: string }
      | undefined;
    if (!auth?.tenantId || !auth?.userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'tenant + user must be bound on the auth context',
          },
        },
        401,
      );
    }

    let parsed: PilotFeedbackInput;
    try {
      parsed = PilotFeedbackSchema.parse(await c.req.json());
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'invalid payload';
      return c.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message,
          },
        },
        400,
      );
    }

    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'PILOT_FEEDBACK_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }

    try {
      const result = await db.execute(sql`
        INSERT INTO pilot_feedback
          (tenant_id, user_id, rating, message, screen_id, session_context)
        VALUES
          (${auth.tenantId}, ${auth.userId}, ${parsed.rating}, ${parsed.message},
           ${parsed.screenId ?? null},
           ${parsed.sessionContext ? JSON.stringify(parsed.sessionContext) : null}::jsonb)
        RETURNING id, created_at
      `);
      const row = (result.rows ?? result)[0] as
        | { id: string; created_at: string }
        | undefined;
      return c.json(
        {
          success: true,
          data: {
            id: row?.id ?? null,
            createdAt: row?.created_at ?? null,
          },
        },
        201,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'pilot feedback insert failed';
      moduleLogger.error('pilot feedback insert failed', {
        evt: 'pilot_feedback_insert_failed',
        tenantId: auth.tenantId,
        userId: auth.userId,
        reason: message,
      });
      return c.json(
        {
          success: false,
          error: {
            code: 'PILOT_FEEDBACK_INSERT_FAILED',
            message,
          },
        },
        500,
      );
    }
  });

  return app;
}

export const pilotFeedbackRouter = createPilotFeedbackRouter();
export default pilotFeedbackRouter;
