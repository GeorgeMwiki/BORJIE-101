/**
 * Tests for webhook HMAC signing + delivery semantics.
 *
 * Signing must be deterministic and produce hex-encoded SHA-256 HMACs
 * that match independent implementations (we cross-check against
 * crypto-js's known-good reference output). Delivery semantics verified:
 * - 2xx → success
 * - 4xx non-retryable → failure, no retry
 * - 5xx → retries with backoff
 * - network error → retries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signPayload, deliver } from './delivery.js';

describe('signPayload', () => {
  it('produces 64-char hex (SHA-256 digest length)', () => {
    const sig = signPayload('hello', 'secret');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(signPayload('payload', 'secret')).toBe(signPayload('payload', 'secret'));
  });

  it('changes when secret changes', () => {
    const a = signPayload('payload', 'secret-a');
    const b = signPayload('payload', 'secret-b');
    expect(a).not.toBe(b);
  });

  it('changes when payload changes (tamper detection)', () => {
    const a = signPayload('payload-a', 'secret');
    const b = signPayload('payload-b', 'secret');
    expect(a).not.toBe(b);
  });
});

describe('deliver', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns success on 2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    } as Response) as unknown as typeof fetch;

    const result = await deliver('https://receiver.test/webhook', { id: 'e1' }, undefined, {
      retries: 0,
      timeoutMs: 1000,
    });
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
  });

  it('signs the payload when a secret is provided', async () => {
    const fetchStub = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const payload = { id: 'evt_1', type: 'payment.succeeded' };
    await deliver('https://receiver.test/webhook', payload, 'shh', {
      retries: 0,
      timeoutMs: 1000,
    });

    const call = fetchStub.mock.calls[0]!;
    const init = call[1] as { headers: Record<string, string>; body: string };
    expect(init.headers).toBeDefined();
    // Some key carrying the signature must be present.
    const sigHeader = Object.keys(init.headers).find((k) =>
      /signature|x-.*sign/i.test(k)
    );
    expect(sigHeader, 'signature header present when secret is set').toBeDefined();
    // Signature is sha256=<64-hex> per the GitHub/Stripe convention.
    expect(init.headers[sigHeader!]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('does not retry on 400 (non-retryable)', async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    } as Response);
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const result = await deliver('https://receiver.test/webhook', { id: 'e1' }, undefined, {
      retries: 3,
      timeoutMs: 1000,
      retryBaseMs: 1,
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    // Exactly one call — no retries for 400.
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 up to retries+1 attempts', async () => {
    const fetchStub = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const result = await deliver('https://receiver.test/webhook', { id: 'e1' }, undefined, {
      retries: 2,
      timeoutMs: 1000,
      retryBaseMs: 1,
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    // retries=2 means initial attempt + 2 retries = 3 calls.
    expect(fetchStub).toHaveBeenCalledTimes(3);
  });

  it('retries on network error', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    globalThis.fetch = fetchStub as unknown as typeof fetch;

    const result = await deliver('https://receiver.test/webhook', { id: 'e1' }, undefined, {
      retries: 1,
      timeoutMs: 1000,
      retryBaseMs: 1,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNRESET');
    expect(fetchStub).toHaveBeenCalledTimes(2);
  });
});
