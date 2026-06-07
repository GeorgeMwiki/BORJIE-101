/**
 * /api/v1/mining/internal/analytics — HQ product analytics (I-W-18).
 *
 * SUPER_ADMIN / ADMIN only. Aggregates the REAL append-only
 * `activation_events` funnel log (migration 0300) into:
 *
 *   GET /funnel   — the activation funnel: distinct tenants that reached
 *                   each ordered milestone within a lookback window.
 *   GET /cohorts  — monthly signup cohorts with an "activated" retention
 *                   proxy (tenants in the cohort that recorded any later
 *                   milestone beyond signup).
 *
 * This is a FLEET-METADATA surface — HQ aggregates across every tenant,
 * so it mirrors `daily-brief-overview.hono.ts` / `tenants.hono.ts`: the
 * caller is platform-admin (no tenant context), and the gateway's DB role
 * reads across tenants. The per-tenant FORCE-RLS policy on
 * `activation_events` remains the defence for ordinary tenant sessions
 * (where `app.current_tenant_id` is bound); it is not double-applied here.
 *
 * Why no fabricated data: every number is computed from real milestone
 * events written by `recordActivationEvent` at signup / licence-create /
 * first-sale / first-royalty / onboarding-complete.
 *
 * Per CLAUDE.md: parameterised SQL only (no interpolation), zod-validated
 * query, immutability, no `console.log` (Pino via createLogger), never a
 * hard-coded currency (there are no money columns here).
 *
 * Mounted at `/api/v1/mining/internal/analytics`.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { createLogger } from '../../../utils/logger';

const moduleLogger = createLogger('admin-analytics');

/**
 * Ordered funnel milestones. The order is the funnel — each later step is
 * a strict subset of tenants that also (eventually) reached it. Labels are
 * EN (the admin console is English-only HQ tooling).
 */
const FUNNEL_STEPS: ReadonlyArray<{
  readonly eventType: string;
  readonly label: string;
}> = [
  { eventType: 'signup_completed', label: 'Signed up' },
  { eventType: 'onboarding_completed', label: 'Onboarding complete' },
  { eventType: 'licence_created', label: 'First licence created' },
  { eventType: 'first_sale_recorded', label: 'First sale recorded' },
  { eventType: 'first_royalty_paid', label: 'First royalty filed' },
];

const FunnelQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(90),
});

interface DbLike {
  readonly execute: (q: unknown) => Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Record<string, unknown>[];
  }
  return [];
}

export function createMiningInternalAnalyticsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  // ── GET /funnel — distinct tenants per ordered milestone ──────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get('/funnel', async (c: any) => {
    const db = c.get('db') as DbLike | null;
    if (!db) return unavailable(c);

    const parsed = FunnelQuerySchema.safeParse({ days: c.req.query('days') });
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: { code: 'BAD_REQUEST', message: parsed.error.message },
        },
        400,
      );
    }
    const { days } = parsed.data;

    try {
      // One grouped scan: distinct tenants per event_type within the window.
      const rows = rowsOf(
        await db.execute(sql`
          SELECT event_type,
                 count(DISTINCT tenant_id)::int AS tenants
            FROM activation_events
           WHERE occurred_at >= now() - (${days}::int * interval '1 day')
           GROUP BY event_type
        `),
      );
      const countByType = new Map<string, number>();
      for (const r of rows) {
        countByType.set(String(r.event_type ?? ''), Number(r.tenants ?? 0));
      }

      const steps = FUNNEL_STEPS.map((step) => ({
        eventType: step.eventType,
        label: step.label,
        count: countByType.get(step.eventType) ?? 0,
      }));

      return c.json(
        {
          success: true as const,
          data: { windowDays: days, steps },
          meta: { source: 'activation_events' as const },
        },
        200,
      );
    } catch (err) {
      return failure(c, err, 'funnel');
    }
  });

  // ── GET /cohorts — monthly signup cohorts + activation proxy ──────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.get('/cohorts', async (c: any) => {
    const db = c.get('db') as DbLike | null;
    if (!db) return unavailable(c);

    try {
      // Cohort = the month a tenant first signed up. "Activated" = the
      // tenant recorded ANY milestone strictly after its signup event.
      // Both derived purely from activation_events — no fabricated rows.
      const rows = rowsOf(
        await db.execute(sql`
          WITH signups AS (
            SELECT tenant_id,
                   min(occurred_at) AS signed_up_at
              FROM activation_events
             WHERE event_type = 'signup_completed'
             GROUP BY tenant_id
          ),
          activated AS (
            SELECT s.tenant_id
              FROM signups s
              JOIN activation_events e
                ON e.tenant_id = s.tenant_id
               AND e.occurred_at > s.signed_up_at
             GROUP BY s.tenant_id
          )
          SELECT to_char(date_trunc('month', s.signed_up_at), 'YYYY-MM') AS cohort,
                 count(*)::int                                           AS signed_up,
                 count(a.tenant_id)::int                                 AS activated
            FROM signups s
            LEFT JOIN activated a ON a.tenant_id = s.tenant_id
           GROUP BY date_trunc('month', s.signed_up_at)
           ORDER BY date_trunc('month', s.signed_up_at) DESC
           LIMIT 24
        `),
      );

      const cohorts = rows.map((r) => {
        const signedUp = Number(r.signed_up ?? 0);
        const activated = Number(r.activated ?? 0);
        return {
          cohort: String(r.cohort ?? ''),
          signedUp,
          activated,
          activationPct:
            signedUp > 0 ? Math.round((activated / signedUp) * 100) : 0,
        };
      });

      return c.json(
        {
          success: true as const,
          data: { cohorts },
          meta: { source: 'activation_events' as const },
        },
        200,
      );
    } catch (err) {
      return failure(c, err, 'cohorts');
    }
  });

  return app;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unavailable(c: any): Response {
  return c.json(
    {
      success: false as const,
      error: {
        code: 'ANALYTICS_UNAVAILABLE',
        message: 'database is not configured on this gateway',
      },
    },
    503,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function failure(c: any, err: unknown, scope: string): Response {
  const reason = err instanceof Error ? err.message : String(err);
  moduleLogger.error('analytics aggregate failed', {
    evt: 'admin_analytics_failed',
    scope,
    reason,
  });
  return c.json(
    {
      success: false as const,
      error: { code: 'ANALYTICS_FAILED', message: reason },
    },
    500,
  );
}

export const miningInternalAnalyticsRouter =
  createMiningInternalAnalyticsRouter();
export default miningInternalAnalyticsRouter;
