/**
 * /api/v1/platform/overview — HQ-tier KPI aggregator.
 *
 * Returns a small bag of cross-tenant counts for the Borjie HQ
 * `/platform/overview` page. Auth is platform-tier (the same scoping
 * convention used by `platform-hq` Jarvis): an authenticated request
 * whose role is one of the platform-admin trio (SUPER_ADMIN, ADMIN,
 * SUPPORT). Tenant-scoped roles are rejected with 403.
 *
 * Each individual count is wrapped in its own try/catch so a single
 * failed query does not poison the whole response. If ANY count fails
 * we still return 200, but with `success: false` + `error.code =
 * 'PARTIAL'` so the frontend's em-dash fallback kicks in cleanly
 * instead of rendering "0" as truth.
 */

import { Hono } from 'hono';
import { and, count, eq, gte, sum, isNull } from 'drizzle-orm';
import {
  tenants,
  users,
  units,
  payments,
  createCurrencyRatesService,
  createCurrencyPreferencesService,
} from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { getDb } from '../composition/db-client';
import { isPlatformAdmin, type UserRole } from '../types/user-role';

// any — Drizzle's select-builder generic chain widens through union
// generics in a way that adds no runtime safety. Rows are narrowed via
// the `.select({…})` projection below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleDb = any;

// ─────────────────────────────────────────────────────────────────────
// Per-query helpers. Each returns `null` on failure so the caller can
// decide whether to short-circuit or degrade gracefully.
// ─────────────────────────────────────────────────────────────────────

async function countActiveTenants(db: DrizzleDb): Promise<number | null> {
  try {
    const rows = await db
      .select({ value: count() })
      .from(tenants)
      .where(and(eq(tenants.status, 'active'), isNull(tenants.deletedAt)));
    return Number(rows[0]?.value ?? 0);
  } catch {
    return null;
  }
}

async function countPlatformUsers(db: DrizzleDb): Promise<number | null> {
  try {
    // Cross-tenant count — HQ tier sees every user. Filter out
    // soft-deleted rows so the number tracks "live" identities.
    const rows = await db
      .select({ value: count() })
      .from(users)
      .where(isNull(users.deletedAt));
    return Number(rows[0]?.value ?? 0);
  } catch {
    return null;
  }
}

async function countUnitsManaged(db: DrizzleDb): Promise<number | null> {
  try {
    const rows = await db
      .select({ value: count() })
      .from(units)
      .where(isNull(units.deletedAt));
    return Number(rows[0]?.value ?? 0);
  } catch {
    return null;
  }
}

/**
 * Cross-tenant monthly revenue, normalised to the caller's preferred
 * currency (resolved by `currency_preferences`: user → tenant →
 * platform-default seed). Built for the world; starts with TZ.
 *
 * The `payments` table stores `amount` in MINOR units with a per-row
 * `currency` (TZS / KES / USD / any ISO-4217). We GROUP BY currency
 * over the last 30 days where status = 'completed' (post-success
 * terminal state in the payment_status enum), then hand the per-
 * currency slices to `normaliseTo(targetCurrency, slices)` which
 * bridges through USD using the in-DB FX rate snapshot.
 *
 * Returns null on hard DB failure so the caller's PARTIAL branch
 * kicks in. Returns a number (≥ 0, rounded to 2 decimal places) on
 * success.
 */
async function sumMonthlyRevenue(
  db: DrizzleDb,
  targetCurrency: string,
): Promise<number | null> {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = (await db
      .select({
        currency: payments.currency,
        amountMinor: sum(payments.amount),
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, 'completed'),
          gte(payments.completedAt, since),
        ),
      )
      .groupBy(payments.currency)) as ReadonlyArray<{
      currency: string | null;
      amountMinor: string | number | null;
    }>;

    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const slices = rows
      .filter((r): r is { currency: string; amountMinor: string | number } => {
        return (
          typeof r?.currency === 'string' &&
          r.currency.length > 0 &&
          r.amountMinor !== null &&
          r.amountMinor !== undefined
        );
      })
      .map((r) => ({
        currency: r.currency,
        amountMinor: Number(r.amountMinor),
      }))
      .filter((s) => Number.isFinite(s.amountMinor));

    if (slices.length === 0) return 0;

    const ratesService = createCurrencyRatesService(db);
    const total = await ratesService.normaliseTo(targetCurrency, slices);

    if (!Number.isFinite(total) || total < 0) return 0;
    return Math.round(total * 100) / 100;
  } catch (error) {
    console.error('platform-overview: monthly-revenue aggregation failed:', error);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

const platformOverviewRouter = new Hono();
platformOverviewRouter.use('*', authMiddleware);

platformOverviewRouter.get('/', async (c) => {
  const auth = c.get('auth') ?? {};
  const role = auth.role as UserRole | undefined;
  if (!role || !isPlatformAdmin(role)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message:
            'platform-overview requires a platform-tier role (SUPER_ADMIN / ADMIN / SUPPORT)',
        },
      },
      403,
    );
  }

  const db = getDb();
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PARTIAL',
          message: 'database not configured (DATABASE_URL unset)',
        },
      },
      200,
    );
  }

  // Resolve the caller's preferred currency BEFORE the revenue
  // aggregation so we report numbers in the operator's chosen unit.
  // Resolution chain: user override → tenant default → platform-default
  // (seeded as USD by migration 0119). Operators rotate the platform
  // default via the admin UI / refresh-fx-rates CLI.
<<<<<<< Updated upstream
  const userId =
    typeof auth.userId === 'string'
      ? auth.userId
      : null;
=======
  const userId = typeof auth.userId === 'string' ? auth.userId : null;
>>>>>>> Stashed changes
  const tenantId = typeof auth.tenantId === 'string' ? auth.tenantId : null;
  const preferences = createCurrencyPreferencesService(db);
  const resolved = await preferences.resolve({ userId, tenantId });
  const targetCurrency = resolved.currency;

  const [activeTenants, platformUsers, unitsManaged, monthlyRevenue] =
    await Promise.all([
      countActiveTenants(db),
      countPlatformUsers(db),
      countUnitsManaged(db),
      sumMonthlyRevenue(db, targetCurrency),
    ]);

  const anyFailed =
    activeTenants === null ||
    platformUsers === null ||
    unitsManaged === null ||
    monthlyRevenue === null;

  if (anyFailed) {
    return c.json(
      {
        success: false,
        error: {
          code: 'PARTIAL',
          message:
            'one or more aggregate queries failed; frontend should render the em-dash fallback',
        },
      },
      200,
    );
  }

  return c.json({
    success: true,
    data: {
      activeTenants,
      platformUsers,
      monthlyRevenue,
      unitsManaged,
      // monthlyRevenue is FX-normalised to the caller's preferred
      // currency (migration 0119) via the currency_rates snapshot
      // (migration 0117); USD is the bridge unit so any → any works.
      currency: targetCurrency,
      currencySource: resolved.source,
    },
  });
});

export default platformOverviewRouter;
