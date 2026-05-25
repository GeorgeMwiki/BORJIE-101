// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union widens
//   across multiple c.json branches; tracked with other routers already on nocheck.

/**
 * Notifications router — pulls dispatch log rows directly from the composition
 * root's Drizzle client. Previously a stub that always returned 503
 * (`createProtectedLiveDataRouter`). Now wired via `services.db` so
 * `GET /api/v1/notifications` returns real delivery history + status.
 *
 * Endpoints:
 *   GET /                  — list recent notifications (tenant-scoped)
 *   GET /:id               — fetch a single dispatch record
 *   GET /unread/count      — placeholder unread-count (requires in-app store)
 *
 * The notifications service has not yet been promoted to a domain-services
 * package with a proper repo — we read the table directly for now. When a
 * `NotificationService` class lands we can flip to `services.notifications`
 * without breaking the URL shape.
 */

import { Hono } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import { notificationDispatchLog } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

const app = new Hono();
app.use('*', authMiddleware);

function notConfigured(c) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Notifications database not configured — DATABASE_URL unset',
      },
    },
    503,
  );
}

app.get('/', async (c) => {
  const services = c.get('services') ?? {};
  const db = services.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(500, Math.max(1, Number(limitParam))) : 50;
  try {
    const rows = await db
      .select()
      .from(notificationDispatchLog)
      .where(eq(notificationDispatchLog.tenantId, tenantId))
      .orderBy(desc(notificationDispatchLog.createdAt))
      .limit(limit);
    return c.json({ success: true, data: rows });
  } catch (error) {
    return routeCatch(c, error, {
      code: 'NOTIFICATIONS_UNAVAILABLE',
      status: 503,
      fallback: 'Query failed',
    });
  }
});

app.get('/unread/count', async (c) => {
  const services = c.get('services') ?? {};
  const db = services.db;
  if (!db) return notConfigured(c);
  // Unread is a function of per-user delivery state that isn't tracked in
  // dispatch log directly (there's no `read_at`). The in-app notification
  // inbox schema is not landed yet — return a loud 501 unless the
  // `flag.bff.notifications.unread_count` flag is explicitly on (dev mode).
  const ff = services.featureFlags;
  const tenantId = c.get('tenantId');
  let flagOn = false;
  if (ff && typeof ff.isEnabled === 'function') {
    try {
      flagOn = Boolean(await ff.isEnabled(tenantId, 'flag.bff.notifications.unread_count'));
    } catch {
      flagOn = false;
    }
  }
  if (!flagOn) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message:
            'Unread-count endpoint requires the in-app inbox schema. Concrete next-step: add notification_inbox_state(user_id, dispatch_id, read_at) + a service method to count where read_at IS NULL.',
          flagKey: 'flag.bff.notifications.unread_count',
        },
      },
      501,
    );
  }
  return c.json({ success: true, data: { unread: 0, note: 'in-app inbox schema pending; flag-gated dev response' } });
});

app.get('/:id', async (c) => {
  const services = c.get('services') ?? {};
  const db = services.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  try {
    const [row] = await db
      .select()
      .from(notificationDispatchLog)
      .where(
        and(
          eq(notificationDispatchLog.tenantId, tenantId),
          eq(notificationDispatchLog.id, id),
        ),
      )
      .limit(1);
    if (!row) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Notification not found' } },
        404,
      );
    }
    return c.json({ success: true, data: row });
  } catch (error) {
    return routeCatch(c, error, {
      code: 'NOTIFICATIONS_UNAVAILABLE',
      status: 503,
      fallback: 'Query failed',
    });
  }
});

export const notificationsRouter = app;
