// @ts-nocheck — Hono v4 status-code union; read-only handlers use structural casts over services.db.
/**
 * Scheduling router — Wave 18 real-data wiring.
 *
 *   GET    /events            — list scheduled events for the tenant
 *   GET    /events/:id        — single event
 *   POST   /events            — 501 (needs domain validation)
 *   PUT    /events/:id        — 501
 *   DELETE /events/:id        — 501
 *   GET    /availability      — 501
 *   PUT    /availability      — 501
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { scheduledEvents } from '@borjie/database';
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
        message: 'Scheduling requires a live DATABASE_URL.',
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
        message: `${verb} is not yet wired — read endpoints are live.`,
      },
    },
    501,
  );
}

app.get('/events', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? '50') || 50));
  try {
    const rows = await db
      .select()
      .from(scheduledEvents)
      .where(eq(scheduledEvents.tenantId, tenantId))
      .orderBy(desc(scheduledEvents.startAt))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SCHEDULING_QUERY_FAILED',
      status: 503,
      fallback: 'Query failed',
    });
  }
});

app.get('/events/:id', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  try {
    const [row] = await db
      .select()
      .from(scheduledEvents)
      .where(and(eq(scheduledEvents.tenantId, tenantId), eq(scheduledEvents.id, id)))
      .limit(1);
    if (!row) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SCHEDULING_QUERY_FAILED',
      status: 503,
      fallback: 'Query failed',
    });
  }
});

// Root GET lands here too — return the events list for the tenant so a
// quick smoke-test against `/api/v1/scheduling` yields 200 instead of 404.
app.get('/', async (c) => {
  const db = (c.get('services') ?? {}).db;
  if (!db) return dbUnavailable(c);
  const tenantId = c.get('tenantId');
  try {
    const rows = await db
      .select()
      .from(scheduledEvents)
      .where(eq(scheduledEvents.tenantId, tenantId))
      .orderBy(desc(scheduledEvents.startAt))
      .limit(50);
    return c.json({ success: true, data: rows });
  } catch (err) {
    return routeCatch(c, err, {
      code: 'SCHEDULING_QUERY_FAILED',
      status: 503,
      fallback: 'Query failed',
    });
  }
});

app.post('/events', withSecurityEvents({ action: 'schedule.create', resource: 'schedule', severity: 'info' }, (c) => notImplemented(c, 'Creating events')));
app.put('/events/:id', withSecurityEvents({ action: 'schedule.update', resource: 'schedule', severity: 'info' }, (c) => notImplemented(c, 'Updating events')));
app.delete('/events/:id', withSecurityEvents({ action: 'schedule.delete', resource: 'schedule', severity: 'notice' }, (c) => notImplemented(c, 'Deleting events')));
app.get('/availability', (c) => notImplemented(c, 'Reading availability'));
app.put('/availability', withSecurityEvents({ action: 'schedule.update', resource: 'schedule', severity: 'info' }, (c) => notImplemented(c, 'Updating availability')));

export const schedulingRouter = app;
