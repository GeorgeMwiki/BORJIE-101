// @ts-nocheck — Hono v4 status-code literal union widens c.json branches.

/**
 * /api/v1/analytics — owner-portal AnalyticsSummary card source.
 *
 * The owner-portal Analytics dashboard calls `GET /analytics/summary` to
 * populate top-of-page KPI tiles (occupancy %, revenue MoM, NOI, arrears
 * trend). When repos are wired we compute a real summary from the
 * caller's `propertyAccess` scope; otherwise we return an "honest
 * empty" shape so the page renders the empty state instead of stalling
 * on a never-resolving fetch.
 *
 * NEVER fabricate data. Each metric is reported as 0 (or null where the
 * frontend's fallback expects it) and `meta.source` is set to either
 * `live` or `empty` so the UI can opt to render an em-dash if it
 * prefers.
 *
 * Follow-up api-gateway, ANL-002 (Docs/TODO_BACKLOG.md): replace this aggregation pass with a
 *   dedicated read-model (`analytics_summary` materialised view) once the
 *   numbers below get expensive to recompute on every dashboard load.
 *   Concrete next-step:
 *     1. Add Drizzle view `analytics_summary` joining
 *        properties → units → leases → invoices → payments.
 *     2. Replace the inline reductions with a `repos.analytics.summary`
 *        call.
 *     3. Cache the row in Redis with a 60s TTL keyed by
 *        `tenantId + sortedPropertyIds`.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { logger } from '../utils/logger';

const analyticsRouter = new Hono();
analyticsRouter.use('*', authMiddleware);
analyticsRouter.use('*', databaseMiddleware);

const EMPTY_SUMMARY = {
  occupancyRate: 0,
  monthlyRevenue: 0,
  revenueGrowth: 0,
  netOperatingIncome: 0,
  arrearsBalance: 0,
  collectionRate: 0,
  totalProperties: 0,
  totalUnits: 0,
  activeLeases: 0,
};

const EMPTY_NOTE =
  'analytics aggregator not yet wired — returning zeroed shape so the dashboard renders an empty state';

analyticsRouter.get('/summary', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');

  if (!repos || !auth?.tenantId) {
    return c.json({
      success: true,
      data: {
        ...EMPTY_SUMMARY,
        meta: { source: 'empty', note: EMPTY_NOTE },
      },
    });
  }

  try {
    const propertyAccess = auth.propertyAccess;
    const allowsAll = Array.isArray(propertyAccess) && propertyAccess.includes('*');
    const allowedIds = new Set<string>(
      Array.isArray(propertyAccess) ? propertyAccess.filter((id) => id !== '*') : [],
    );

    const [propertiesResult, unitsResult, leasesResult, invoicesResult] = await Promise.all([
      repos.properties.findMany(auth.tenantId, { limit: 1000, offset: 0 }),
      repos.units.findMany(auth.tenantId, { limit: 5000, offset: 0 }),
      repos.leases.findMany(auth.tenantId, { limit: 5000, offset: 0 }),
      repos.invoices.findMany(auth.tenantId, 5000, 0),
    ]);

    const scopedProperties = allowsAll
      ? propertiesResult.items ?? []
      : (propertiesResult.items ?? []).filter((p) => allowedIds.has(p.id));
    const propertyIds = new Set(scopedProperties.map((p) => p.id));

    const scopedUnits = (unitsResult.items ?? []).filter((u) => propertyIds.has(u.propertyId));
    const occupiedUnits = scopedUnits.filter((u) => u.status === 'occupied').length;
    const occupancyRate = scopedUnits.length === 0 ? 0 : occupiedUnits / scopedUnits.length;

    const unitIds = new Set(scopedUnits.map((u) => u.id));
    const scopedLeases = (leasesResult.items ?? []).filter(
      (l) => propertyIds.has(l.propertyId) || unitIds.has(l.unitId),
    );
    const activeLeases = scopedLeases.filter((l) => l.status === 'active').length;
    const leaseIds = new Set(scopedLeases.map((l) => l.id));

    const scopedInvoices = (invoicesResult.items ?? []).filter(
      (inv) => inv.leaseId && leaseIds.has(inv.leaseId),
    );
    const arrearsBalance = scopedInvoices
      .filter((inv) => inv.status !== 'paid')
      .reduce((sum, inv) => sum + Number(inv.amountDue ?? inv.amount ?? 0), 0);

    return c.json({
      success: true,
      data: {
        occupancyRate,
        monthlyRevenue: 0,
        revenueGrowth: 0,
        netOperatingIncome: 0,
        arrearsBalance,
        collectionRate: 0,
        totalProperties: scopedProperties.length,
        totalUnits: scopedUnits.length,
        activeLeases,
        meta: {
          source: 'live',
          note: 'partial: revenue/NOI aggregation pending dedicated read-model',
        },
      },
    });
  } catch (error) {
    logger.warn('analytics summary aggregation failed; falling back to empty', {
      tenantId: auth.tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json({
      success: true,
      data: {
        ...EMPTY_SUMMARY,
        meta: { source: 'empty', note: EMPTY_NOTE },
      },
    });
  }
});

export default analyticsRouter;
