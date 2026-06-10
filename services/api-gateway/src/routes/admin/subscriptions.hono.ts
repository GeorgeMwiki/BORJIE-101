/**
 * /api/v1/admin/subscriptions — cross-tenant subscription / MRR overview.
 *
 * The admin-web Platform → Subscriptions page (`SubscriptionsClient`) calls
 * `GET /api/v1/admin/subscriptions` to render cross-tenant MRR, trialing, and
 * past-due counts.
 *
 * SOURCE OF TRUTH: the authoritative `tenant_subscriptions` table (the
 * platform's own SaaS revenue read-model, written by `PlatformBillingService
 * .subscribe()` which posts the matching balanced journal through
 * `LedgerService.post()`). Each tenant LEFT JOINs to its single ACTIVE
 * subscription (`cancelled_at IS NULL`); MRR, status, plan, currency, and
 * renewal come from THAT row — not from the `tenants.billing_settings` JSON the
 * earlier thin-aggregator read (which drifted from the table `subscribe()`
 * writes). Tenants without an active subscription project to MRR 0 with a
 * status derived from the tenant lifecycle (honest-degrade, never fabricated).
 *
 * UNITS: `tenant_subscriptions.mrr_minor_units` is BIGINT minor units; the
 * admin client renders with `formatCurrency` (MAJOR units), so we divide by 100
 * and carry the subscription's own ISO-4217 `currency` (additive field).
 *
 * CROSS-TENANT READ: `tenant_subscriptions` is FORCE-RLS tenant-scoped, but this
 * is an intentional platform-admin aggregate across ALL tenants — so the read
 * runs under `withServiceRoleContext` (the same bypass pattern as
 * `me-tenants` / the internal admin surfaces). The tx-local GUC is discarded at
 * COMMIT. Authorization is by role (SUPER_ADMIN / ADMIN), not per-tenant RLS.
 *
 * The admin client (`apps/admin-web/src/lib/api.ts`) unwraps `parsed.data`, so
 * the success body is `{ data: Subscription[] }` (the array IS the data).
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { withServiceRoleContext } from '@borjie/database';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('admin-subscriptions');

/** The transaction-capable client `withServiceRoleContext` expects. */
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

interface SubscriptionDto {
  readonly id: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly plan: string;
  readonly status: BillingStatus;
  readonly mrr: number;
  readonly currency: string;
  readonly billingCycle: 'monthly' | 'annual';
  readonly currentPeriodEnd: string;
  readonly createdAt: string;
}

/**
 * Map the AUTHORITATIVE subscription status (active|past_due|trialing|cancelled|
 * unpaid|unknown) onto the admin page's billing vocabulary. Returns `null` for
 * 'unknown'/absent so the caller falls back to the tenant lifecycle status.
 */
function mapSubStatus(subStatus: string | null): BillingStatus | null {
  switch (subStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'cancelled':
      return 'canceled';
    default:
      return null;
  }
}

/** Fallback: map the tenant lifecycle status when there is no subscription row. */
function mapTenantStatus(tenantStatus: unknown): BillingStatus {
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

/** Parse a BIGINT-or-string-or-number into a finite number, else null. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0 && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return new Date(0).toISOString();
}

export function projectSubscription(row: Record<string, unknown>): SubscriptionDto {
  const subStatus =
    typeof row.sub_status === 'string' ? row.sub_status : null;
  const status = mapSubStatus(subStatus) ?? mapTenantStatus(row.status);

  // Authoritative MRR is BIGINT minor units; the client formats MAJOR units.
  const mrrMinor = toNumber(row.sub_mrr_minor_units);
  const mrr = mrrMinor !== null ? Math.round(mrrMinor) / 100 : 0;

  const currency =
    typeof row.sub_currency === 'string' && row.sub_currency.length === 3
      ? row.sub_currency
      : 'USD';

  const plan =
    firstString(row.sub_plan, row.plan, row.subscription_tier) ?? 'starter';

  return {
    id: String(row.id),
    tenantId: String(row.id),
    tenantName: firstString(row.name, row.legal_name) ?? '',
    plan,
    status,
    mrr,
    currency,
    billingCycle: 'monthly',
    currentPeriodEnd: toIso(row.sub_renewal_at ?? row.trial_ends_at ?? row.created_at),
    createdAt: toIso(row.created_at),
  };
}

export function createAdminSubscriptionsRouter(): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);
  app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  app.use('*', databaseMiddleware);

  app.get('/', async (c) => {
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
      // Cross-tenant aggregate: read every tenant's ACTIVE subscription under
      // the service-role bypass (the table is FORCE-RLS; this admin surface is
      // role-gated cross-tenant). tx-local GUC discarded at COMMIT.
      const rows = (await withServiceRoleContext(
        db as unknown as ServiceRoleDb,
        (sdb) =>
          sdb.execute(sql`
            SELECT
              t.*,
              s.plan            AS sub_plan,
              s.status          AS sub_status,
              s.mrr_minor_units AS sub_mrr_minor_units,
              s.currency        AS sub_currency,
              s.renewal_at      AS sub_renewal_at
            FROM tenants t
            LEFT JOIN tenant_subscriptions s
              ON s.tenant_id = t.id::text
              AND s.cancelled_at IS NULL
            ORDER BY t.created_at DESC
            LIMIT 500
          `),
      )) as unknown as Array<Record<string, unknown>>;

      const data = rows.map(projectSubscription);
      return c.json(
        {
          data,
          note: 'MRR from tenant_subscriptions (authoritative); 0 where no active subscription',
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
