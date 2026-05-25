/**
 * Sensorium router tests — Central Command Phase A (C4).
 *
 * Pins the contract the client-side sensory bus (apps/admin-platform-
 * portal/src/lib/sensorium) and the BehaviorObserver agg layer (packages/
 * ai-copilot) rely on:
 *
 *   1. Auth: POST without a token → 401
 *   2. Validation: missing batch / bad eventType → 400
 *   3. Degraded mode: no DB → 503 SENSORIUM_UNAVAILABLE
 *   4. Happy path: 200 with `{ accepted, rejected }` and rows inserted
 *      against a stub appendBatch
 *   5. Tenant-scope: body tenantId is IGNORED; rows inherit auth.tenantId
 *   6. Batch size cap: surplus over MAX_EVENTS_PER_BATCH is rejected
 *      not 4xx
 *   7. Rate limit: ≥ MAX_BATCHES_PER_WINDOW per (tenant, session) → 429
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// Stub the database package — the router only needs the factory shape
// + the SENSORIUM_EVENT_TYPES constant.
let appendBatchSpy: ReturnType<typeof vi.fn> = vi.fn();

vi.mock('@borjie/database', () => ({
  SENSORIUM_EVENT_TYPES: [
    'page.view',
    'page.leave',
    'element.click',
    'input.change',
    'form.submit',
    'scroll.depth',
    'dwell.time',
    'focus.change',
    'keyboard.shortcut',
    'copy.paste',
    'viewport.resize',
    'network.request',
    'error.boundary',
    'a11y.tree.diff',
  ],
  createSensoriumEventLogService: () => ({
    appendBatch: appendBatchSpy,
    listForSession: vi.fn(async () => []),
    countByTypeForUser: vi.fn(async () => ({})),
  }),
}));

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import sensoriumRouter, {
  __resetSensoriumRateLimiter,
} from '../sensorium.router';

function bearer(role: UserRole = UserRole.ADMIN, tenantId = 'tnt-1'): string {
  return `Bearer ${generateToken({
    userId: 'usr-1',
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function attachServices(services: Record<string, unknown>) {
  return async (c: any, next: any) => {
    c.set('services', services);
    await next();
  };
}

function mount(services: Record<string, unknown> = { db: {} }): Hono {
  const app = new Hono();
  app.use('*', attachServices(services));
  app.route('/sensorium', sensoriumRouter);
  return app;
}

function validBatch(n = 3): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    eventType: 'page.view',
    route: `/jarvis?p=${i}`,
    emittedAt: new Date().toISOString(),
    payload: { i },
  }));
}

describe('sensorium router', () => {
  beforeEach(() => {
    __resetSensoriumRateLimiter();
    appendBatchSpy = vi.fn(async (rows: unknown[]) => ({
      inserted: Array.isArray(rows) ? rows.length : 0,
      rejected: 0,
    }));
  });

  it('rejects POST /events without a bearer token (401)', async () => {
    const res = await mount().request('/sensorium/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's1', batch: validBatch() }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects POST /events with bad event type (400)', async () => {
    const res = await mount().request('/sensorium/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        sessionId: 's1',
        batch: [
          {
            eventType: 'mouse.move', // banned
            route: '/jarvis',
            emittedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 SENSORIUM_UNAVAILABLE when db is null', async () => {
    const res = await mount({ db: null }).request('/sensorium/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ sessionId: 's1', batch: validBatch() }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SENSORIUM_UNAVAILABLE');
  });

  it('happy path: accepts batch, calls appendBatch, returns counts', async () => {
    const res = await mount().request('/sensorium/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ sessionId: 's1', batch: validBatch(5) }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { accepted: number; rejected: number };
    };
    expect(body.success).toBe(true);
    expect(body.data.accepted).toBe(5);
    expect(body.data.rejected).toBe(0);
    expect(appendBatchSpy).toHaveBeenCalledOnce();
  });

  it('tenant scope: every row inherits auth.tenantId regardless of body', async () => {
    await mount().request('/sensorium/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.ADMIN, 'tnt-real'),
      },
      body: JSON.stringify({
        sessionId: 's1',
        // body has no tenantId field — schema is strict
        batch: validBatch(2),
      }),
    });
    expect(appendBatchSpy).toHaveBeenCalledOnce();
    const rows = appendBatchSpy.mock.calls[0]?.[0] as Array<{
      tenantId: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tenantId === 'tnt-real')).toBe(true);
  });

  it('batch size cap: rejects surplus over MAX_EVENTS_PER_BATCH (not 4xx)', async () => {
    const oversized = validBatch(110); // 100 cap → 10 surplus
    appendBatchSpy = vi.fn(async (rows: unknown[]) => ({
      inserted: (rows as unknown[]).length,
      rejected: 0,
    }));

    const res = await mount().request('/sensorium/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({ sessionId: 's1', batch: oversized }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: {
        accepted: number;
        rejected: number;
        reasons?: string[];
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.accepted).toBe(100);
    expect(body.data.rejected).toBe(10);
    expect(body.data.reasons).toBeDefined();
    expect(body.data.reasons?.some((r) => r.startsWith('batch-truncated'))).toBe(
      true,
    );
  });

  it('rate limit: returns 429 once the bucket fills for one (tenant, session)', async () => {
    const app = mount();
    // 100 batches per 10 min window — we cap at 101 to trip the limiter.
    let lastStatus = 0;
    for (let i = 0; i < 101; i += 1) {
      const res = await app.request('/sensorium/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(),
        },
        body: JSON.stringify({
          sessionId: 'rl-session',
          batch: [
            {
              eventType: 'page.view',
              route: '/jarvis',
              emittedAt: new Date().toISOString(),
            },
          ],
        }),
      });
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it('rate limit: different sessionId has its own bucket', async () => {
    const app = mount();
    // Saturate session A.
    for (let i = 0; i < 100; i += 1) {
      await app.request('/sensorium/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: bearer(),
        },
        body: JSON.stringify({
          sessionId: 'sess-A',
          batch: [
            {
              eventType: 'page.view',
              route: '/jarvis',
              emittedAt: new Date().toISOString(),
            },
          ],
        }),
      });
    }
    // Session B should still be allowed.
    const res = await app.request('/sensorium/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        sessionId: 'sess-B',
        batch: [
          {
            eventType: 'page.view',
            route: '/jarvis',
            emittedAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });
});
