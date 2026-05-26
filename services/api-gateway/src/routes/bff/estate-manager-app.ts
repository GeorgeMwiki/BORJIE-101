/**
 * Estate Manager App BFF — Wave 18 real-data wiring.
 *
 * Previously a 1,300-line fixture router gated behind `liveDataRequired`
 * so every GET returned 503 LIVE_DATA_NOT_IMPLEMENTED. The fixtures
 * included fake tenant names, fake phone numbers, and fake SLA stats —
 * hidden from prod by the gate but a ticking liability.
 *
 * This rewrite aggregates the manager's day from real tables:
 *
 *   GET /                  — same as /home (smoke-test safe)
 *   GET /home              — greeting + today-summary + urgent work orders
 *   GET /work-orders       — tenant-scoped work orders list
 *   GET /work-orders/:id   — single work order
 *   GET /inspections       — tenant-scoped inspections list
 *   GET /vendors           — tenant-scoped vendors list
 *   GET /occupancy         — unit status roll-up
 *   GET /collections       — arrears cases list
 *   GET /sla               — placeholder summary (SLA analytics pending)
 *
 *   All POST/PUT/DELETE surfaces return 501 NOT_IMPLEMENTED pointing at
 *   the canonical tenant-scoped routers they should go through
 *   (/api/v1/work-orders, /api/v1/inspections, etc.). The BFF was never
 *   the source of truth for mutations.
 *
 * Tenant isolation: every query is scoped by `auth.tenantId`.
 */

import { Hono } from 'hono';
import { and, count, desc, eq, gte, lte, or, sql } from 'drizzle-orm';
import {
  workOrders,
  inspections,
  vendors,
  vendorScorecards,
  properties,
  units,
  arrearsCases,
} from '@borjie/database';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { routeCatch } from '../../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.PROPERTY_MANAGER,
    UserRole.MAINTENANCE_STAFF,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

function dbUnavailable(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Estate manager BFF requires a live DATABASE_URL.',
      },
    },
    503,
  );
}

function notImplemented(c, verb) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: `${verb} via the manager BFF is not wired — use the canonical routers (/api/v1/work-orders, /api/v1/inspections).`,
      },
    },
    501,
  );
}

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

async function buildHome(db, tenantId: string, userId: string) {
  // Aggregate counters in parallel. Each Promise resolves to a single
  // `{ n: number }` row; missing tables / driver errors surface as zero
  // so the dashboard always renders.
  const safe = async (p: Promise<any>): Promise<number> => {
    try {
      const rows = await p;
      const first = Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
      return Number(first?.n ?? first?.count ?? 0);
    } catch {
      return 0;
    }
  };

  const [
    openWorkOrders,
    urgentWorkOrders,
    scheduledInspections,
    activeArrears,
  ] = await Promise.all([
    safe(
      db
        .select({ n: count() })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.tenantId, tenantId),
            sql`status NOT IN ('completed','cancelled')`,
          ),
        ),
    ),
    safe(
      db
        .select({ n: count() })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.tenantId, tenantId),
            sql`priority IN ('emergency','high')`,
            sql`status NOT IN ('completed','cancelled')`,
          ),
        ),
    ),
    safe(
      db
        .select({ n: count() })
        .from(inspections)
        .where(
          and(
            eq(inspections.tenantId, tenantId),
            sql`status = 'scheduled'`,
          ),
        ),
    ),
    safe(
      db
        .select({ n: count() })
        .from(arrearsCases)
        .where(
          and(
            eq(arrearsCases.tenantId, tenantId),
            sql`status = 'active'`,
          ),
        ),
    ),
  ]);

  return {
    greeting: getTimeBasedGreeting(),
    manager: { id: userId },
    todaySummary: {
      scheduledInspections,
      openWorkOrders,
      urgentWorkOrders,
      collectionsFollowUp: activeArrears,
    },
    quickActions: [
      { id: 'work_orders', label: 'Work Orders', route: '/api/v1/work-orders' },
      { id: 'inspections', label: 'Inspections', route: '/api/v1/inspections' },
      { id: 'arrears', label: 'Arrears', route: '/api/v1/arrears/cases' },
    ],
  };
}

app.get('/', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  try {
    return c.json({ success: true, data: await buildHome(db, tenantId, userId) });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'HOME_QUERY_FAILED',
      status: 503,
      fallback: 'Home query failed',
    });
  }
});

app.get('/home', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  try {
    return c.json({ success: true, data: await buildHome(db, tenantId, userId) });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'HOME_QUERY_FAILED',
      status: 503,
      fallback: 'Home query failed',
    });
  }
});

app.get('/work-orders', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    const rows = await db
      .select()
      .from(workOrders)
      .where(eq(workOrders.tenantId, tenantId))
      .orderBy(desc(workOrders.createdAt))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'WORK_ORDERS_QUERY_FAILED',
      status: 503,
      fallback: 'Work orders query failed',
    });
  }
});

