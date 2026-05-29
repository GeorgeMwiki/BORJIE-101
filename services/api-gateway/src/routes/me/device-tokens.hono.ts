/**
 * /api/v1/me/device-tokens — push-notification token registry.
 *
 * Closes the bidirectional notification receiver loop. Mobile apps
 * (workforce-mobile, buyer-mobile) call `POST` on successful login to
 * register the Expo / FCM / APNS token they hold; the notification
 * dispatcher resolves all active tokens for a user before fanning out
 * a push so every surface the user is signed-in on receives the alert.
 *
 * Surface:
 *   GET    /api/v1/me/device-tokens          → list current user's tokens
 *   POST   /api/v1/me/device-tokens          → register or refresh a token
 *   DELETE /api/v1/me/device-tokens/:id      → revoke a token (sign-out)
 *
 * Auth: Supabase JWT. The route is auto-scoped to (`auth.tenantId`,
 * `auth.userId`) — clients cannot register a token under another user
 * or tenant.
 *
 * Idempotency: re-POSTing the same (user, app, token-triple) updates
 * `last_seen_at` and clears `revoked_at` instead of inserting a duplicate.
 * The composite uniqueness index on `device_push_tokens` enforces this
 * at the database level via `ON CONFLICT … DO UPDATE`.
 *
 * RLS: FORCE-enabled on `device_push_tokens`; the `databaseMiddleware`
 * binds `app.current_tenant_id` so cross-tenant writes are impossible.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const log = createLogger('me-device-tokens');

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

const PLATFORMS = ['ios', 'android', 'web'] as const;
const APPS = [
  'owner-web',
  'admin-web',
  'workforce-mobile',
  'buyer-mobile',
] as const;

const RegisterTokenSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    app: z.enum(APPS),
    expoPushToken: z.string().trim().min(1).max(512).optional(),
    fcmToken: z.string().trim().min(1).max(4096).optional(),
    apnsToken: z.string().trim().min(1).max(512).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.expoPushToken) ||
      Boolean(v.fcmToken) ||
      Boolean(v.apnsToken),
    {
      message:
        'At least one of expoPushToken / fcmToken / apnsToken is required.',
      path: ['expoPushToken'],
    },
  );

const RevokeParamsSchema = z.object({
  id: z.string().uuid(),
});

interface TokenRow {
  readonly id: string;
  readonly platform: string;
  readonly app: string;
  readonly expoPushToken: string | null;
  readonly fcmToken: string | null;
  readonly apnsToken: string | null;
  readonly installedAt: string;
  readonly lastSeenAt: string;
  readonly revokedAt: string | null;
}

function toTokenRow(raw: Record<string, unknown>): TokenRow {
  return {
    id: String(raw.id),
    platform: String(raw.platform ?? 'unknown'),
    app: String(raw.app ?? 'unknown'),
    expoPushToken: raw.expo_push_token ? String(raw.expo_push_token) : null,
    fcmToken: raw.fcm_token ? String(raw.fcm_token) : null,
    apnsToken: raw.apns_token ? String(raw.apns_token) : null,
    installedAt: String(raw.installed_at ?? new Date(0).toISOString()),
    lastSeenAt: String(raw.last_seen_at ?? new Date(0).toISOString()),
    revokedAt: raw.revoked_at ? String(raw.revoked_at) : null,
  };
}

export const meDeviceTokensRouter = new Hono();
meDeviceTokensRouter.use('*', authMiddleware);
meDeviceTokensRouter.use('*', databaseMiddleware);

meDeviceTokensRouter.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.get('db') as DbExec | null;
  if (!db) {
    return c.json(
      {
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database client is not initialized',
        },
      },
      503,
    );
  }
  try {
    const rows = (await db.execute(sql`
      SELECT id,
             platform,
             app,
             expo_push_token,
             fcm_token,
             apns_token,
             installed_at,
             last_seen_at,
             revoked_at
        FROM device_push_tokens
       WHERE user_id  = ${auth.userId}
         AND tenant_id = ${auth.tenantId}::uuid
       ORDER BY last_seen_at DESC
       LIMIT 50
    `)) as unknown as Array<Record<string, unknown>>;
    return c.json({
      success: true,
      data: rows.map(toTokenRow),
    });
  } catch (err) {
    log.error('device-tokens.list failed', { error: err });
    return c.json(
      {
        success: false,
        error: {
          code: 'DEVICE_TOKENS_LIST_FAILED',
          message: err instanceof Error ? err.message : 'unknown',
        },
      },
      500,
    );
  }
});

meDeviceTokensRouter.post(
  '/',
  zValidator('json', RegisterTokenSchema),
  async (c) => {
    const auth = c.get('auth');
    const db = c.get('db') as DbExec | null;
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database client is not initialized',
          },
        },
        503,
      );
    }
    const body = c.req.valid('json');
    const expo = body.expoPushToken ?? null;
    const fcm = body.fcmToken ?? null;
    const apns = body.apnsToken ?? null;
    try {
      const rows = (await db.execute(sql`
        INSERT INTO device_push_tokens (
          tenant_id, user_id, platform, app,
          expo_push_token, fcm_token, apns_token
        ) VALUES (
          ${auth.tenantId}::uuid,
          ${auth.userId},
          ${body.platform},
          ${body.app},
          ${expo},
          ${fcm},
          ${apns}
        )
        ON CONFLICT (
          user_id,
          app,
          (COALESCE(expo_push_token, '') || '|' || COALESCE(fcm_token, '') || '|' || COALESCE(apns_token, ''))
        )
        DO UPDATE SET
          last_seen_at = now(),
          revoked_at   = NULL,
          updated_at   = now(),
          platform     = EXCLUDED.platform
        RETURNING id, platform, app, expo_push_token, fcm_token, apns_token,
                  installed_at, last_seen_at, revoked_at
      `)) as unknown as Array<Record<string, unknown>>;
      const row = rows[0];
      if (!row) {
        return c.json(
          {
            success: false,
            error: {
              code: 'DEVICE_TOKEN_REGISTER_FAILED',
              message: 'Upsert returned no rows.',
            },
          },
          500,
        );
      }
      return c.json({ success: true, data: toTokenRow(row) }, 201);
    } catch (err) {
      log.error('device-tokens.register failed', { error: err });
      return c.json(
        {
          success: false,
          error: {
            code: 'DEVICE_TOKEN_REGISTER_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          },
        },
        500,
      );
    }
  },
);

meDeviceTokensRouter.delete(
  '/:id',
  zValidator('param', RevokeParamsSchema),
  async (c) => {
    const auth = c.get('auth');
    const db = c.get('db') as DbExec | null;
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Database client is not initialized',
          },
        },
        503,
      );
    }
    const { id } = c.req.valid('param');
    try {
      const rows = (await db.execute(sql`
        UPDATE device_push_tokens
           SET revoked_at = now(),
               updated_at = now()
         WHERE id = ${id}::uuid
           AND user_id = ${auth.userId}
           AND tenant_id = ${auth.tenantId}::uuid
           AND revoked_at IS NULL
        RETURNING id
      `)) as unknown as Array<Record<string, unknown>>;
      if (rows.length === 0) {
        return c.json(
          {
            success: false,
            error: {
              code: 'DEVICE_TOKEN_NOT_FOUND',
              message: 'No active token with that id for this user.',
            },
          },
          404,
        );
      }
      return c.json({ success: true, data: { id } });
    } catch (err) {
      log.error('device-tokens.revoke failed', { error: err });
      return c.json(
        {
          success: false,
          error: {
            code: 'DEVICE_TOKEN_REVOKE_FAILED',
            message: err instanceof Error ? err.message : 'unknown',
          },
        },
        500,
      );
    }
  },
);

export default meDeviceTokensRouter;
