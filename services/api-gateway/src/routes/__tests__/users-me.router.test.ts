/**
 * users-me.router tests — Agent V (deep-audit 2026-05-20).
 *
 * Verifies the self-service GDPR/PDPA aliases:
 *
 *   POST /users/me/data-export
 *     - happy path: returns 200 with JSON attachment
 *     - auth required: 401 without bearer
 *     - rate limited: 3rd call inside the hour is 429
 *     - audit row fires on every call
 *
 *   DELETE /users/me
 *     - happy path: returns 202 with deletionRequestId + scheduledPurgeAt
 *     - auth required: 401 without bearer
 *     - immediate=true is rejected (400) — only soft-delete is supported
 *     - audit row fires
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Pin the JWT secret BEFORE importing any router so module-init reads agree.
process.env.JWT_SECRET =
  process.env.JWT_SECRET ??
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import {
  createUsersMeRouter,
  _resetSelfExportRateBucketForTests,
} from '../users-me.router';
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

function bearer(role: UserRole, userId = 'usr-self'): string {
  return `Bearer ${generateToken({
    userId,
    tenantId: 'tnt-test',
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(opts: {
  bus?: { publish: (envelope: unknown) => Promise<void> };
  accountDeletion?: {
    requestSelfDeletion: (args: {
      tenantId: string;
      userId: string;
      reason?: string;
    }) => Promise<{ deletionRequestId: string; scheduledPurgeAt: string }>;
  };
} = {}): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', {
      eventBus: opts.bus,
      accountDeletion: opts.accountDeletion,
    } as never);
    await next();
  });
  app.route('/users/me', createUsersMeRouter());
  return app;
}

describe('users-me.router — POST /users/me/data-export', () => {
  beforeAll(() => {
    expect(process.env.JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
  });

  beforeEach(() => {
    _resetSelfExportRateBucketForTests();
  });

  it('happy path: returns 200 with JSON attachment', async () => {
    const captured: EventCapture[] = [];
    const app = mount({ bus: captureBus(captured) });
    const res = await app.request('/users/me/data-export', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.RESIDENT, 'usr-alpha'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment;/);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(
      captured.some((e) => e.type === 'user.me.data-export'),
      'expected user.me.data-export audit event',
    ).toBe(true);
  });

  it('auth required: 401 without bearer', async () => {
    const app = mount();
    const res = await app.request('/users/me/data-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('validation: rejects unknown body shape with 400', async () => {
    const app = mount();
    const res = await app.request('/users/me/data-export', {
      method: 'POST',
      headers: {
        Authorization: bearer(UserRole.RESIDENT, 'usr-alpha'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ format: 'tar' }),
    });
    expect(res.status).toBe(400);
  });

  it('rate-limit: 3rd call within the hour returns 429 with Retry-After', async () => {
    const app = mount();
    const headers = {
      Authorization: bearer(UserRole.RESIDENT, 'usr-rate'),
      'Content-Type': 'application/json',
    };
    // 2 successful calls (limit is 2 per hour)
    for (let i = 0; i < 2; i++) {
      const r = await app.request('/users/me/data-export', {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      expect(r.status).toBe(200);
    }
    // 3rd call is throttled
    const throttled = await app.request('/users/me/data-export', {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get('Retry-After')).toMatch(/^\d+/);
    const body = (await throttled.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('users-me.router — DELETE /users/me', () => {
  beforeEach(() => {
    _resetSelfExportRateBucketForTests();
  });

  it('happy path: returns 202 with deletionRequestId + scheduledPurgeAt', async () => {
    const captured: EventCapture[] = [];
    const app = mount({ bus: captureBus(captured) });
    const res = await app.request('/users/me', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.RESIDENT, 'usr-del'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'gdpr-art17' }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      data: { deletionRequestId: string; scheduledPurgeAt: string };
    };
    expect(body.data.deletionRequestId).toBeTruthy();
    expect(body.data.scheduledPurgeAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(
      captured.some((e) => e.type === 'user.me.delete-request'),
      'expected user.me.delete-request audit event',
    ).toBe(true);
  });

  it('auth required: 401 without bearer', async () => {
    const app = mount();
    const res = await app.request('/users/me', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('rejects immediate=true with 400', async () => {
    const app = mount();
    const res = await app.request('/users/me', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.RESIDENT, 'usr-del'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ immediate: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IMMEDIATE_DELETE_NOT_PERMITTED');
  });

  it('delegates to accountDeletion service when wired', async () => {
    const calls: unknown[] = [];
    const app = mount({
      accountDeletion: {
        async requestSelfDeletion(args) {
          calls.push(args);
          return {
            deletionRequestId: 'svc-req-123',
            scheduledPurgeAt: '2026-06-19T10:00:00.000Z',
          };
        },
      },
    });
    const res = await app.request('/users/me', {
      method: 'DELETE',
      headers: {
        Authorization: bearer(UserRole.RESIDENT, 'usr-del'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: 'changed-my-mind' }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { deletionRequestId: string } };
    expect(body.data.deletionRequestId).toBe('svc-req-123');
    expect(calls.length).toBe(1);
  });
});
