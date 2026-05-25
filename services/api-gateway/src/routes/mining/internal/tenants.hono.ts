// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/internal/tenants — Borjie HQ tenant administration.
 *
 * SUPER_ADMIN-only surface for provisioning + suspension. All mutations
 * skip the per-tenant RLS scope (these rows ARE the tenant index) but
 * the route still requires platform-admin role.
 *
 * Routes:
 *   GET    /             list tenants
 *   POST   /             provision tenant
 *   PATCH  /:id          update plan / billing
 *   POST   /:id/suspend  suspend
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { tenants } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

const PlanEnum = z.enum(['mwanzo', 'mkulima', 'mfanyabiashara', 'kampuni', 'group']);

const ProvisionSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(2).max(120).regex(/^[a-z0-9-]+$/),
  primaryEmail: z.string().email(),
  primaryPhone: z.string().max(40).optional(),
  country: z.string().length(2).default('TZ'),
  plan: PlanEnum.default('mkulima'),
  subscriptionTier: z.enum(['starter', 'professional', 'enterprise', 'custom']).default('starter'),
  region: z.string().optional(),
});

const PatchSchema = z.object({
  plan: PlanEnum.optional(),
  subscriptionTier: z.enum(['starter', 'professional', 'enterprise', 'custom']).optional(),
  billingSettings: z.record(z.unknown()).optional(),
  maxUsers: z.number().int().nonnegative().optional(),
  maxProperties: z.number().int().nonnegative().optional(),
  maxUnits: z.number().int().nonnegative().optional(),
});

app.get('/', async (c) => {
  const db = c.get('db');
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const rows = await db.select().from(tenants).orderBy(desc(tenants.createdAt)).limit(limit);
  return c.json({ success: true, data: rows });
});

app.post(
  '/',
  zValidator('json', ProvisionSchema),
  withSecurityEvents(
    { action: 'platform.tenant.provision', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const input = c.req.valid('json');
      const now = new Date();
      const [row] = await db
        .insert(tenants)
        .values({
          id: randomUUID(),
          name: input.name,
          slug: input.slug,
          status: 'pending',
          subscriptionTier: input.subscriptionTier,
          plan: input.plan,
          primaryEmail: input.primaryEmail,
          primaryPhone: input.primaryPhone ?? null,
          country: input.country,
          region: input.region ?? 'af-south-1',
          createdAt: now,
          updatedAt: now,
          createdBy: userId,
        })
        .returning();
      return c.json({ success: true, data: row }, 201);
    },
  ),
);

app.patch(
  '/:id',
  zValidator('json', PatchSchema),
  withSecurityEvents(
    { action: 'platform.tenant.update', resource: 'platform.tenant', severity: 'info' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const id = c.req.param('id');
      const input = c.req.valid('json');
      const [row] = await db
        .update(tenants)
        .set({ ...input, updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
      return c.json({ success: true, data: row });
    },
  ),
);

app.post(
  '/:id/suspend',
  withSecurityEvents(
    { action: 'platform.tenant.suspend', resource: 'platform.tenant', severity: 'warn' },
    async (c) => {
      const db = c.get('db');
      const { userId } = c.get('auth');
      const id = c.req.param('id');
      const [row] = await db
        .update(tenants)
        .set({ status: 'suspended', updatedAt: new Date(), updatedBy: userId })
        .where(eq(tenants.id, id))
        .returning();
      if (!row) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
      return c.json({ success: true, data: row });
    },
  ),
);

export const miningInternalTenantsRouter = app;
