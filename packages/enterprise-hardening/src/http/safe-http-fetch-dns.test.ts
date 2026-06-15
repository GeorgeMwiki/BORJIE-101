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
  pinnedSafeDispatcher,
  pinnedConnectLookup,
  SafeHttpFetchError,
} from './safe-http-fetch';

/** Drive a connect-time lookup callback and capture its result. */
const dial = (
  lookup: ReturnType<typeof pinnedConnectLookup>,
  hostname: string,
): Promise<{ address: string; family: number }> =>
  new Promise((resolve, reject) => {
    lookup(hostname, {}, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });

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

  it('screens the host with a single DNS round-trip per request', async () => {
    const dns = lookup([{ address: '93.184.216.34', family: 4 }]);
    await safeHttpFetch('https://example.com/', {
      fetchImpl: okFetch as typeof fetch,
      dnsLookup: dns.fn,
    });
    // The screen path resolves exactly once; the dispatch then PINS that
    // resolution (see the connect-time pin regression below) rather than
    // letting the kernel re-resolve.
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

  it('CONNECT-TIME PIN: the connect lookup returns the screened IP, ignoring the requested hostname (rebind regression)', async () => {
    // The real DNS-rebinding defence: undici calls this connect-time lookup
    // in place of the kernel resolver. It returns ONLY the screened address,
    // so the socket dials EXACTLY what we screened — even when the requested
    // hostname would now rebind to an internal IP, there is no second
    // resolution to poison.
    const lookup = pinnedConnectLookup([{ address: '93.184.216.34', family: 4 }]);
    const dialed = await dial(lookup, 'rebinding.example');
    expect(dialed.address).toBe('93.184.216.34');
    expect(dialed.family).toBe(4);
  });

  it('CONNECT-TIME PIN: belt-and-braces — a poisoned internal pin set errors at connect, never dials', async () => {
    // Even if a caller hands in a poisoned pinned set (all-internal), the
    // connect lookup re-screens and refuses to dial.
    const lookup = pinnedConnectLookup([{ address: '127.0.0.1', family: 4 }]);
    await expect(dial(lookup, 'attacker.example')).rejects.toThrow(/no safe pinned address/);
  });

  it('pinnedSafeDispatcher screens then returns a dispatcher pinned to the screened set', async () => {
    const dns = lookup([{ address: '93.184.216.34', family: 4 }]);
    const dispatcher = await pinnedSafeDispatcher('https://example.com/', {
      dnsLookup: dns.fn,
    });
    expect(dispatcher).toBeDefined();
    expect(dns.callCount()).toBe(1);
    await (dispatcher as unknown as { close: () => Promise<void> }).close();
  });

  it('pinnedSafeDispatcher denies a host that resolves internal (rebind on the screening leg)', async () => {
    const dns = lookup([{ address: '169.254.169.254', family: 4 }]);
    await expect(
      pinnedSafeDispatcher('https://hacker.example/', { dnsLookup: dns.fn }),
    ).rejects.toThrow(/denied-internal-ip/);
  });

  it('pinnedSafeDispatcher returns undefined for a literal IP (already pinned)', async () => {
    const dispatcher = await pinnedSafeDispatcher('https://8.8.8.8/');
    expect(dispatcher).toBeUndefined();
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
