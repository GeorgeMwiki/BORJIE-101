/**
 * admin-audit.router tests — Agent V (deep-audit 2026-05-20).
 *
 * Verifies:
 *
 *   GET /admin/audit/log
 *     - happy path: returns paginated items
 *     - auth required: 401 without bearer
 *     - role gate: RESIDENT is 403
 *     - tenant-scope pin: TENANT_ADMIN sees only their tenantId even when
 *       they pass a different one in the query
 *
 *   POST /admin/tenants/:id/purge-now
 *     - role gate: TENANT_ADMIN is 403 (only SUPER_ADMIN allowed)
 *     - 404 when the tenant doesn't exist
 *     - 400 when confirmTenantName doesn't match
 *     - 200 happy path with redactedRowCount
 *     - audit row fires (and a denial fires when confirmation mismatches)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createAdminAuditRouter } from '../admin-audit.router';
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
  userId = 'usr-admin',
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

interface AuditQueryArgs {
  tenantId?: string;
  actor?: string;
  action?: string;
  since?: string;
  until?: string;
  limit: number;
  cursor?: string;
}

function mount(opts: {
  bus?: { publish: (envelope: unknown) => Promise<void> };
  auditLogQuery?: {
    query: (args: AuditQueryArgs) => Promise<{
      items: ReadonlyArray<{
        id: string;
        event: string;
        actor: string;
        tenantId?: string;
        timestamp: string;
      }>;
      nextCursor?: string | null;
    }>;
  };
  tenantPurge?: {
    purgeTenantNow: (args: {
      tenantId: string;
      requestedBy: string;
    }) => Promise<{ purgedAt: string; redactedRowCount: number }>;
    getTenantName: (tenantId: string) => Promise<string | null>;
  };
} = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', {
      eventBus: opts.bus,
      auditLogQuery: opts.auditLogQuery,
      tenantPurge: opts.tenantPurge,
    } as never);
    await next();
  });
  app.route('/admin', createAdminAuditRouter());
  return app;
}

describe('admin-audit.router — GET /admin/audit/log', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('happy path: returns paginated items', async () => {
    const captured: EventCapture[] = [];
    const app = mount({
      bus: captureBus(captured),
      auditLogQuery: {
        async query(args) {
          return {
            items: [
              {
                id: 'audit-1',
                event: 'user.me.delete-request',
                actor: 'usr-x',
                tenantId: args.tenantId,
                timestamp: '2026-05-20T10:00:00.000Z',
              },
            ],
            nextCursor: 'cursor-abc',
          };
        },
      },
    });
    const res = await app.request(
      '/admin/audit/log?actor=usr-x&limit=10',
      {
        headers: {
          Authorization: bearer(UserRole.TENANT_ADMIN, 'usr-tnt', 'tnt-test'),
        },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: unknown[];
      meta: { limit: number; nextCursor: string };
    };
    expect(body.success).toBe(true);
    // DA2 cleanup: canonical shape is `data`, not the legacy `items` alias.
    expect(body.data.length).toBe(1);
    expect(body.meta.nextCursor).toBe('cursor-abc');
    expect(
      captured.some((e) => e.type === 'admin.audit.log.read'),
    ).toBe(true);
  });

  it('auth required: 401 without bearer', async () => {
    const app = mount();
    const res = await app.request('/admin/audit/log');
    expect(res.status).toBe(401);
  });

  it('role gate: RESIDENT is 403', async () => {
    const app = mount();
    const res = await app.request('/admin/audit/log', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('tenant-scope: TENANT_ADMIN sees only their tenantId (cross-tenant query param ignored)', async () => {
    const queries: AuditQueryArgs[] = [];
    const app = mount({
      auditLogQuery: {
        async query(args) {
          queries.push(args);
          return { items: [], nextCursor: null };
        },
      },
    });
    const res = await app.request(
      '/admin/audit/log?tenantId=tnt-other',
      {
        headers: {
          Authorization: bearer(UserRole.TENANT_ADMIN, 'usr-tnt', 'tnt-test'),
        },
      },
    );
    expect(res.status).toBe(200);
    expect(queries.length).toBe(1);
    expect(queries[0].tenantId).toBe('tnt-test');
  });

  it('validation: limit > 500 is rejected with 400', async () => {
    const app = mount();
    const res = await app.request('/admin/audit/log?limit=9999', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(400);
  });
});

describe('admin-audit.router — POST /admin/tenants/:id/purge-now', () => {
  it('role gate: TENANT_ADMIN is 403 (only SUPER_ADMIN allowed)', async () => {
    const app = mount();
    const res = await app.request('/admin/tenants/tnt-test/purge-now', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, 'usr-tnt', 'tnt-test'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmTenantName: 'Whatever' }),
    });
    expect(res.status).toBe(403);
  });

  it('auth required: 401 without bearer', async () => {
    const app = mount();
    const res = await app.request('/admin/tenants/tnt-test/purge-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmTenantName: 'Acme' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 500 TENANT_PURGE_UNAVAILABLE when service is unwired', async () => {
    const app = mount();
    const res = await app.request('/admin/tenants/tnt-test/purge-now', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmTenantName: 'Acme' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TENANT_PURGE_UNAVAILABLE');
  });

  it('returns 404 when tenant does not exist', async () => {
    const app = mount({
      tenantPurge: {
        async getTenantName() {
          return null;
        },
        async purgeTenantNow() {
          throw new Error('should not reach');
        },
      },
    });
    const res = await app.request('/admin/tenants/tnt-missing/purge-now', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmTenantName: 'Whatever' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when confirmTenantName does not match', async () => {
    const captured: EventCapture[] = [];
    const app = mount({
      bus: captureBus(captured),
      tenantPurge: {
        async getTenantName() {
          return 'Acme Holdings';
        },
        async purgeTenantNow() {
          throw new Error('should not reach');
        },
      },
    });
    const res = await app.request('/admin/tenants/tnt-test/purge-now', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmTenantName: 'Wrong Name' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFIRMATION_MISMATCH');
    expect(
      captured.some((e) => e.type === 'admin.tenant.purge-now.denied'),
    ).toBe(true);
  });

  it('happy path: 200 with redactedRowCount + critical audit', async () => {
    const captured: EventCapture[] = [];
    const app = mount({
      bus: captureBus(captured),
      tenantPurge: {
        async getTenantName() {
          return 'Acme Holdings';
        },
        async purgeTenantNow() {
          return {
            purgedAt: '2026-05-20T11:00:00.000Z',
            redactedRowCount: 1234,
          };
        },
      },
    });
    const res = await app.request('/admin/tenants/tnt-test/purge-now', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmTenantName: 'Acme Holdings' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { purgedAt: string; redactedRowCount: number };
    };
    expect(body.data.redactedRowCount).toBe(1234);
    expect(body.data.purgedAt).toBe('2026-05-20T11:00:00.000Z');
    expect(
      captured.some((e) => e.type === 'admin.tenant.purge-now'),
    ).toBe(true);
  });
});
