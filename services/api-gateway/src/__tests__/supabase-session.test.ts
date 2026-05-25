/**
 * Tests for the Supabase session helpers (refresh, rotation policy,
 * cookie shape).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  rotateSession,
  shouldRotate,
  buildSessionCookie,
  SupabaseSessionError,
} from '../auth/supabase/supabase-session.js';

const CONFIG = {
  url: 'https://example.supabase.co',
  anonKey: 'anon-key-not-used-by-mock-just-for-shape-validation',
};

describe('rotateSession', () => {
  it('returns a parsed session on 200', async () => {
    const fakeResponse = {
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: 'u-1', email: 'a@b.co' },
    };
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify(fakeResponse), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const session = await rotateSession('refresh-token-here', CONFIG, fetchImpl);
    expect(session.access_token).toBe('new-access');
    expect(session.refresh_token).toBe('new-refresh');
    expect(session.user.id).toBe('u-1');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = (fetchImpl.mock.calls[0]?.[0] ?? '') as string;
    expect(url).toContain('/auth/v1/token?grant_type=refresh_token');
  });

  it('throws SupabaseSessionError on missing refresh token', async () => {
    await expect(rotateSession('', CONFIG)).rejects.toThrow(SupabaseSessionError);
  });

  it('throws SupabaseSessionError on non-2xx', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('bad refresh', {
          status: 400,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    await expect(rotateSession('bad', CONFIG, fetchImpl)).rejects.toThrow(
      SupabaseSessionError,
    );
  });

  it('throws on malformed body (schema mismatch)', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{"oops":true}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    await expect(rotateSession('ok', CONFIG, fetchImpl)).rejects.toThrow(
      SupabaseSessionError,
    );
  });
});

describe('shouldRotate', () => {
  it('returns true when token expires within margin', () => {
    const now = () => 1000;
    expect(shouldRotate(1030, 60, now)).toBe(true); // expires in 30s, margin 60s
  });

  it('returns false when token has lots of life left', () => {
    const now = () => 1000;
    expect(shouldRotate(2000, 60, now)).toBe(false);
  });

  it('boundary: equal margin returns true', () => {
    const now = () => 1000;
    expect(shouldRotate(1060, 60, now)).toBe(true);
  });
});

describe('buildSessionCookie', () => {
  it('sets HttpOnly + SameSite + Path defaults', () => {
    const c = buildSessionCookie({ name: 'sb-session', value: 'v' });
    expect(c).toContain('sb-session=v');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
  });

  it('URL-encodes the value', () => {
    const c = buildSessionCookie({ name: 'sb', value: 'a b/c' });
    expect(c).toContain('sb=a%20b%2Fc');
  });

  it('respects custom maxAge + domain', () => {
    const c = buildSessionCookie({
      name: 'sb',
      value: 'x',
      maxAgeSeconds: 120,
      domain: 'borjie.com',
    });
    expect(c).toContain('Max-Age=120');
    expect(c).toContain('Domain=borjie.com');
  });
});
