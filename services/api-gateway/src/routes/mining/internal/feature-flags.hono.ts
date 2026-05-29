/**
 * /api/v1/mining/internal/feature-flags — platform-feature-flags list +
 * inline rollout-percentage flip.
 *
 * SUPER_ADMIN / ADMIN only. Reads from the canonical `feature_flags`
 * catalog + a left-join on `tenant_feature_flag_overrides` for the
 * per-tenant override view. The internal admin-web `FlagRolloutForm`
 * posts back via `PATCH /:flagKey/rollout` to flip the platform
 * default; per-tenant overrides flow through `tenant-feature-flags.ts`.
 *
 * Mounted at `/api/v1/mining/internal/feature-flags`.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { desc, eq } from 'drizzle-orm';
import { featureFlags } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

interface DrizzleSelect {
  readonly select: () => {
    readonly from: (t: unknown) => {
      readonly orderBy: (col: unknown) => Promise<readonly Record<string, unknown>[]>;
    };
  };
}

interface DrizzleUpdate {
  readonly update: (t: unknown) => {
    readonly set: (s: unknown) => {
      readonly where: (cond: unknown) => {
        readonly returning: () => Promise<readonly Record<string, unknown>[]>;
      };
    };
  };
}

app.get('/', async (c) => {
  const db = c.get('db') as unknown as DrizzleSelect;
  const rows = await db
    .select()
    .from(featureFlags)
    .orderBy(desc(featureFlags.updatedAt));
  return c.json({ success: true as const, data: rows }, 200);
});

app.patch('/:flagKey/rollout', async (c) => {
  const flagKey = c.req.param('flagKey');
  const body = (await c.req.json().catch(() => ({}))) as {
    defaultEnabled?: unknown;
  };
  if (typeof body.defaultEnabled !== 'boolean') {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', message: 'defaultEnabled boolean required' },
      },
      400,
    );
  }
  const db = c.get('db') as unknown as DrizzleUpdate;
  const updated = await db
    .update(featureFlags)
    .set({ defaultEnabled: body.defaultEnabled, updatedAt: new Date() })
    .where(eq(featureFlags.flagKey, flagKey))
    .returning();
  if (updated.length === 0) {
    return c.json(
      {
        success: false as const,
        error: { code: 'NOT_FOUND', message: 'feature flag not found' },
      },
      404,
    );
  }
  return c.json({ success: true as const, data: updated[0] }, 200);
});

export const miningInternalFeatureFlagsRouter = app;
