/**
 * safeHttpFetch — D9 SSRF-allowlist tests.
 *
 * The tests inject a stub `fetchImpl` so no real network call is made.
 * They verify:
 *   - internal IPs / hostnames are denied
 *   - schemes / ports outside the allowlist are denied
 *   - allowlist exact match + suffix match work
 *   - timeout aborts produce a typed error
 *   - hostnames OUTSIDE the allowlist are denied even when they would
 *     otherwise be public
 */

import { describe, it, expect } from 'vitest';
import {
  safeHttpFetch,
  SafeHttpFetchError,
  __internals,
} from './safe-http-fetch';

const stubFetch = async (_url: string, init?: RequestInit) =>
  new Response('ok', {
    status: 200,
    headers: { 'content-type': 'text/plain' },
  });

describe('safeHttpFetch — scheme + port gating', () => {
  it('rejects file:// URLs', async () => {
    await expect(
      safeHttpFetch('file:///etc/passwd', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toBeInstanceOf(SafeHttpFetchError);
  });

  it('rejects gopher:// URLs', async () => {
    await expect(
      safeHttpFetch('gopher://example.com', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/unsupported-scheme/);
  });

  it('rejects non-standard ports', async () => {
    await expect(
      safeHttpFetch('http://example.com:8080', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/denied-port/);
  });
});

describe('safeHttpFetch — internal-IP denylist', () => {
  it('rejects loopback IPv4', async () => {
    await expect(
      safeHttpFetch('http://127.0.0.1/admin', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects RFC1918 10.x.x.x', async () => {
    await expect(
      safeHttpFetch('http://10.0.0.5/x', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects 192.168.x.x', async () => {
    await expect(
      safeHttpFetch('http://192.168.1.1/', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects AWS metadata IP 169.254.169.254', async () => {
    await expect(
      safeHttpFetch('http://169.254.169.254/latest/meta-data/', {
        fetchImpl: stubFetch as typeof fetch,
      }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects localhost name', async () => {
    await expect(
      safeHttpFetch('http://localhost/x', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects *.internal', async () => {
    await expect(
      safeHttpFetch('http://api.internal/x', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects IPv6 loopback', async () => {
    await expect(
      safeHttpFetch('http://[::1]/x', { fetchImpl: stubFetch as typeof fetch }),
    ).rejects.toThrow(/denied-internal-ip/);
  });
});

describe('safeHttpFetch — allowlist', () => {
  it('allows host matching the allowlist exactly', async () => {
    const r = await safeHttpFetch('https://api.stripe.com/v1/charges', {
      fetchImpl: stubFetch as typeof fetch,
      allowlist: ['api.stripe.com'],
    });
    expect(r.status).toBe(200);
  });

  it('rejects host not in allowlist', async () => {
    await expect(
      safeHttpFetch('https://attacker.example/x', {
        fetchImpl: stubFetch as typeof fetch,
        allowlist: ['api.stripe.com'],
      }),
    ).rejects.toThrow(/denied-not-in-allowlist/);
  });

  it('allows subdomain via suffix entry', async () => {
    const r = await safeHttpFetch('https://us-east.compute.amazonaws.com/x', {
      fetchImpl: stubFetch as typeof fetch,
      allowlist: ['amazonaws.com'],
    });
    expect(r.status).toBe(200);
  });
});

describe('safeHttpFetch — timeout + dispatch', () => {
  it('passes method + body to the underlying fetch', async () => {
    let receivedInit: RequestInit | undefined;
    const captured = async (_url: string, init?: RequestInit) => {
      receivedInit = init;
      // 200 (not 204 — a 204 No Content with a non-null body is an invalid
      // Response under strict undici and throws at construction).
      return new Response('', { status: 200 });
    };
    await safeHttpFetch('https://api.example.com/path', {
      fetchImpl: captured as typeof fetch,
      allowlist: ['api.example.com'],
      method: 'POST',
      body: '{"ok":true}',
      headers: { 'content-type': 'application/json' },
    });
    expect(receivedInit?.method).toBe('POST');
    expect(receivedInit?.body).toBe('{"ok":true}');
  });

  it('produces a typed timeout error', async () => {
    const slowFetch = (
      _url: string,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    await expect(
      safeHttpFetch('https://api.example.com/slow', {
        fetchImpl: slowFetch as unknown as typeof fetch,
        allowlist: ['api.example.com'],
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/timeout/);
  });
});

describe('safeHttpFetch — redirect re-screening (SSRF)', () => {
  it('does NOT auto-follow: init.redirect is manual on the underlying fetch', async () => {
    let receivedInit: RequestInit | undefined;
    const captured = async (_url: string, init?: RequestInit) => {
      receivedInit = init;
      return new Response('ok', { status: 200 });
    };
    await safeHttpFetch('https://api.example.com/x', {
      fetchImpl: captured as typeof fetch,
      allowlist: ['api.example.com'],
    });
    expect(receivedInit?.redirect).toBe('manual');
  });

  it('BLOCKS a redirect to an internal host (169.254.169.254)', async () => {
    const redirecting = async (url: string) => {
      if (url === 'https://api.example.com/start') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        });
      }
      return new Response('leaked', { status: 200 });
    };
    await expect(
      safeHttpFetch('https://api.example.com/start', {
        fetchImpl: redirecting as typeof fetch,
        allowlist: ['api.example.com'],
      }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('BLOCKS a redirect to a host outside the allowlist', async () => {
    const redirecting = async (url: string) => {
      if (url === 'https://api.example.com/start') {
        return new Response(null, {
          status: 301,
          headers: { location: 'https://attacker.example/steal' },
        });
      }
      return new Response('leaked', { status: 200 });
    };
    await expect(
      safeHttpFetch('https://api.example.com/start', {
        fetchImpl: redirecting as typeof fetch,
        allowlist: ['api.example.com'],
      }),
    ).rejects.toThrow(/denied-not-in-allowlist/);
  });

  it('FOLLOWS a redirect to an allowed host and returns its response', async () => {
    const seen: string[] = [];
    const redirecting = async (url: string) => {
      seen.push(url);
      if (url === 'https://api.example.com/start') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://api.example.com/final' },
        });
      }
      return new Response('final-body', { status: 200 });
    };
    const r = await safeHttpFetch('https://api.example.com/start', {
      fetchImpl: redirecting as typeof fetch,
      allowlist: ['api.example.com'],
    });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('final-body');
    expect(seen).toEqual([
      'https://api.example.com/start',
      'https://api.example.com/final',
    ]);
  });

  it('rejects when the redirect chain exceeds maxRedirects', async () => {
    const looping = async (_url: string) =>
      new Response(null, {
        status: 302,
        headers: { location: 'https://api.example.com/next' },
      });
    await expect(
      safeHttpFetch('https://api.example.com/start', {
        fetchImpl: looping as typeof fetch,
        allowlist: ['api.example.com'],
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/too-many-redirects/);
  });

  it('maxRedirects=0 rejects any redirect outright', async () => {
    const redirecting = async (_url: string) =>
      new Response(null, {
        status: 307,
        headers: { location: 'https://api.example.com/final' },
      });
    await expect(
      safeHttpFetch('https://api.example.com/start', {
        fetchImpl: redirecting as typeof fetch,
        allowlist: ['api.example.com'],
        maxRedirects: 0,
      }),
    ).rejects.toThrow(/too-many-redirects/);
  });
});

describe('safeHttpFetch — internals', () => {
  it('isInternalHost detects ULA IPv6', () => {
    expect(__internals.isInternalHost('fd00::1')).toBe(true);
  });
  it('isInternalHost ignores public IPv4', () => {
    expect(__internals.isInternalHost('8.8.8.8')).toBe(false);
  });
  it('matchesAllowlist returns true for empty allowlist', () => {
    expect(__internals.matchesAllowlist('public.example', [])).toBe(true);
  });
});
