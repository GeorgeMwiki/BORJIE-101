/**
 * pilot-errors.hono tests — pilot observability stack.
 *
 * Verifies:
 *
 *   GET /pilot/errors
 *     - happy path: returns recent errors with cohort breakdown
 *     - auth required: 401 without bearer
 *     - role gate: RESIDENT is 403
 *     - cohort filter is honoured
 *     - SentryReaderNotWiredError surfaces a structured 500 + code
 *
 * The route reads from the in-memory ring buffer in
 * `observability/pilot-mode.ts`. Each test resets the sink so they
 * stay isolated.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createPilotErrorsRouter,
  SentryReaderNotWiredError,
  type PilotErrorReader,
} from '../pilot-errors.hono';
import {
  appendPilotError,
  __resetPilotErrorSinkForTests,
} from '../../observability/pilot-mode';
import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

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

function mount(reader?: PilotErrorReader): Hono {
  const app = new Hono();
  app.route('/pilot', createPilotErrorsRouter({ reader }));
  return app;
}

interface PilotErrorsBody {
  success: true;
  data: ReadonlyArray<{ id: string; message: string; cohort?: string }>;
  meta: {
    total: number;
    limit: number;
    byCohort: Record<string, number>;
    source: 'memory' | 'sentry';
    timestamp: string;
  };
}

describe('pilot-errors.hono — GET /pilot/errors', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  beforeEach(() => {
    __resetPilotErrorSinkForTests();
  });

  it('happy path: returns most-recent errors with cohort breakdown', async () => {
    appendPilotError({
      err: new Error('boom-1'),
      cohort: 'ferengi-alpha',
      userId: 'usr-1',
      tenantId: 'tnt-test',
      route: '/api/v1/owner/dashboard',
      timestamp: '2026-05-27T10:00:00.000Z',
    });
    appendPilotError({
      err: new Error('boom-2'),
      cohort: 'tanzanite-beta',
      userId: 'usr-2',
      tenantId: 'tnt-test',
      route: '/api/v1/mining/sites',
      timestamp: '2026-05-27T10:05:00.000Z',
    });

    const app = mount();
    const res = await app.request('/pilot/errors?limit=10', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PilotErrorsBody;
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
    // Most recent first.
    expect(body.data[0]?.message).toBe('boom-2');
    expect(body.data[1]?.message).toBe('boom-1');
    expect(body.meta.total).toBe(2);
    expect(body.meta.byCohort['ferengi-alpha']).toBe(1);
    expect(body.meta.byCohort['tanzanite-beta']).toBe(1);
    expect(body.meta.source).toBe('memory');
  });

  it('auth required: 401 without bearer', async () => {
    const app = mount();
    const res = await app.request('/pilot/errors');
    expect(res.status).toBe(401);
  });

  it('role gate: RESIDENT is 403', async () => {
    const app = mount();
    const res = await app.request('/pilot/errors', {
      headers: { Authorization: bearer(UserRole.RESIDENT) },
    });
    expect(res.status).toBe(403);
  });

  it('cohort filter narrows results to the requested cohort', async () => {
    appendPilotError({ err: 'a', cohort: 'cohort-1' });
    appendPilotError({ err: 'b', cohort: 'cohort-2' });
    appendPilotError({ err: 'c', cohort: 'cohort-1' });

    const app = mount();
    const res = await app.request('/pilot/errors?cohort=cohort-1', {
      headers: { Authorization: bearer(UserRole.ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PilotErrorsBody;
    expect(body.data.length).toBe(2);
    for (const item of body.data) {
      expect(item.cohort).toBe('cohort-1');
    }
    expect(body.meta.total).toBe(2);
    expect(body.meta.byCohort['cohort-1']).toBe(2);
    expect(body.meta.byCohort['cohort-2']).toBeUndefined();
  });

  it('since filter drops older records', async () => {
    appendPilotError({
      err: 'old',
      cohort: 'cohort-x',
      timestamp: '2026-05-26T09:00:00.000Z',
    });
    appendPilotError({
      err: 'new',
      cohort: 'cohort-x',
      timestamp: '2026-05-27T11:00:00.000Z',
    });

    const app = mount();
    const since = encodeURIComponent('2026-05-27T00:00:00.000Z');
    const res = await app.request(`/pilot/errors?since=${since}`, {
      headers: { Authorization: bearer(UserRole.TENANT_ADMIN) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PilotErrorsBody;
    expect(body.data.length).toBe(1);
    expect(body.data[0]?.message).toBe('new');
  });

  it('SentryReaderNotWiredError surfaces as a structured 500', async () => {
    const reader: PilotErrorReader = {
      async query() {
        throw new SentryReaderNotWiredError();
      },
    };
    const app = mount(reader);
    const res = await app.request('/pilot/errors', {
      headers: { Authorization: bearer(UserRole.SUPER_ADMIN) },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      success: false;
      error: { code: string; message: string };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SENTRY_READER_NOT_WIRED');
    expect(body.error.message).toMatch(/not yet wired/i);
  });
});
