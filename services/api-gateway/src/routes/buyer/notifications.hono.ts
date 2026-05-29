/**
 * /api/v1/buyer/notifications — commercial chain L7.
 *
 * Buyer-mobile read surface for the `buyer_notifications` queue. Each
 * buyer sees only their own tenant's notifications (RLS predicate +
 * handler-level filter on auth.userId).
 *
 * Routes:
 *   GET /            paginate ts-desc; query: limit, cursor, unreadOnly
 *   POST /:id/read   mark a single notification read (read_at = NOW())
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { listBuyerNotifications } from '../../services/buyer-notifications';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('buyer-notifications');

interface DbExecutor {
  execute(query: unknown): Promise<unknown>;
}

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  unreadOnly: z.coerce.boolean().optional(),
});

export const buyerNotificationsRouter = new Hono();
buyerNotificationsRouter.use('*', authMiddleware);
buyerNotificationsRouter.use('*', databaseMiddleware);

buyerNotificationsRouter.get(
  '/',
  zValidator('query', ListQuerySchema),
  async (c) => {
    const auth = c.get('auth') as { tenantId?: string; userId?: string };
    const db = c.get('db') as DbExecutor | null;
    if (!db || !auth?.tenantId || !auth?.userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NOTIFICATIONS_UNAVAILABLE',
            message: {
              en: 'Notifications temporarily unavailable',
              sw: 'Arifa hazipatikani kwa muda',
            },
          },
        },
        503,
      );
    }
    const q = c.req.valid('query');
    try {
      const result = await listBuyerNotifications(db, {
        buyerTenantId: auth.tenantId,
        buyerUserId: auth.userId,
        limit: q.limit,
        ...(q.cursor ? { cursor: q.cursor } : {}),
        ...(q.unreadOnly !== undefined ? { unreadOnly: q.unreadOnly } : {}),
      });
      return c.json({
        success: true,
        data: {
          notifications: result.notifications,
          nextCursor: result.nextCursor,
        },
      });
    } catch (err) {
      moduleLogger.error(
        {
          err,
          tenantId: auth.tenantId,
          userId: auth.userId,
        },
        'buyer_notifications_list_failed',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'NOTIFICATIONS_LIST_FAILED',
            message: {
              en: 'Failed to load notifications',
              sw: 'Imeshindwa kupakia arifa',
            },
          },
        },
        500,
      );
    }
  },
);

buyerNotificationsRouter.post('/:id/read', async (c) => {
  const auth = c.get('auth') as { tenantId?: string; userId?: string };
  const db = c.get('db') as DbExecutor | null;
  if (!db || !auth?.tenantId || !auth?.userId) {
    return c.json(
      { success: false, error: { code: 'NOTIFICATIONS_UNAVAILABLE' } },
      503,
    );
  }
  const id = c.req.param('id');
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return c.json(
      { success: false, error: { code: 'INVALID_NOTIFICATION_ID' } },
      400,
    );
  }
  await db.execute(sql`
    UPDATE buyer_notifications
       SET read_at = NOW()
     WHERE id = ${id}::uuid
       AND buyer_tenant_id = ${auth.tenantId}::uuid
       AND buyer_user_id = ${auth.userId}
       AND read_at IS NULL
  `);
  return c.json({ success: true, data: { id } });
});

export default buyerNotificationsRouter;
