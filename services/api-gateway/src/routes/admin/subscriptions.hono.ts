/**
 * /api/v1/admin/subscriptions — cross-tenant subscription / MRR overview.
 *
 * Closes finding `admin-rest-3`. The admin-web Platform → Subscriptions page
 * (`SubscriptionsClient`) calls `GET /api/v1/admin/subscriptions` to render
 * cross-tenant MRR, trialing, and past-due counts. No such route existed, so
 * the page looped on a 404 and every stat tile read zero.
 *
 * There is no dedicated `subscriptions` / `mrr` billing table in the schema,
 * so this is a THIN AGGREGATOR over the `tenants` index (the same source the
 * `/internal/tenants` admin surface already uses). Each tenant row projects to
 * the `Subscription` shape the admin client consumes:
 *   { id, tenantId, tenantName, plan, status, mrr, billingCycle,
 *     currentPeriodEnd, createdAt }
 *
 * HONEST-DEGRADE: when no MRR is recorded on a tenant (`billing_settings.mrr`
 * absent) the figure is 0 — never a fabricated number. When the DB is
 * unavailable the route returns a structured, well-formed empty envelope with a
 * `note` rather than a raw error, so the page renders an empty state, not a
 * crash.
 *
 * AUTH: platform-admin only — `authMiddleware` + `requireRole(SUPER_ADMIN,
 * ADMIN)`, matching the sibling `/mining/internal/tenants` cross-tenant surface.
 * These rows ARE the tenant index, so the read is intentionally cross-tenant
 * (gated by role, not per-tenant RLS).
 *
 * The admin client (`apps/admin-web/src/lib/api.ts`) unwraps `parsed.data`, so
 * the success body is `{ data: Subscription[] }` (the array IS the data).
 */

import { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import { tenants } from '@borjie/database';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('admin-subscriptions');

interface SubscriptionDto {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly plan: string;
  readonly status: 'active' | 'trialing' | 'past_due' | 'canceled';
  readonly mrr: number;
  readonly billingCycle: 'monthly' | 'annual';
  readonly currentPeriodEnd: string;
  readonly createdAt: string;
}

// Map the tenant lifecycle status onto the billing-status vocabulary the
// admin Subscriptions page filters + tallies on.
function mapStatus(
  tenantStatus: unknown,
): 'active' | 'trialing' | 'past_due' | 'canceled' {
  switch (tenantStatus) {
    case 'active':
      return 'active';
    case 'trial':
    case 'pending':
      return 'trialing';
    case 'suspended':
      return 'past_due';
    case 'cancelled':
      return 'canceled';
    default:
      return 'trialing';
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function projectSubscription(row: any): SubscriptionDto {
  const billing = (row.billingSettings ?? {}) as Record<string, unknown>;
  const mrrRaw = billing.mrr;
  const mrr =
    typeof mrrRaw === 'number' && Number.isFinite(mrrRaw)
      ? mrrRaw
      : typeof mrrRaw === 'string' && Number.isFinite(Number(mrrRaw))
        ? Number(mrrRaw)
        : 0;
  const billingCycle: 'monthly' | 'annual' =
    billing.billingCycle === 'annual' ? 'annual' : 'monthly';
  // currentPeriodEnd: trialEndsAt when present (trialing), else createdAt as a
  // stable fallback so the FE never renders an Invalid Date.
  const currentPeriodEnd = toIso(row.trialEndsAt ?? row.createdAt);
  return {
    id: row.id,
    tenantId: row.id,
    tenantName: typeof row.name === 'string' ? row.name : '',
    plan:
      typeof row.plan === 'string'
        ? row.plan
        : typeof row.subscriptionTier === 'string'
          ? row.subscriptionTier
          : 'starter',
    status: mapStatus(row.status),
    mrr,
    billingCycle,
    currentPeriodEnd,
    createdAt: toIso(row.createdAt),
  };
}

export function createAdminSubscriptionsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  app.get('/', async (c: any) => {
    const db = c.get('db');
    if (!db) {
      // Honest-degrade — well-formed empty envelope with a note.
      return c.json(
        {
          data: [] as ReadonlyArray<SubscriptionDto>,
          note: 'database not configured on this gateway',
        },
        200,
      );
    }

    try {
      const rows = await db
        .select()
        .from(tenants)
        .orderBy(desc(tenants.createdAt))
        .limit(500);
      const data = rows.map((r: any) => projectSubscription(r));
      // No billing/MRR table exists yet — surface a note so the operator knows
      // MRR is derived from tenants.billing_settings, not a billing ledger.
      return c.json(
        {
          data,
          note: 'MRR derived from tenants.billing_settings; no dedicated billing table yet',
        },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'list failed';
      moduleLogger.error('admin subscriptions list failed', {
        evt: 'admin_subscriptions_list_failed',
        reason: message,
      });
      // No raw error.message leak to the client.
      return c.json(
        {
          success: false as const,
          error: {
            code: 'SUBSCRIPTIONS_LIST_FAILED',
            message: 'Failed to load subscriptions',
          },
        },
        500,
      );
    }
  });

  return app;
}

export const adminSubscriptionsRouter = createAdminSubscriptionsRouter();
