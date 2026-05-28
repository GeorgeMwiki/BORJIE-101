/**
 * /api/v1/owner/daily-brief — owner-cockpit daily-brief surface.
 *
 * Two endpoints:
 *
 *   GET  /                 — return today's snapshot for the tenant
 *                            (alias of the unified owner brief but
 *                            scoped to the daily-cron persistence path).
 *   POST /trigger          — force a daily-brief run NOW for this
 *                            tenant. Idempotent per (tenant, date,
 *                            channel, recipient). Powered by the
 *                            in-process cron handle.
 *
 * Auth: Supabase JWT via `authMiddleware`. Tenant scope bound by
 * `databaseMiddleware`'s `app.tenant_id` GUC for RLS reads.
 *
 * Both endpoints sit alongside `owner/brief.hono.ts` — the daily-brief
 * route is the cron-aware sibling that exposes the brain-composed
 * Mr. Mwikila greeting (advisor slice) for the dashboard card. The
 * pre-existing `/owner/brief` endpoint is unchanged.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { readTodaysSnapshot } from './brief.hono';
import { getDailyBriefCron } from '../../workers/daily-brief-cron-registry';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-daily-brief');

export function createOwnerDailyBriefRouter(): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  // GET /  — most recent snapshot for today.
  app.get('/', async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId?: string; userId?: string }
      | undefined;
    if (!auth?.tenantId) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'tenant required' },
        },
        401,
      );
    }
    const db = c.get('db');
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DAILY_BRIEF_UNAVAILABLE',
            message: 'database is not configured on this gateway',
          },
        },
        503,
      );
    }
    try {
      const cached = await readTodaysSnapshot(db, auth.tenantId);
      if (!cached) {
        return c.json(
          {
            success: true,
            data: {
              brief: null,
              source: null,
              generatedAt: null,
              cached: false,
            },
          },
          200,
        );
      }
      return c.json(
        {
          success: true,
          data: {
            brief: cached.brief,
            source: cached.source,
            generatedAt: cached.generatedAtIso,
            cached: true,
          },
        },
        200,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      moduleLogger.error('daily-brief read failed', {
        evt: 'daily_brief_read_failed',
        tenantId: auth.tenantId,
        reason,
      });
      return c.json(
        {
          success: false,
          error: { code: 'DAILY_BRIEF_READ_FAILED', message: reason },
        },
        500,
      );
    }
  });

  // POST /trigger — fire today's brief for this tenant NOW. Idempotent
  // per (tenant, date, channel, recipient).
  app.post('/trigger', async (c: any) => {
    const auth = c.get('auth') as
      | { tenantId?: string; userId?: string; isOwner?: boolean }
      | undefined;
    if (!auth?.tenantId) {
      return c.json(
        {
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'tenant required' },
        },
        401,
      );
    }
    const handle = getDailyBriefCron();
    if (!handle) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DAILY_BRIEF_CRON_UNAVAILABLE',
            message: 'daily-brief cron is not registered on this gateway',
          },
        },
        503,
      );
    }
    try {
      const result = await handle.triggerForTenant(auth.tenantId);
      moduleLogger.info('daily-brief manual trigger', {
        evt: 'daily_brief_manual_trigger',
        tenantId: auth.tenantId,
        userId: auth.userId,
        generated: result.generated,
        dispatched: result.dispatched,
        failed: result.failed,
        skipped: result.skipped,
      });
      return c.json({ success: true, data: result }, 200);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      moduleLogger.error('daily-brief trigger failed', {
        evt: 'daily_brief_trigger_failed',
        tenantId: auth.tenantId,
        reason,
      });
      return c.json(
        {
          success: false,
          error: { code: 'DAILY_BRIEF_TRIGGER_FAILED', message: reason },
        },
        500,
      );
    }
  });

  return app;
}

export const ownerDailyBriefRouter = createOwnerDailyBriefRouter();
export default ownerDailyBriefRouter;
