/**
 * tenants-admin.router tests — Agent V (deep-audit 2026-05-20).
 *
 * Verifies the DELETE /tenants/:id surface:
 *   - happy path (TENANT_ADMIN deleting own tenant): 202 + grace window
 *   - auth required: 401 without bearer
 *   - role gate: RESIDENT is 403
 *   - tenant-isolation: TENANT_ADMIN of tnt-a cannot delete tnt-b (403)
 *   - validation: graceDays < 30 is rejected
 *   - audit row fires
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createTenantsAdminRouter } from '../tenants-admin.router';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

interface EventCapture {
  readonly type: string;
  readonly payload: unknown;
}

function captureBus(captured: EventCapture[]) {
  return {
    async publish(envelope: unknown) {
      const env = envelope as {
        event?: { eventType?: string; payload?: unknown };
      };
      captured.push({
        type: env.event?.eventType ?? 'unknown',
        payload: env.event?.payload ?? null,
      });
    },
  };
}

function bearer(
  role: UserRole,
  userId = 'usr-owner',
  tenantId = 'tnt-test',
): string {
  return `Bearer ${generateToken({
    userId,
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(opts: {
  bus?: { publish: (envelope: unknown) => Promise<void> };
  tenantDeletion?: {
    scheduleTenantDeletion: (args: {
      tenantId: string;
      requestedBy: string;
      reason?: string;
      graceDays: number;
    }) => Promise<{
      tenantDeletionId: string;
      scheduledPurgeAt: string;
      affectedUsers: number;
    }>;
  };
} = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', {
      eventBus: opts.bus,
      tenantDeletion: opts.tenantDeletion,
    } as never);
    await next();
  });
  app.route('/tenants', createTenantsAdminRouter());
  return app;
}

describe('tenants-admin.router — DELETE /tenants/:id', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('happy path: TENANT_ADMIN deleting own tenant returns 202 + grace', async () => {
    const captured: EventCapture[] = [];
    const app = mount({ bus: captureBus(captured) });
    const res = await app.request('/tenants/tnt-test', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, 'usr-owner', 'tnt-test'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'subscription-ended' }),
    });
    expect(res.status).toBe(202);
    // DA2 cleanup: canonical field is `scheduledFor`; the legacy
    // `scheduledPurgeAt` alias was dropped from the response body.
    const body = (await res.json()) as {
      data: {
        tenantDeletionId: string;
        scheduledFor: string;
        graceDays: number;
      };
    };
    expect(body.data.tenantDeletionId).toBeTruthy();
    expect(body.data.scheduledFor).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.data.graceDays).toBeGreaterThanOrEqual(30);
    expect(
      captured.some((e) => e.type === 'tenant.delete-scheduled'),
      'expected tenant.delete-scheduled audit event',
    ).toBe(true);
  });

  it('auth required: 401 without bearer', async () => {
    const app = mount();
    const res = await app.request('/tenants/tnt-test', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('role gate: RESIDENT is 403', async () => {
    const app = mount();
    const res = await app.request('/tenants/tnt-test', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.RESIDENT, 'usr-res', 'tnt-test'),
      },
    });
    expect(res.status).toBe(403);
  });

  it('tenant-isolation: TENANT_ADMIN cannot delete a different tenant (403)', async () => {
    const app = mount();
    const res = await app.request('/tenants/tnt-other', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, 'usr-owner', 'tnt-test'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TENANT_MISMATCH');
  });

  it('platform admin can delete any tenant (cross-tenant override)', async () => {
    const app = mount();
    const res = await app.request('/tenants/tnt-other', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN, 'usr-su', 'tnt-internal'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
  });

  it('validation: graceDays below 30 is rejected with 400', async () => {
    const app = mount();
    const res = await app.request('/tenants/tnt-test', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, 'usr-owner', 'tnt-test'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ graceDays: 5 }),
    });
    expect(res.status).toBe(400);
  });

  it('delegates to tenantDeletion service when wired', async () => {
    const calls: unknown[] = [];
    const app = mount({
      tenantDeletion: {
        async scheduleTenantDeletion(args) {
          calls.push(args);
          return {
            tenantDeletionId: 'svc-tnt-del-1',
            scheduledPurgeAt: '2026-06-19T10:00:00.000Z',
            affectedUsers: 42,
          };
        },
      },
    });
    const res = await app.request('/tenants/tnt-test', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, 'usr-owner', 'tnt-test'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      data: { tenantDeletionId: string; affectedUsers: number };
    };
    expect(body.data.tenantDeletionId).toBe('svc-tnt-del-1');
    expect(body.data.affectedUsers).toBe(42);
    expect(calls.length).toBe(1);
  });
});
