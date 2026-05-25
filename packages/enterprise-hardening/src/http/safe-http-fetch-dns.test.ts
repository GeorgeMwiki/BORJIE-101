/**
 * safeHttpFetch — A2b-3 wire #3 — DNS resolution + IP-pin tests.
 *
 * Closes the SSRF gap where a string-only host check can't see a
 * hostname whose A-record points to an RFC1918 / link-local address.
 * Examples in the wild:
 *   - `localtest.me` → 127.0.0.1
 *   - DNS-rebinding: first resolution returns a public IP, the second
 *     swaps in 127.0.0.1.
 *
 * We mock `dnsLookup` via the injectable option so these tests stay
 * offline and deterministic.
 */

import { describe, it, expect } from 'vitest';
import type { LookupAddress } from 'node:dns';
import {
  safeHttpFetch,
  SafeHttpFetchError,
} from './safe-http-fetch';

const okFetch = async () =>
  new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });

const lookup = (
  addresses: ReadonlyArray<LookupAddress>,
  onCall?: () => void,
) => {
  let calls = 0;
  const fn = async (_host: string): Promise<ReadonlyArray<LookupAddress>> => {
    calls += 1;
    onCall?.();
    return addresses;
  };
  return {
    fn,
    callCount: () => calls,
  };
};

describe('safeHttpFetch — DNS-resolved IP screening', () => {
  it('rejects a hostname that resolves to 127.0.0.1 (localtest.me)', async () => {
    const dns = lookup([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      safeHttpFetch('https://localtest.me/', {
        fetchImpl: okFetch as typeof fetch,
        dnsLookup: dns.fn,
      }),
    ).rejects.toBeInstanceOf(SafeHttpFetchError);
  });

  it('reports the resolved internal IP in the error', async () => {
    const dns = lookup([{ address: '10.0.0.42', family: 4 }]);
    await expect(
      safeHttpFetch('https://internal-target.example/', {
        fetchImpl: okFetch as typeof fetch,
        dnsLookup: dns.fn,
      }),
    ).rejects.toThrow(/10\.0\.0\.42/);
  });

  it('rejects when the hostname resolves to the EC2 metadata IP', async () => {
    const dns = lookup([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      safeHttpFetch('https://hacker.example/', {
        fetchImpl: okFetch as typeof fetch,
        dnsLookup: dns.fn,
      }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('rejects when an IPv6 resolution is link-local', async () => {
    const dns = lookup([{ address: 'fe80::1', family: 6 }]);
    await expect(
      safeHttpFetch('https://hacker.example/', {
        fetchImpl: okFetch as typeof fetch,
        dnsLookup: dns.fn,
      }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('passes when every resolved address is public', async () => {
    const dns = lookup([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const r = await safeHttpFetch('https://example.com/', {
      fetchImpl: okFetch as typeof fetch,
      dnsLookup: dns.fn,
    });
    expect(r.status).toBe(200);
  });

  it('pins the resolution — calls the DNS lookup at most once per request', async () => {
    const dns = lookup([{ address: '93.184.216.34', family: 4 }]);
    await safeHttpFetch('https://example.com/', {
      fetchImpl: okFetch as typeof fetch,
      dnsLookup: dns.fn,
    });
    // Exactly one DNS round-trip — the fetch layer must reuse the same
    // resolution rather than calling lookup() again (which is how a
    // DNS-rebinding attack would land a second resolution that points
    // to an internal IP).
    expect(dns.callCount()).toBe(1);
  });

  it('rejects even when the first IP in the resolved set is public but a later one is internal', async () => {
    const dns = lookup([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(
      safeHttpFetch('https://multi.example/', {
        fetchImpl: okFetch as typeof fetch,
        dnsLookup: dns.fn,
      }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('does not call DNS for literal IPv4 (already covered by string gate)', async () => {
    const dns = lookup([{ address: '127.0.0.1', family: 4 }]);
    await expect(
      safeHttpFetch('https://8.8.8.8/', {
        fetchImpl: okFetch as typeof fetch,
        dnsLookup: dns.fn,
      }),
    ).resolves.toBeDefined();
    expect(dns.callCount()).toBe(0);
  });

  it('simulates DNS rebinding — only the FIRST resolution is honoured', async () => {
    // Rebinding mock: first call returns a public IP (passes), second
    // call would return 127.0.0.1. Because safeHttpFetch only calls
    // lookup once per request, the second resolution never lands.
    const sequence: ReadonlyArray<LookupAddress>[] = [
      [{ address: '93.184.216.34', family: 4 }],
      [{ address: '127.0.0.1', family: 4 }],
    ];
    let n = 0;
    const dnsLookup = async (
      _host: string,
    ): Promise<ReadonlyArray<LookupAddress>> => {
      const entry = sequence[Math.min(n, sequence.length - 1)];
      n += 1;
      return entry;
    };
    const r = await safeHttpFetch('https://rebinding.example/', {
      fetchImpl: okFetch as typeof fetch,
      dnsLookup,
    });
    expect(r.status).toBe(200);
    expect(n).toBe(1);
  });

  it('does not crash when the resolver throws (degrades to network-error downstream)', async () => {
    const failingLookup = async (): Promise<ReadonlyArray<LookupAddress>> => {
      throw new Error('ENOTFOUND');
    };
    // resolveAndScreen swallows the throw and returns an empty result;
    // the fetch layer then proceeds, and the stub fetch responds 200.
    const r = await safeHttpFetch('https://nxdomain.example/', {
      fetchImpl: okFetch as typeof fetch,
      dnsLookup: failingLookup,
    });
    expect(r.status).toBe(200);
  });
});