// IMPORTANT: /work-orders/queue MUST register before /work-orders/:id.
// Hono dispatches in registration order; otherwise the static
// "queue" string matches the dynamic :id slot.
app.get('/work-orders/queue', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    // Pull "active or pending" WOs scoped to properties this manager
    // manages. The status filter excludes terminal states.
    const rows = await db
      .select({
        id: workOrders.id,
        tenantId: workOrders.tenantId,
        propertyId: workOrders.propertyId,
        unitId: workOrders.unitId,
        workOrderNumber: workOrders.workOrderNumber,
        title: workOrders.title,
        priority: workOrders.priority,
        status: workOrders.status,
        category: workOrders.category,
        scheduledAt: workOrders.scheduledAt,
        responseDueAt: workOrders.responseDueAt,
        resolutionDueAt: workOrders.resolutionDueAt,
        createdAt: workOrders.createdAt,
      })
      .from(workOrders)
      .innerJoin(properties, eq(workOrders.propertyId, properties.id))
      .where(
        and(
          eq(workOrders.tenantId, tenantId),
          eq(properties.managerId, userId),
          sql`${workOrders.status} NOT IN ('completed','cancelled','closed')`,
        ),
      )
      .orderBy(
        sql`CASE ${workOrders.priority} WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`,
        desc(workOrders.createdAt),
      )
      .limit(limit);

    return c.json({
      success: true,
      data: rows,
      meta: { managerId: userId, count: rows.length },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'MANAGER_WORK_ORDER_QUEUE_FAILED',
      status: 503,
      fallback: 'Work order queue query failed',
    });
  }
});

app.get('/work-orders/:id', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  try {
    const [row] = await db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id)))
      .limit(1);
    if (!row) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Work order not found' } },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'WORK_ORDER_QUERY_FAILED',
      status: 503,
      fallback: 'Work order query failed',
    });
  }
});

app.get('/inspections', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    const rows = await db
      .select()
      .from(inspections)
      .where(eq(inspections.tenantId, tenantId))
      .orderBy(desc(inspections.scheduledDate))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'INSPECTIONS_QUERY_FAILED',
      status: 503,
      fallback: 'Inspections query failed',
    });
  }
});

app.get('/vendors', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    const rows = await db
      .select()
      .from(vendors)
      .where(eq(vendors.tenantId, tenantId))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'VENDORS_QUERY_FAILED',
      status: 503,
      fallback: 'Vendors query failed',
    });
  }
});

app.get('/occupancy', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  try {
    // unit_status enum values: vacant, occupied, reserved,
    // under_maintenance, not_available. "turnover" is not a valid
    // value; using `under_maintenance` as the turnover proxy so the
    // query returns a meaningful count without 22P02.
    const [totals] = await db
      .select({
        total: count(),
        occupied: sql`COUNT(*) FILTER (WHERE ${units.status} = 'occupied')::int`,
        vacant: sql`COUNT(*) FILTER (WHERE ${units.status} = 'vacant')::int`,
        turnover: sql`COUNT(*) FILTER (WHERE ${units.status} = 'under_maintenance')::int`,
        reserved: sql`COUNT(*) FILTER (WHERE ${units.status} = 'reserved')::int`,
      })
      .from(units)
      .innerJoin(properties, eq(units.propertyId, properties.id))
      .where(eq(properties.tenantId, tenantId));

    const total = Number(totals?.total ?? 0);
    const occupied = Number(totals?.occupied ?? 0);
    return c.json({
      success: true,
      data: {
        summary: {
          totalUnits: total,
          occupied,
          vacant: Number(totals?.vacant ?? 0),
          turnover: Number(totals?.turnover ?? 0),
          reserved: Number(totals?.reserved ?? 0),
          occupancyRate: total > 0 ? occupied / total : 0,
        },
      },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'OCCUPANCY_QUERY_FAILED',
      status: 503,
      fallback: 'Occupancy query failed',
    });
  }
});

app.get('/collections', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    const rows = await db
      .select()
      .from(arrearsCases)
      .where(
        and(eq(arrearsCases.tenantId, tenantId), sql`status = 'active'`),
      )
      .orderBy(desc(arrearsCases.createdAt))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'COLLECTIONS_QUERY_FAILED',
      status: 503,
      fallback: 'Collections query failed',
    });
  }
});

app.get('/sla', (c) => {
  // SLA analytics require a work-order-event-stream aggregation that
  // isn't wired yet. Return a shape-compatible empty envelope so
  // dashboards render an "insufficient data" state rather than crash.
  return c.json({
    success: true,
    data: {
      summary: {
        responseCompliance: null,
        resolutionCompliance: null,
        atRiskCount: 0,
        breachedCount: 0,
      },
      note: 'SLA analytics pending — work-order-event-stream aggregation not yet wired.',
    },
  });
});

