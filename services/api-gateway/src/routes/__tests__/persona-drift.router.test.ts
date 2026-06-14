/**
 * persona-drift.router tests — KI-011 regression.
 *
 * The admin-web persona-drift screen polls GET
 * /api/v1/persona-drift/events. The gateway never mounted the route, so
 * the fetch 404'd and the screen showed a permanent "Could not load"
 * alert. These tests lock the fix:
 *
 *   1.  Missing JWT → 401.
 *   2.  Non-admin role → 403.
 *   3.  TENANT_ADMIN locked to own tenant (cross-tenant query → 403).
 *   4.  Returns the `{ data: DriftEvent[] }` shape the client expects.
 *   5.  No adapter wired → honest `{ data: [] }` (200, NOT an error) so
 *       the client renders "Awaiting first breach", never the alert.
 *   6.  SUPER_ADMIN may inspect any tenant; the requested tenant is
 *       forwarded to the adapter.
 *   7.  Bad `limit` → 400.
 *   8.  `limit` forwarded + clamped to MAX (200).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createPersonaDriftRouter,
  type PersonaDriftEventSource,
  type PersonaDriftEventRow,
} from '../persona-drift.router';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

function makeRow(over: Partial<PersonaDriftEventRow> = {}): PersonaDriftEventRow {
  return Object.freeze({
    id: 'drift_1',
    personaId: 'counterparty-resident',
    violationType: 'tone',
    excerpt: 'persona-vector drift: dim no_filler drifted by 0.400',
    severity: 'high',
    detectedAt: '2026-05-17T00:00:00.000Z',
    worstDim: 'no_filler',
    ...over,
  });
}

function stubSource(
  opts: {
    rows?: ReadonlyArray<PersonaDriftEventRow>;
    capture?: { args?: { tenantId: string; limit: number } };
  } = {},
): PersonaDriftEventSource {
  return {
    async list(args) {
      if (opts.capture) opts.capture.args = args;
      return opts.rows ?? [];
    },
  };
}

function mount(
  opts: { source?: PersonaDriftEventSource } = {},
): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', {
      personaDriftEventSource: opts.source,
    } as never);
    await next();
  });
  app.route('/persona-drift', createPersonaDriftRouter());
  return app;
}

function bearer(
  role: UserRole,
  opts: { userId?: string; tenantId?: string } = {},
): string {
  return `Bearer ${generateToken({
    userId: opts.userId ?? 'usr-admin',
    tenantId: opts.tenantId ?? 'tnt_demo',
    role: role as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

describe('persona-drift.router (KI-011)', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('rejects requests without an Authorization header (401)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/persona-drift/events');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/persona-drift/events', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('rejects TENANT_ADMIN reading another tenant (403)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/persona-drift/events?tenantId=tnt_other', {
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt_demo' }),
      },
    });
    expect(res.status).toBe(403);
  });

  it('returns the { data: DriftEvent[] } shape the client expects (200)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/persona-drift/events', {
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt_demo' }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: PersonaDriftEventRow[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data?.[0]).toMatchObject({
      id: 'drift_1',
      personaId: 'counterparty-resident',
      severity: 'high',
      worstDim: 'no_filler',
    });
  });

  it('returns honest { data: [] } when no adapter is wired (200, not an error)', async () => {
    // The KI-011 bug was a 404 here (route unmounted) → permanent
    // "Could not load" alert. With the route mounted but no DB-backed
    // adapter, the truthful answer is an empty list so the client renders
    // the friendly "Awaiting first breach" empty state.
    const app = mount({ source: undefined });
    const res = await app.request('/persona-drift/events', {
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt_demo' }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: PersonaDriftEventRow[] };
    expect(body.data).toEqual([]);
  });

  it('lets SUPER_ADMIN inspect any tenant; forwards the requested tenant', async () => {
    const capture: { args?: { tenantId: string; limit: number } } = {};
    const app = mount({ source: stubSource({ rows: [makeRow()], capture }) });
    const res = await app.request('/persona-drift/events?tenantId=tnt_other', {
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN, { tenantId: 'tnt_demo' }),
      },
    });
    expect(res.status).toBe(200);
    expect(capture.args?.tenantId).toBe('tnt_other');
  });

  it('rejects a non-positive limit (400)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/persona-drift/events?limit=0', {
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt_demo' }),
      },
    });
    expect(res.status).toBe(400);
  });

  it('forwards + clamps limit to the MAX (200)', async () => {
    const capture: { args?: { tenantId: string; limit: number } } = {};
    const app = mount({ source: stubSource({ rows: [makeRow()], capture }) });
    const res = await app.request('/persona-drift/events?limit=9999', {
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt_demo' }),
      },
    });
    expect(res.status).toBe(200);
    expect(capture.args?.limit).toBe(200);
  });
});
