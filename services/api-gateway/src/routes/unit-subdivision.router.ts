/**
 * Unit Subdivision Router — estate-manager-app dependency.
 *
 *   GET  /api/v1/units/:id/subdivision  — list subdivision children
 *   POST /api/v1/units/:id/subdivision  — create a subdivision (501 — needs four-eye approval + schema)
 *
 * The current `units` schema (packages/database/src/schemas/property.schema.ts)
 * has no `parent_unit_id` / `subdivision` columns, so the GET handler
 * returns an honest empty list with a meta note explaining why. Once the
 * column lands the dynamic-import probe below will start returning real
 * children without code changes here.
 *
 * The POST handler returns 501 NOT_IMPLEMENTED because subdivisions are
 * a high-stakes write (one rentable unit becomes two; rent ledger,
 * occupancy, lease snapshots all need restating). We require four-eye
 * approval through the approvals workflow before that write path opens.
 *
 * Mounted at `/api/v1/units/:id/subdivision`. Hono dispatches the path
 * params correctly when the router is mounted via `app.route()` because
 * Hono normalises trailing slashes and parses :id at the parent level.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { units } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

function dbUnavailable(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Unit subdivision read requires a live DATABASE_URL.',
      },
    },
    503,
  );
}

/**
 * Probe the units table at runtime to see if a `parent_unit_id` column
 * exists. Drizzle ORM exposes columns as object keys on the table; we
 * never have to issue a schema-introspection SQL call. When the column
 * exists we return real children; otherwise we return an honest-empty
 * envelope with a meta note so dashboards render the empty state.
 */
function hasParentUnitIdColumn(): boolean {
  try {
    return Boolean(
      (units as unknown as Record<string, unknown>).parentUnitId ??
        // Drizzle preserves both camel + snake on the table object in
        // some emit modes; check both.
        (units as unknown as Record<string, unknown>).parent_unit_id,
    );
  } catch {
    return false;
  }
}

app.get('/', async (c) => {
  const services = c.get('services') as any ?? {};
  const db = services.db as any;
  const tenantId = c.get('tenantId');
  const parentId = c.req.param('id');

  if (!hasParentUnitIdColumn()) {
    return c.json({
      success: true,
      data: [],
      meta: {
        note: 'unit-subdivision schema not yet wired (units.parent_unit_id absent)',
        parentId,
      },
    });
  }

  if (!db) return dbUnavailable(c);

  try {
    const rows = await db
      .select()
      .from(units)
      .where(
        and(
          eq(units.tenantId, tenantId),
          eq((units as unknown as Record<string, unknown>).parentUnitId as never, parentId),
        ),
      )
      .limit(500);

    return c.json({
      success: true,
      data: rows,
      meta: { parentId, count: rows.length },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'UNIT_SUBDIVISION_QUERY_FAILED',
      status: 503,
      fallback: 'Subdivision query failed',
    });
  }
});

// Write path is gated on the four-eye approval workflow (sovereign
// approvals). Surface returns 501 so callers see "not implemented" and
// not "service degraded".
app.post('/', withSecurityEvents({ action: 'unit-subdivision.create', resource: 'unit-subdivision', severity: 'info' }, (c) => {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message:
          'unit-subdivision write path requires schema; pending sign-off',
      },
    },
    501,
  );
}));

export const unitSubdivisionRouter = app;
export default unitSubdivisionRouter;
