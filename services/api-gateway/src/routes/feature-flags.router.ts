/**
 * Feature Flags router — Wave 9 enterprise polish.
 *
 * Mounted at `/api/v1/feature-flags`.
 *
 *   GET /feature-flags         — resolved flag list for caller's tenant
 *   PUT /feature-flags/:key    — admin-only override (body: { enabled: bool })
 */
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';

import { withSecurityEvents } from '@borjie/observability';

/**
 * Router dispatches at runtime — Hono's generic `Context` is sufficient.
 */
type AnyContext = Context;

interface FeatureFlagsService {
  list(tenantId: string): Promise<unknown>;
  setOverride(tenantId: string, key: string, value: boolean, actor: string): Promise<unknown>;
}

const SetOverrideSchema = z.object({
  enabled: z.boolean(),
});

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: AnyContext): FeatureFlagsService | undefined {
  const services =
    (c.get('services') as { featureFlags?: FeatureFlagsService } | undefined) ?? {};
  return services.featureFlags;
}

function notImplemented(c: AnyContext) {
  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'FeatureFlags service not wired into api-gateway context',
      },
    },
    503,
  );
}

app.get('/', async (c: AnyContext) => {
  const auth = c.get('auth');
  const s = svc(c);
  if (!s) return notImplemented(c);
  try {
    const items = await s.list(auth.tenantId);
    return c.json({ success: true, data: items });
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | undefined;
    return c.json(
      {
        success: false,
        error: {
          code: err?.code ?? 'INTERNAL_ERROR',
          message: err?.message ?? 'unknown',
        },
      },
      400,
    );
  }
});

app.put(
  '/:key',
  requireRole(
    UserRole.TENANT_ADMIN,
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ),
  zValidator('json', SetOverrideSchema),
  withSecurityEvents({ action: 'feature-flag.update', resource: 'feature-flag', severity: 'info' }, async (c: AnyContext) => {
    const auth = c.get('auth');
    const flagKey = c.req.param('key');
    const body = c.req.valid('json');
    const s = svc(c);
    if (!s) return notImplemented(c);
    try {
      const override = await s.setOverride(
        auth.tenantId,
        flagKey,
        body.enabled,
      );
      return c.json({ success: true, data: override }, 200);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string } | undefined;
      const status =
        err?.code === 'UNKNOWN_FLAG'
          ? 404
          : err?.code === 'VALIDATION'
            ? 400
            : 500;
      return c.json(
        {
          success: false,
          error: {
            code: err?.code ?? 'INTERNAL_ERROR',
            message: err?.message ?? 'unknown',
          },
        },
        status,
      );
    }
  }),
);

export const featureFlagsRouter = app;
export default app;
