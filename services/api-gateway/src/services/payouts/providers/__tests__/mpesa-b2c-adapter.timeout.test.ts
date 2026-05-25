/**
 * Daraja timeout tests for the Mpesa B2C adapter.
 *
 * Why these exist: the production worker dispatches payouts inside an
 * `await adapter.send()`. If Daraja hangs (its sandbox is famously
 * flaky and prod has historically taken >30s on the B2C path during
 * congestion), the worker would hang too — N concurrent payouts ⇒ N
 * stuck consumers ⇒ outbox backs up ⇒ owners don't receive rent. The
 * adapter mitigates this with `AbortSignal.timeout(timeoutMs)` (default
 * 15s, configurable to 60s for the long-tail). DA4 finding: there is
 * NO test that asserts the abort fires when Daraja hangs forever.
 *
 * Strategy: inject a `fetch` that returns a never-resolving promise
 * but listens to the abort signal. When the signal fires, the promise
 * rejects with a DOMException("This operation was aborted") — exactly
 * what real `AbortSignal.timeout()` produces. We use vitest fake
 * timers to advance past the configured timeout deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMpesaB2CAdapter } from '../mpesa-b2c-adapter';
import type { PayoutProviderInput } from '../../stub-payout-provider';

const CONFIG = {
  host: 'sandbox.safaricom.co.ke',
  consumerKey: 'CK_TEST',
  consumerSecret: 'CS_TEST',
  initiatorName: 'BorjieInitiator',
  securityCredential: 'ENCRYPTED_SUPER_SECRET',
  shortcode: '600000',
  queueTimeoutUrl: 'https://example.com/timeout',
  resultUrl: 'https://example.com/result',
  timeoutMs: 60_000, // explicit 60s ceiling per DA4 spec
};

const VALID_INPUT: PayoutProviderInput = {
  tenantId: 'tenant-A',
  ownerId: 'owner-1',
  amountMinor: 750_000,
  currency: 'KES',
  destination: '254712345678',
  idempotencyKey: 'idem-timeout',
};

/**
 * Build a fetch that:
 *   1. Resolves the first call (OAuth) immediately so we get past the
 *      token-fetch happy path and reach the B2C dispatch.
 *   2. On subsequent call(s), returns a promise that NEVER resolves
 *      but rejects when the caller's AbortSignal fires.
 *
 * This is the contract real `AbortSignal.timeout()` produces — fetch
 * rejects with a DOMException whose name is 'AbortError' / 'TimeoutError'.
 */
function makeHangingFetch(opts: { hangOnCall: 'oauth' | 'b2c' }): {
  fn: typeof fetch;
  callCount: () => number;
  abortObserved: () => boolean;
} {
  let callCount = 0;
  let abortObserved = false;

  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    callCount += 1;
    const isOauth = callCount === 1;
    const shouldHang =
      (opts.hangOnCall === 'oauth' && isOauth) ||
      (opts.hangOnCall === 'b2c' && !isOauth);

    if (!shouldHang && isOauth) {
      return new Response(
        JSON.stringify({ access_token: 'tok_test', expires_in: 3599 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Hang forever, but honour the abort signal.
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        // No signal == real bug; we'd hang the test forever. Reject
        // immediately so the assertion catches the missing wiring.
        reject(new Error('test_setup_error: fetch invoked without AbortSignal'));
        return;
      }
      if (signal.aborted) {
        abortObserved = true;
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      signal.addEventListener(
        'abort',
        () => {
          abortObserved = true;
          // Mimic the DOMException Node fetch raises on AbortSignal.timeout.
          // The adapter handles the rejection in its try/catch.
          reject(new DOMException('The operation was aborted', 'TimeoutError'));
        },
        { once: true },
      );
    });
  });

  return {
    fn: fn as unknown as typeof fetch,
    callCount: () => callCount,
    abortObserved: () => abortObserved,
  };
}

describe('createMpesaB2CAdapter — Daraja timeout (AbortController)', () => {
  beforeEach(() => {
    // We DON'T use vi.useFakeTimers() because AbortSignal.timeout()
    // is implemented on top of a real setTimeout in Node, and faking
    // timers globally would interfere with the test framework's own
    // wait primitives. Instead we configure `timeoutMs: 50` for the
    // hanging-OAuth case and use a short real-time bound on the test.
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires AbortController and surfaces a failed result when Daraja B2C hangs > timeout', async () => {
    const { fn, callCount, abortObserved } = makeHangingFetch({ hangOnCall: 'b2c' });
    const adapter = createMpesaB2CAdapter(
      { ...CONFIG, timeoutMs: 50 }, // short timeout for fast test
      { fetch: fn },
    );

    const start = Date.now();
    const result = await adapter.send(VALID_INPUT);
    const elapsed = Date.now() - start;

    expect(result.status).toBe('failed');
    expect(result.failureReason).toMatch(/mpesa_b2c_network_error/i);
    // The error message must reference the abort, not a generic fetch.
    expect(result.failureReason ?? '').toMatch(/abort|timeout/i);
    expect(abortObserved()).toBe(true);
    expect(callCount()).toBe(2); // OAuth + B2C
    // Sanity: the timeout fired well under the configured 60s ceiling.
    // 5s is generous for CI; the timeout itself was set to 50ms.
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);

  it('fires AbortController during OAuth too — token fetch is not exempt', async () => {
    const { fn, callCount, abortObserved } = makeHangingFetch({ hangOnCall: 'oauth' });
    const adapter = createMpesaB2CAdapter(
      { ...CONFIG, timeoutMs: 50 },
      { fetch: fn },
    );

    const start = Date.now();
    const result = await adapter.send(VALID_INPUT);
    const elapsed = Date.now() - start;

    expect(result.status).toBe('failed');
    // OAuth-stage failures land in the oauth bucket.
    expect(result.failureReason).toMatch(/mpesa_oauth_network_error/i);
    expect(result.failureReason ?? '').toMatch(/abort|timeout/i);
    expect(abortObserved()).toBe(true);
    expect(callCount()).toBe(1); // only OAuth was attempted
    expect(elapsed).toBeLessThan(5_000);
  }, 10_000);

  it('passes an AbortSignal on every Daraja fetch (defence-in-depth)', async () => {
    // If a future refactor accidentally drops `signal:` from one of the
    // fetch envelopes, payouts could hang indefinitely in prod. This
    // test asserts the wiring by inspecting the init object passed to
    // fetch.
    const calls: Array<{ url: string; hasSignal: boolean }> = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: typeof url === 'string' ? url : String(url),
        hasSignal: init?.signal instanceof AbortSignal,
      });
      // Respond with the minimum to make both calls succeed.
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 3599 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ ConversationID: 'AG_OK', ResponseCode: '0' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fakeFetch });
    const result = await adapter.send(VALID_INPUT);

    expect(result.status).toBe('completed');
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.hasSignal, `${c.url} fetch missing AbortSignal`).toBe(true);
    }
  });
});
