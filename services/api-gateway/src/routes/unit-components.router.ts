/**
 * Unit Components Router — estate-manager-app dependency.
 *
 *   GET /api/v1/units/:id/components  — list FAR / asset-component breakdown
 *
 * Wraps the existing `asset_components` table (packages/database/src/
 * schemas/asset-components.schema.ts) which already carries an optional
 * `unit_id` foreign key. Returns `success:true, data:[]` when the unit
 * has no registered components — honest empty rather than 503 — so the
 * Estate Manager UI renders the empty state cleanly.
 */

import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { assetComponents } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';
import { getDbFromServices } from '../utils/services-accessor';

const app = new Hono();
app.use('*', authMiddleware);

function dbUnavailable(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Unit components read requires a live DATABASE_URL.',
      },
    },
    503,
  );
}

app.get('/', async (c) => {
  const db = getDbFromServices(c);  if (!db) return dbUnavailable(c);

  const tenantId = c.get('tenantId');
  const unitId = c.req.param('id');

  try {
    const rows = await db
      .select()
      .from(assetComponents)
      .where(
        and(
          eq(assetComponents.tenantId, tenantId),
          eq(assetComponents.unitId, unitId),
        ),
      )
      .limit(500);

    return c.json({
      success: true,
      data: rows,
      meta: { unitId, count: rows.length },
    });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'UNIT_COMPONENTS_QUERY_FAILED',
      status: 503,
      fallback: 'Components query failed',
    });
  }
});

export const unitComponentsRouter = app;
export default unitComponentsRouter;