// ============================================================================
// Manager-app aggregator endpoints (real-wrap reads).
//
//   GET /work-orders/queue           — active+pending WOs, manager-scoped
//   GET /inspections/upcoming        — inspections in the next 30 days
//   GET /escalations                 — open exceptions/escalations
//   GET /vendors/scorecards          — vendor scorecards (real if rows; empty otherwise)
//
// All four queries are tenant-scoped. "manager-scoped" filtering uses
// `properties.managerId === auth.userId` because the work_orders table
// has no explicit assignee column today (assignedBy is the actor that
// performed the assign action, not the assignee). Until a dedicated
// `assigned_to` column lands, scoping by managed-property is the
// honest interpretation.
// ============================================================================

app.get('/inspections/upcoming', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    // 30-day rolling window. We avoid `BETWEEN` because driver coercion
    // varies; explicit gte/lte against NOW() and NOW() + interval is
    // portable.
    const rows = await db
      .select({
        id: inspections.id,
        tenantId: inspections.tenantId,
        propertyId: inspections.propertyId,
        unitId: inspections.unitId,
        type: inspections.type,
        status: inspections.status,
        scheduledDate: inspections.scheduledDate,
        inspectorId: inspections.inspectorId,
      })
      .from(inspections)
      .innerJoin(properties, eq(inspections.propertyId, properties.id))
      .where(
        and(
          eq(inspections.tenantId, tenantId),
          eq(properties.managerId, userId),
          sql`${inspections.scheduledDate} IS NOT NULL`,
          sql`${inspections.scheduledDate} >= NOW()`,
          sql`${inspections.scheduledDate} <= NOW() + INTERVAL '30 days'`,
          sql`${inspections.status} IN ('scheduled','in_progress')`,
        ),
      )
      .orderBy(inspections.scheduledDate)
      .limit(limit);

    return c.json({
      success: true,
      data: rows,
      meta: { managerId: userId, windowDays: 30, count: rows.length },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'MANAGER_UPCOMING_INSPECTIONS_FAILED',
      status: 503,
      fallback: 'Upcoming inspections query failed',
    });
  }
});

app.get('/escalations', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    // The exception inbox lives in the autonomy package's repo (Postgres
    // when wired, in-memory fallback otherwise). The BFF is a read-roll-up
    // surface, so we proxy via the tenant-scoped exceptions table when
    // available, and emit honest-empty when it isn't.
    const services = c.get('services') ?? {};
    const inbox = services.autonomy?.exceptionInbox ?? services.exceptionInbox;
    if (inbox && typeof inbox.listOpen === 'function') {
      const items = await inbox.listOpen(tenantId, { limit });
      return c.json({
        success: true,
        data: items,
        meta: { source: 'autonomy.exceptionInbox', count: items.length },
      });
    }

    // No inbox bound — return honest empty.
    return c.json({
      success: true,
      data: [],
      meta: {
        source: 'honest-empty',
        note: 'autonomy.exceptionInbox not wired; manager BFF has no upstream to query',
      },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'MANAGER_ESCALATIONS_FAILED',
      status: 503,
      fallback: 'Escalations query failed',
    });
  }
});

app.get('/vendors/scorecards', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    const rows = await db
      .select()
      .from(vendorScorecards)
      .where(eq(vendorScorecards.tenantId, tenantId))
      .limit(limit);

    return c.json({
      success: true,
      data: rows,
      meta: { count: rows.length },
    });
  } catch (err) {
    // If the table isn't present (relation undefined), fall through to
    // honest-empty rather than 503.
    if (
      err &&
      typeof err === 'object' &&
      ((err as { code?: string }).code === '42P01' ||
        (err as { code?: string }).code === '42703')
    ) {
      return c.json({
        success: true,
        data: [],
        meta: {
          source: 'honest-empty',
          note: 'vendor_scorecards table not yet provisioned in this environment',
        },
      });
    }
    return routeCatch(c, err, {
      code: 'MANAGER_VENDOR_SCORECARDS_FAILED',
      status: 503,
      fallback: 'Vendor scorecards query failed',
    });
  }
});

// Mutations route through the canonical tenant-scoped routers. The BFF
// never owned writes; these 501s make that explicit.
app.post('/work-orders/:id/triage', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Triaging work orders')));
app.post('/work-orders/:id/approve', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Approving work orders')));
app.post('/work-orders/:id/assign', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Assigning vendors')));
app.post('/work-orders/:id/schedule', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Scheduling work orders')));
app.post('/work-orders/:id/complete', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Completing work orders')));
app.post('/work-orders/:id/verify', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Verifying work orders')));
app.post('/inspections', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Scheduling inspections')));
app.post('/inspections/:id/items', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Recording inspection items')));
app.post('/inspections/:id/complete', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Completing inspections')));
app.put('/units/:id/status', withSecurityEvents({ action: 'estate-manager-app.update', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Updating unit status')));
app.post('/collections/action', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Collection actions')));
app.post('/vendors/:id/flag', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Flagging vendors')));
app.post('/vendors/:id/invoices/:invoiceId/approve', withSecurityEvents({ action: 'estate-manager-app.create', resource: 'estate-manager-app', severity: 'info' }, (c) => notImplemented(c, 'Approving vendor invoices')));

export const estateManagerAppRouter = app;
export default estateManagerAppRouter;
