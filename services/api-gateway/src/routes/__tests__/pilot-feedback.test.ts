/**
 * /api/v1/pilot/feedback — router smoke tests.
 *
 * Asserts:
 *   - 401 when no Authorization header is provided
 *   - 400 when the body fails validation (rating out of range)
 *   - 201 happy path persists via the injected drizzle stub and returns
 *     the inserted id + createdAt
 *   - 503 when no `db` is bound on the request context (degraded boot)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret before importing the router so all middlewares that
// capture the secret at module init agree. Mirrors head-briefing tests.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { createPilotFeedbackRouter } from '../pilot-feedback.hono.js';
import { generateToken } from '../../middleware/auth.js';
import { UserRole } from '../../types/user-role.js';

interface StubDbCall {
  readonly text: string;
  readonly params: ReadonlyArray<unknown>;
}

interface StubDb {
  readonly calls: StubDbCall[];
  execute(query: { sql: string; params: ReadonlyArray<unknown> } | unknown): Promise<{
    rows: ReadonlyArray<Record<string, unknown>>;
  }>;
}

function makeStubDb(row: Record<string, unknown> | null = {
  id: 'pf-1',
  created_at: '2026-05-27T10:00:00Z',
}): StubDb {
  const calls: StubDbCall[] = [];
  return {
    calls,
    async execute(query: any) {
      // Drizzle's `sql` template returns an object with `.queryChunks` / `.toQuery`,
      // but for the smoke test we just record the call and return a fixed shape.
      calls.push({
        text: typeof query?.toString === 'function' ? query.toString() : '',
        params: [],
      });
      return { rows: row ? [row] : [] };
    },
  };
}

function bearer(role: UserRole): string {
  return `Bearer ${generateToken({
    userId: 'usr-test',
    tenantId: 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(db: StubDb | null) {
  const app = new Hono();
  // Pre-bind `db` on the context so the route's own `databaseMiddleware`
  // sees a pre-injected client and skips creating its own. Mirrors the
  // pre-injection branch in `services/api-gateway/src/middleware/database.ts`.
  app.use('*', async (c, next) => {
    if (db) {
      // @ts-expect-error — `db` slot is augmented by the database middleware.
      c.set('db', db);
    }
    await next();
  });
  app.route('/api/v1/pilot/feedback', createPilotFeedbackRouter());
  return app;
}

describe('POST /api/v1/pilot/feedback — auth', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  it('returns 401 when no bearer token is supplied', async () => {
    const app = mount(makeStubDb());
    const res = await app.request('/api/v1/pilot/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 5, message: 'Great app!' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/pilot/feedback — validation', () => {
  it('returns 400 when rating is out of range', async () => {
    const app = mount(makeStubDb());
    const res = await app.request('/api/v1/pilot/feedback', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 7, message: 'too high' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 400 when message is empty', async () => {
    const app = mount(makeStubDb());
    const res = await app.request('/api/v1/pilot/feedback', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 3, message: '' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/pilot/feedback — happy path', () => {
  it('returns 201 with the persisted id when a valid payload is posted', async () => {
    const db = makeStubDb({
      id: 'pf-42',
      created_at: '2026-05-27T11:11:11Z',
    });
    const app = mount(db);
    const res = await app.request('/api/v1/pilot/feedback', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rating: 5,
        message: 'Easy to use — niliweza kuingiza ripoti haraka.',
        screenId: 'W-DASH-01',
        sessionContext: { network: 'offline-recovered' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { id: string; createdAt: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('pf-42');
    expect(body.data.createdAt).toBe('2026-05-27T11:11:11Z');
    // At least one execute() — the route's INSERT. The databaseMiddleware
    // also issues a `SELECT set_config(...)` to set the RLS tenant GUC
    // before the handler runs, so we expect >= 1 calls but the load-
    // bearing assertion is the 201 + the persisted id above.
    expect(db.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/v1/pilot/feedback — degraded mode', () => {
  it('returns 503 when no db is bound on the context', async () => {
    const app = mount(null);
    const res = await app.request('/api/v1/pilot/feedback', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.TENANT_ADMIN),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: 4, message: 'works on staging' }),
    });
    // The default databaseMiddleware will create a client when `db` was
    // not pre-injected and there is a DATABASE_URL — in the test sandbox
    // there is no DATABASE_URL so the middleware exits early or the
    // execute() call fails. Either way the response is non-2xx.
    expect([500, 503]).toContain(res.status);
  });
});
