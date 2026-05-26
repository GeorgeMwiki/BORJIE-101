
import { Hono } from 'hono';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { UserRole } from '../types/user-role';

import { withSecurityEvents } from '@borjie/observability';
type TenantRow = {
  id: string;
  name: string;
  slug: string;
  status?: string;
  primaryEmail?: string;
  primaryPhone?: string | null;
  settings?: Record<string, unknown> | null;
  subscriptionTier?: string;
  maxUnits?: number;
  maxUsers?: number;
  createdAt?: unknown;
  createdBy?: string;
  updatedAt?: unknown;
  updatedBy?: string;
};

function mapTenant(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: String(row.status || 'pending').toUpperCase(),
    contactEmail: row.primaryEmail,
    contactPhone: row.primaryPhone ?? undefined,
    settings: row.settings ?? {},
    subscription: {
      plan: row.subscriptionTier,
      status: String(row.status || 'pending').toUpperCase(),
      maxUnits: row.maxUnits,
      maxUsers: row.maxUsers,
    },
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/current', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — `auth.tenantId` IS the tenant identifier.
  const tenant = await repos.tenants.findById(auth.tenantId);
  if (!tenant) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
  return c.json({ success: true, data: mapTenant(tenant) });
});

app.patch('/current', withSecurityEvents({ action: 'tenant.update', resource: 'tenant', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const body = await c.req.json();
  const tenant = await repos.tenants.update(
    auth.tenantId,
    {
      name: body.name,
      primaryEmail: body.contactEmail,
      primaryPhone: body.contactPhone,
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: mapTenant(tenant) });
}));

app.get('/current/settings', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — `auth.tenantId` IS the tenant identifier.
  const tenant = await repos.tenants.findById(auth.tenantId);
  if (!tenant) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
  return c.json({ success: true, data: tenant.settings ?? {} });
});

app.patch('/current/settings', withSecurityEvents({ action: 'tenant.update', resource: 'tenant', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  const body = await c.req.json();
  // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — `auth.tenantId` IS the tenant identifier.
  const existing = await repos.tenants.findById(auth.tenantId);
  const tenant = await repos.tenants.update(
    auth.tenantId,
    {
      settings: {
        ...(existing?.settings ?? {}),
        ...body,
      },
      updatedBy: auth.userId,
    },
    auth.userId
  );
  return c.json({ success: true, data: tenant.settings ?? {} });
}));

app.get('/current/subscription', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos')!;
  // nosemgrep: missing-tenant-id-arg reason: the `tenants` repository is keyed by tenantId — `auth.tenantId` IS the tenant identifier.
  const tenant = await repos.tenants.findById(auth.tenantId);
  if (!tenant) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
  return c.json({
    success: true,
    data: {
      plan: tenant.subscriptionTier,
      status: String(tenant.status || 'pending').toUpperCase(),
      maxUnits: tenant.maxUnits,
      maxUsers: tenant.maxUsers,
      currentPeriodEndsAt: tenant.trialEndsAt,
    },
  });
});

// Wave 19 Agent H+I: cross-tenant listing is platform-admin only.
// Previously the handler ran the expensive cross-tenant scan for every
// caller and silently returned [] to non-super-admins — that's both a
// DoS vector (any authenticated user could hammer `findMany`) and an
// information leak (pagination totals hint at tenant count).
app.get(
  '/',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT),
  async (c) => {
    const repos = c.get('repos')!;
    const page = Number(c.req.query('page') || '1');
    const pageSize = Number(c.req.query('pageSize') || '20');
    // nosemgrep: missing-tenant-id-arg reason: platform-admin endpoint guarded by requireRole(SUPER_ADMIN|ADMIN|SUPPORT) — cross-tenant listing is the intent.
    const result = await repos.tenants.findMany({
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    return c.json({
      success: true,
      data: result.items.map(mapTenant),
      pagination: {
        page,
        pageSize,
        totalItems: result.total,
        totalPages: Math.ceil(result.total / pageSize),
        hasNextPage: result.hasMore,
        hasPreviousPage: page > 1,
      },
    });
  },
);

export const tenantsRouter = app;
