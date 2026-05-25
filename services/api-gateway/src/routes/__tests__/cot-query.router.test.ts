/**
 * CoT query router tests — Phase D / D3.
 *
 * Verifies:
 *   1.  Missing JWT → 401.
 *   2.  Non-admin role → 403.
 *   3.  TENANT_ADMIN locked to own tenant.
 *   4.  SUPER_ADMIN may query any tenant.
 *   5.  Default response uses scrubbed thoughtText.
 *   6.  include_raw=true without sovereign scope → 403.
 *   7.  include_raw=true with sovereign scope → 200 + raw text.
 *   8.  Audit event fires on default query (`cot.query`).
 *   9.  Audit event fires on raw query (`cot.query.raw`).
 *   10. Missing adapter → 503.
 *   11. Pagination params honoured (limit / offset).
 *   12. Bad pagination params → 400.
 *   13. since / until forwarded to adapter.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createCotQueryRouter, type CotQuerySource, type CotRow } from '../cot-query.router';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

interface EventCapture {
  readonly type: string;
  readonly payload: unknown;
}

function captureBus(captured: EventCapture[]) {
  return {
    async publish(envelope: unknown) {
      const env = envelope as { event?: { eventType?: string; payload?: unknown } };
      captured.push({
        type: env.event?.eventType ?? 'unknown',
        payload: env.event?.payload ?? null,
      });
    },
  };
}

function stubSource(opts: {
  rows?: ReadonlyArray<CotRow>;
  total?: number;
  capture?: { args?: unknown };
} = {}): CotQuerySource {
  return {
    async query(args) {
      if (opts.capture) opts.capture.args = args;
      return {
        rows: opts.rows ?? [],
        total: opts.total ?? (opts.rows?.length ?? 0),
      };
    },
  };
}

function makeRow(over: Partial<CotRow> = {}): CotRow {
  return Object.freeze({
    thoughtId: 'thg_1',
    tenantId: 'tnt_demo',
    threadId: 'thr_1',
    stakes: 'critical',
    thoughtText:
      'Tenant phone +255 712 345 678 reached out; routed via claude-opus-4-7.',
    promptHash: 'a'.repeat(64),
    responseHash: 'b'.repeat(64),
    capturedAt: '2026-05-17T00:00:00.000Z',
    ...over,
  });
}

function mount(opts: {
  source?: CotQuerySource;
  bus?: { publish: (envelope: unknown) => Promise<void> };
} = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', {
      cotQuerySource: opts.source,
      eventBus: opts.bus,
    } as never);
    await next();
  });
  app.route('/cot', createCotQueryRouter());
  return app;
}

function bearer(role: UserRole, opts: {
  userId?: string;
  tenantId?: string;
  permissions?: string[];
} = {}): string {
  return `Bearer ${generateToken({
    userId: opts.userId ?? 'usr-admin',
    tenantId: opts.tenantId ?? 'tnt_demo',
    role: role as never,
    permissions: opts.permissions ?? [],
    propertyAccess: ['*'],
  })}`;
}

describe('cot-query.router', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('rejects requests without an Authorization header (401)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/cot/query?tenantId=tnt_demo');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin roles (403)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/cot/query?tenantId=tnt_demo', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('rejects TENANT_ADMIN trying to query another tenant (403)', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/cot/query?tenantId=tnt_other', {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt_demo' }) },
    });
    expect(res.status).toBe(403);
  });

  it('allows TENANT_ADMIN scoped to their own tenant (200)', async () => {
    const capture: { args?: unknown } = {};
    const app = mount({ source: stubSource({ rows: [makeRow()], capture }) });
    const res = await app.request('/cot/query?tenantId=tnt_demo', {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN, { tenantId: 'tnt_demo' }) },
    });
    expect(res.status).toBe(200);
    expect((capture.args as { tenantId?: string }).tenantId).toBe('tnt_demo');
  });

  it('allows SUPER_ADMIN to query any tenant (200)', async () => {
    const capture: { args?: unknown } = {};
    const app = mount({ source: stubSource({ rows: [makeRow({ tenantId: 'tnt_other' })], capture }) });
    const res = await app.request('/cot/query?tenantId=tnt_other', {
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN, {
          tenantId: 'tnt_platform',
          permissions: ['*'],
        }),
      },
    });
    expect(res.status).toBe(200);
    expect((capture.args as { tenantId?: string }).tenantId).toBe('tnt_other');
  });

  it('scrubs thoughtText in default response (no include_raw)', async () => {
    const app = mount({
      source: stubSource({
        rows: [
          makeRow({
            thoughtText: 'Reach me at +255 712 345 678 via claude-opus-4-7.',
          }),
        ],
      }),
    });
    const res = await app.request('/cot/query?tenantId=tnt_demo', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: ReadonlyArray<{ thoughtText: string; scrubbedCategories: string[] }>;
    };
    expect(body.data[0].thoughtText).not.toContain('255');
    expect(body.data[0].thoughtText).toContain('[redacted-phone]');
    expect(body.data[0].scrubbedCategories.length).toBeGreaterThan(0);
  });

  it('returns 403 when include_raw=true without sovereign scope', async () => {
    const app = mount({ source: stubSource({ rows: [makeRow()] }) });
    const res = await app.request('/cot/query?tenantId=tnt_demo&include_raw=true', {
      headers: { Authorization: bearer(UserRole.ADMIN, { permissions: [] }) },
    });
    expect(res.status).toBe(403);
  });

  it('returns raw thoughtText when sovereign cot:read:raw scope is present', async () => {
    const raw = 'Reach me at +255 712 345 678 via claude-opus-4-7.';
    const app = mount({
      source: stubSource({ rows: [makeRow({ thoughtText: raw })] }),
    });
    const res = await app.request('/cot/query?tenantId=tnt_demo&include_raw=true', {
      headers: {
        Authorization: bearer(UserRole.ADMIN, {
          permissions: ['cot:read:raw'],
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: ReadonlyArray<{ thoughtText: string }>;
      meta: { includeRaw: boolean };
    };
    expect(body.meta.includeRaw).toBe(true);
    expect(body.data[0].thoughtText).toBe(raw);
  });

  it('emits a cot.query audit event on default queries', async () => {
    const captured: EventCapture[] = [];
    const app = mount({
      source: stubSource({ rows: [makeRow()] }),
      bus: captureBus(captured),
    });
    await app.request('/cot/query?tenantId=tnt_demo', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
    });
    expect(captured.length).toBe(1);
    expect(captured[0].type).toBe('cot.query');
  });

  it('emits a cot.query.raw audit event when include_raw=true is honoured', async () => {
    const captured: EventCapture[] = [];
    const app = mount({
      source: stubSource({ rows: [makeRow()] }),
      bus: captureBus(captured),
    });
    await app.request('/cot/query?tenantId=tnt_demo&include_raw=true', {
      headers: {
        Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }),
      },
    });
    expect(captured.length).toBe(1);
    expect(captured[0].type).toBe('cot.query.raw');
  });

  it('audit payload contains no raw PII', async () => {
    const captured: EventCapture[] = [];
    const app = mount({
      source: stubSource({
        rows: [
          makeRow({
            thoughtText: 'Caller +255 712 345 678 demanded refund.',
          }),
        ],
      }),
      bus: captureBus(captured),
    });
    await app.request('/cot/query?tenantId=tnt_demo', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
    });
    const serialised = JSON.stringify(captured[0].payload);
    expect(serialised).not.toContain('+255 712');
    expect(serialised).not.toContain('712 345');
  });

  it('returns 503 when no CoT query source is wired', async () => {
    const app = mount({});
    const res = await app.request('/cot/query?tenantId=tnt_demo', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('COT_QUERY_SOURCE_UNAVAILABLE');
  });

  it('forwards limit + offset to the adapter', async () => {
    const capture: { args?: unknown } = {};
    const app = mount({ source: stubSource({ rows: [], capture }) });
    await app.request('/cot/query?tenantId=tnt_demo&limit=25&offset=50', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
    });
    const args = capture.args as { limit: number; offset: number };
    expect(args.limit).toBe(25);
    expect(args.offset).toBe(50);
  });

  it('clamps an excessive limit down to MAX_LIMIT (200)', async () => {
    const capture: { args?: unknown } = {};
    const app = mount({ source: stubSource({ rows: [], capture }) });
    await app.request('/cot/query?tenantId=tnt_demo&limit=99999', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
    });
    expect((capture.args as { limit: number }).limit).toBe(200);
  });

  it('rejects a negative offset (400)', async () => {
    const app = mount({ source: stubSource({ rows: [] }) });
    const res = await app.request('/cot/query?tenantId=tnt_demo&offset=-1', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
    });
    expect(res.status).toBe(400);
  });

  it('forwards since + until ISO timestamps to the adapter', async () => {
    const capture: { args?: unknown } = {};
    const app = mount({ source: stubSource({ rows: [], capture }) });
    await app.request(
      '/cot/query?tenantId=tnt_demo&since=2026-05-01T00:00:00.000Z&until=2026-05-17T00:00:00.000Z',
      {
        headers: { Authorization: bearer(UserRole.SUPER_ADMIN, { permissions: ['*'] }) },
      },
    );
    const args = capture.args as { since: string | null; until: string | null };
    expect(args.since).toBe('2026-05-01T00:00:00.000Z');
    expect(args.until).toBe('2026-05-17T00:00:00.000Z');
  });
});
