/**
 * liveblocks-auth router tests — Central Command Phase B (B6).
 *
 * Coverage:
 *   1. Auth: POST /auth without bearer → 401
 *   2. Validation: missing rooms / bad room shape → 400
 *   3. Tenant scope: requesting a room outside tenant scope → 403
 *   4. Degraded mode: LIVEBLOCKS_SECRET_KEY unset → 503
 *   5. Happy path: 200 + Liveblocks token envelope
 *   6. Cross-kind: caller can request both lease-editing AND
 *      maintenance-thread rooms in the same call
 *   7. Bad-room-format (e.g. random string) → 403
 *   8. Adapter failure → 500 LIVEBLOCKS_SESSION_FAILED
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ||
  'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';
import liveblocksAuthRouter, {
  configureLiveblocksAdapter,
  __resetLiveblocksAdapter,
  type LiveblocksAdapter,
} from '../liveblocks-auth.router';

function bearer(role: UserRole = UserRole.ADMIN, tenantId = 'tnt-1'): string {
  return `Bearer ${generateToken({
    userId: 'usr-1',
    tenantId,
    role: role as never,
    permissions: ['*'],
    propertyAccess: ['*'],
  })}`;
}

function mount(): Hono {
  const app = new Hono();
  app.route('/realtime', liveblocksAuthRouter);
  return app;
}

beforeEach(() => {
  __resetLiveblocksAdapter();
  delete process.env.LIVEBLOCKS_SECRET_KEY;
});

describe('liveblocks-auth router', () => {
  it('rejects POST /auth without a bearer token (401)', async () => {
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_123';
    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rooms: [{ id: 'borjie:lease-editing:tnt-1:lease-42' }],
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on a missing rooms field', async () => {
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_123';
    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when the room belongs to another tenant', async () => {
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_123';
    const adapter: LiveblocksAdapter = {
      prepareSession: vi.fn(async () => ({ token: 'should-not-be-called' })),
    };
    configureLiveblocksAdapter(() => adapter);

    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.ADMIN, 'tnt-1'),
      },
      body: JSON.stringify({
        rooms: [
          { id: 'borjie:lease-editing:tnt-OTHER:lease-42' },
        ],
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('LIVEBLOCKS_ROOM_FORBIDDEN');
    expect(adapter.prepareSession).not.toHaveBeenCalled();
  });

  it('returns 403 on a non-canonical room id', async () => {
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_123';
    configureLiveblocksAdapter(() => ({
      prepareSession: vi.fn(async () => ({ token: 'x' })),
    }));
    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        rooms: [{ id: 'arbitrary-room-name' }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it('returns 503 LIVEBLOCKS_UNAVAILABLE when secret is unset', async () => {
    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        rooms: [{ id: 'borjie:lease-editing:tnt-1:lease-42' }],
      }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('LIVEBLOCKS_UNAVAILABLE');
  });

  it('happy path: mints a token for an in-scope room', async () => {
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_123';
    const prepareSession = vi.fn(async () => ({
      token: 't_eyJhbGciOiJ...',
    }));
    configureLiveblocksAdapter(() => ({ prepareSession }));

    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.ADMIN, 'tnt-7'),
      },
      body: JSON.stringify({
        rooms: [
          {
            id: 'borjie:lease-editing:tnt-7:lease-42',
            access: 'FULL',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { token: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.token).toBe('t_eyJhbGciOiJ...');
    expect(prepareSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'usr-1',
        userInfo: expect.objectContaining({ tenantId: 'tnt-7' }),
        rooms: [
          expect.objectContaining({
            id: 'borjie:lease-editing:tnt-7:lease-42',
            access: 'FULL',
          }),
        ],
      }),
    );
  });

  it('accepts a mixed bundle of lease-editing + maintenance-thread rooms', async () => {
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_123';
    const prepareSession = vi.fn(async () => ({ token: 't_OK' }));
    configureLiveblocksAdapter(() => ({ prepareSession }));

    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(UserRole.ADMIN, 'tnt-3'),
      },
      body: JSON.stringify({
        rooms: [
          { id: 'borjie:lease-editing:tnt-3:lease-1' },
          { id: 'borjie:maintenance-thread:tnt-3:tkt-9' },
        ],
      }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 500 LIVEBLOCKS_SESSION_FAILED when adapter throws', async () => {
    process.env.LIVEBLOCKS_SECRET_KEY = 'sk_test_123';
    configureLiveblocksAdapter(() => ({
      prepareSession: vi.fn(async () => {
        throw new Error('upstream-down');
      }),
    }));

    const res = await mount().request('/realtime/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: bearer(),
      },
      body: JSON.stringify({
        rooms: [{ id: 'borjie:lease-editing:tnt-1:lease-42' }],
      }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('LIVEBLOCKS_SESSION_FAILED');
  });
});
