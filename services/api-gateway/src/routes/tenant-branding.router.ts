/**
 * Tenant Branding API — Wave 27 Agent E.
 *
 * Exposes per-tenant AI persona identity (display name, honorific,
 * greeting, pronoun). Replaces hardcoded 'Mr. Mwikila' / 'Karibu'
 * literals with a country-neutral default plus tenant overrides.
 *
 * Endpoints:
 *   GET  /          → read the effective + overrides config (any authed user)
 *   PUT  /          → update branding (tenant-admin+)
 *   POST /reset     → restore defaults (tenant-admin+)
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const BrandingUpdateSchema = z
  .object({
    aiPersonaDisplayName: z.string().min(1).max(120).optional(),
    aiPersonaHonorific: z.string().min(1).max(40).optional(),
    aiGreeting: z.string().min(1).max(120).optional(),
    aiPronoun: z.enum(['he', 'she', 'they']).optional(),
  })
  .strict();

const app = new Hono();
app.use('*', authMiddleware);

function svc(c: any): any {
  const services = c.get('services') ?? {};
  return services.branding?.service ?? null;
}

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'TENANT_BRANDING_UNAVAILABLE',
        message: 'TenantBrandingService not configured on this gateway',
      },
    },
    503,
  );
}

// ---------------------------------------------------------------------------
// GET / — any authenticated user may read the branding their tenant uses.
// ---------------------------------------------------------------------------
app.get('/', async (c: any) => {
  const service = svc(c);
  if (!service) return notConfigured(c);
  const auth = c.get('auth');
  try {
    const config = await service.getConfig(auth.tenantId);
    return c.json({ success: true, data: config });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'TENANT_BRANDING_READ_FAILED',
      status: 500,
      fallback: 'Failed to load tenant branding',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT / — tenant-admin mutates the branding overrides.
// ---------------------------------------------------------------------------
app.put(
  '/',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  zValidator('json', BrandingUpdateSchema),
  withSecurityEvents({ action: 'tenant-branding.update', resource: 'tenant-branding', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const auth = c.get('auth');
    const body = c.req.valid('json');
    try {
      const config = await service.updateConfig(auth.tenantId, body);
      return c.json({ success: true, data: config });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'TENANT_BRANDING_UPDATE_FAILED',
        fallback: 'Failed to update tenant branding',
      });
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /reset — tenant-admin restores defaults.
// ---------------------------------------------------------------------------
app.post(
  '/reset',
  requireRole(UserRole.TENANT_ADMIN, UserRole.SUPER_ADMIN, UserRole.ADMIN),
  withSecurityEvents({ action: 'tenant-branding.create', resource: 'tenant-branding', severity: 'info' }, async (c: any) => {
    const service = svc(c);
    if (!service) return notConfigured(c);
    const auth = c.get('auth');
    try {
      const config = await service.resetConfig(auth.tenantId);
      return c.json({ success: true, data: config });
    } catch (err: any) {
      return routeCatch(c, err, {
        code: 'TENANT_BRANDING_RESET_FAILED',
        fallback: 'Failed to reset tenant branding',
      });
    }
  }),
);

export default app;
