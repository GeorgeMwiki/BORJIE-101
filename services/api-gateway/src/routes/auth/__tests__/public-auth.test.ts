/**
 * Tests for the public auth router — `/sign-in` + `/sign-out`.
 *
 * Covers:
 *   - 200 happy path returns session + sets borjie-session cookie
 *   - 401 INVALID_CREDENTIALS on Supabase invalid_credentials
 *   - 503 PROVIDER_UNAVAILABLE on Supabase outage
 *   - 400 INVALID_BODY when JSON / schema is wrong
 *   - 429 RATE_LIMITED after 5 failed attempts (lockout)
 *   - sign-out clears the cookie + calls supabase logout
 *   - audit-chain receives both success + failure events
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';

import {
  createPublicAuthRouter,
  createInMemorySignInLimiter,
  type PublicAuthDeps,
  type SupabaseSignInResult,
} from '../public-auth.hono';
import {
  SESSION_COOKIE_NAME,
  decodeSessionCookie,
} from '../../../auth/public/session-cookie';

beforeAll(() => {
  // Required so encodeSessionCookie does not throw.
  process.env.COOKIE_SECRET =
    'test-cookie-secret-at-least-16-chars-long-1234';
});

interface RecordedAudit {
  readonly event: string;
  readonly outcome: 'success' | 'failure';
  readonly email: string;
  readonly reason?: string | undefined;
}

interface Stubs {
  readonly deps: PublicAuthDeps;
  readonly audit: RecordedAudit[];
  readonly signOutCalls: string[];
}

function buildStubs(overrides: { signIn?: SupabaseSignInResult } = {}): Stubs {
  const audit: RecordedAudit[] = [];
  const signOutCalls: string[] = [];
  const deps: PublicAuthDeps = {
    async signInWithPassword(input) {
      return (
        overrides.signIn ?? {
          ok: true,
          accessToken: `at_${input.email}`,
          refreshToken: `rt_${input.email}`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: `uid_${input.email}`,
            email: input.email,
            tenantId: 'tn_test_1',
            role: 'owner',
          },
        }
      );
    },
    async signOut(input) {
      signOutCalls.push(input.accessToken);
    },
    async recordAuditEvent(evt) {
      audit.push({
        event: evt.event,
        outcome: evt.outcome,
        email: evt.email,
        reason: evt.reason,
      });
    },
    registerAttempt: createInMemorySignInLimiter(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { deps, audit, signOutCalls };
}

function mount(deps: PublicAuthDeps): Hono {
  const app = new Hono();
  app.route('/api/v1/auth', createPublicAuthRouter(deps));
  return app;
}

async function post(
  app: Hono,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any; setCookie: string | null }> {
  const res = await app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': '198.51.100.1',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? JSON.parse(text) : null,
    setCookie: res.headers.get('Set-Cookie'),
  };
}

describe('POST /api/v1/auth/sign-in', () => {
  it('returns 200 with session + sets borjie-session cookie on success', async () => {
    const stubs = buildStubs();
    const app = mount(stubs.deps);
    const r = await post(app, '/api/v1/auth/sign-in', {
      email: 'owner@borjie.test',
      password: 'CorrectHorseBattery1!',
    });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.user.id).toBe('uid_owner@borjie.test');
    expect(r.body.session.access_token).toBe('at_owner@borjie.test');
    expect(r.body.session.refresh_token).toBe('rt_owner@borjie.test');
    expect(r.setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(r.setCookie).toContain('HttpOnly');
    expect(r.setCookie).toContain('SameSite=Lax');
  });

  it('cookie decodes back to the original session', async () => {
    const stubs = buildStubs();
    const app = mount(stubs.deps);
    const r = await post(app, '/api/v1/auth/sign-in', {
      email: 'asha@borjie.test',
      password: 'StrongPass1234!',
    });
    expect(r.setCookie).not.toBeNull();
    // Extract the cookie value (between `=` and `;`).
    const match = /borjie-session=([^;]+)/.exec(r.setCookie!);
    expect(match).not.toBeNull();
    const decoded = decodeSessionCookie(decodeURIComponent(match![1]!));
    expect(decoded?.userId).toBe('uid_asha@borjie.test');
    expect(decoded?.tenantId).toBe('tn_test_1');
  });

  it('returns 401 INVALID_CREDENTIALS on Supabase invalid_credentials', async () => {
    const stubs = buildStubs({
      signIn: { ok: false, reason: 'invalid_credentials' },
    });
    const app = mount(stubs.deps);
    const r = await post(app, '/api/v1/auth/sign-in', {
      email: 'owner@borjie.test',
      password: 'WrongPassword12!',
    });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(r.setCookie).toBeNull();
  });

  it('returns 503 PROVIDER_UNAVAILABLE when Supabase is down', async () => {
    const stubs = buildStubs({
      signIn: { ok: false, reason: 'provider_unavailable' },
    });
    const app = mount(stubs.deps);
    const r = await post(app, '/api/v1/auth/sign-in', {
      email: 'owner@borjie.test',
      password: 'StrongPass1234!',
    });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('returns 400 INVALID_BODY for malformed JSON', async () => {
    const stubs = buildStubs();
    const app = mount(stubs.deps);
    const r = await post(app, '/api/v1/auth/sign-in', 'not-json');
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_BODY');
  });

  it('returns 400 INVALID_BODY when password is too short', async () => {
    const stubs = buildStubs();
    const app = mount(stubs.deps);
    const r = await post(app, '/api/v1/auth/sign-in', {
      email: 'owner@borjie.test',
      password: 'short',
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_BODY');
  });

  it('locks out the IP after 5 failed attempts (429)', async () => {
    const stubs = buildStubs({
      signIn: { ok: false, reason: 'invalid_credentials' },
    });
    const app = mount(stubs.deps);
    // Trip the limiter — 5 failures then the 6th is locked out.
    for (let i = 0; i < 5; i += 1) {
      const r = await post(app, '/api/v1/auth/sign-in', {
        email: 'attacker@borjie.test',
        password: 'WrongPass1234!',
      });
      expect(r.status).toBe(401);
    }
    const r6 = await post(app, '/api/v1/auth/sign-in', {
      email: 'attacker@borjie.test',
      password: 'WrongPass1234!',
    });
    expect(r6.status).toBe(429);
    expect(r6.body.error.code).toBe('RATE_LIMITED');
  });

  it('records audit events for both success and failure', async () => {
    const stubs1 = buildStubs();
    const app1 = mount(stubs1.deps);
    await post(app1, '/api/v1/auth/sign-in', {
      email: 'a@borjie.test',
      password: 'StrongPass1234!',
    });
    expect(stubs1.audit.some((a) => a.event === 'auth.sign_in' && a.outcome === 'success')).toBe(true);

    const stubs2 = buildStubs({
      signIn: { ok: false, reason: 'invalid_credentials' },
    });
    const app2 = mount(stubs2.deps);
    await post(app2, '/api/v1/auth/sign-in', {
      email: 'b@borjie.test',
      password: 'StrongPass1234!',
    });
    expect(stubs2.audit.some((a) => a.event === 'auth.sign_in' && a.outcome === 'failure')).toBe(true);
  });
});

describe('POST /api/v1/auth/sign-out', () => {
  it('clears the borjie-session cookie and returns 200', async () => {
    const stubs = buildStubs();
    const app = mount(stubs.deps);
    const r = await post(app, '/api/v1/auth/sign-out', {});
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(r.setCookie).toContain('Max-Age=0');
  });

  it('invokes Supabase signOut when a session cookie is present', async () => {
    const stubs = buildStubs();
    const app = mount(stubs.deps);
    // First sign in to get a real cookie.
    const signIn = await post(app, '/api/v1/auth/sign-in', {
      email: 'x@borjie.test',
      password: 'StrongPass1234!',
    });
    const cookieMatch = /borjie-session=([^;]+)/.exec(signIn.setCookie!);
    const cookieValue = cookieMatch![1]!;
    // Sign out with that cookie.
    const r = await post(app, '/api/v1/auth/sign-out', {}, {
      Cookie: `borjie-session=${cookieValue}`,
    });
    expect(r.status).toBe(200);
    expect(stubs.signOutCalls).toEqual(['at_x@borjie.test']);
  });
});
