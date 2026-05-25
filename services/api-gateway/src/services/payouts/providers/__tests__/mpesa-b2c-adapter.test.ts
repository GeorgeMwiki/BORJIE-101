/**
 * Tests for the Mpesa B2C disbursement adapter.
 *
 * Each test exercises one specific failure / success surface. We use
 * a `vi.fn()`-backed `fetch` and inspect the request URL + body to
 * verify wire-shape contracts (headers, OAuth basic auth, JSON
 * envelope, OriginatorConversationID).
 */
import { describe, it, expect, vi } from 'vitest';

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
};

const VALID_INPUT: PayoutProviderInput = {
  tenantId: 'tenant-A',
  ownerId: 'owner-1',
  amountMinor: 750_000, // KES 7,500 (in cents)
  currency: 'KES',
  destination: '254712345678',
  idempotencyKey: 'idem-1',
};

function makeFetchSequence(responses: ReadonlyArray<Response>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i];
    i += 1;
    if (!r) throw new Error('unexpected_extra_fetch_call');
    return r;
  }) as unknown as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// OAuth handling
// ---------------------------------------------------------------------------

describe('createMpesaB2CAdapter — OAuth', () => {
  it('fetches a token then dispatches B2C in two HTTP calls', async () => {
    const fetchImpl = makeFetchSequence([
      jsonResponse(200, { access_token: 'tok_A', expires_in: 3599 }),
      jsonResponse(200, {
        ConversationID: 'AG_20260101_X',
        OriginatorConversationID: 'whatever',
        ResponseCode: '0',
        ResponseDescription: 'Accept the service request successfully.',
      }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send(VALID_INPUT);
    expect(result.status).toBe('completed');
    expect(result.providerRef).toBe('AG_20260101_X');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('caches the token and reuses it across consecutive calls', async () => {
    const fetchImpl = makeFetchSequence([
      jsonResponse(200, { access_token: 'tok_B', expires_in: 3599 }),
      jsonResponse(200, { ConversationID: 'AG_1', ResponseCode: '0' }),
      jsonResponse(200, { ConversationID: 'AG_2', ResponseCode: '0' }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const r1 = await adapter.send({ ...VALID_INPUT, idempotencyKey: 'idem-A' });
    const r2 = await adapter.send({ ...VALID_INPUT, idempotencyKey: 'idem-B' });
    expect(r1.status).toBe('completed');
    expect(r2.status).toBe('completed');
    // Two B2C calls + one OAuth call = 3 total (not 4).
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('refreshes an expired token instead of reusing it', async () => {
    let nowMs = 1_000_000;
    const fetchImpl = makeFetchSequence([
      jsonResponse(200, { access_token: 'tok_short', expires_in: 60 }), // 60s, but skew=60s -> 0
      jsonResponse(200, { ConversationID: 'AG_X', ResponseCode: '0' }),
      jsonResponse(200, { access_token: 'tok_fresh', expires_in: 3599 }),
      jsonResponse(200, { ConversationID: 'AG_Y', ResponseCode: '0' }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, {
      fetch: fetchImpl,
      now: () => nowMs,
    });
    await adapter.send(VALID_INPUT);
    nowMs += 5_000; // advance past the (effective-zero) expiry
    await adapter.send({ ...VALID_INPUT, idempotencyKey: 'idem-2' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('returns failed when OAuth returns 4xx', async () => {
    const fetchImpl = makeFetchSequence([
      jsonResponse(401, { errorCode: '401', errorMessage: 'Invalid Authentication' }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send(VALID_INPUT);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('mpesa_oauth_http_401');
  });

  it('returns failed when the OAuth response has no access_token', async () => {
    const fetchImpl = makeFetchSequence([
      jsonResponse(200, { not_a_token: 'oops' }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send(VALID_INPUT);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('mpesa_oauth_no_access_token');
  });
});

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

describe('createMpesaB2CAdapter — wire shape', () => {
  it('sends Basic auth on OAuth and Bearer on B2C', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) {
        return jsonResponse(200, { access_token: 'TOK', expires_in: 3599 });
      }
      return jsonResponse(200, { ConversationID: 'AG_1', ResponseCode: '0' });
    }) as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    await adapter.send(VALID_INPUT);
    expect(calls[0]?.url).toContain('/oauth/v1/generate?grant_type=client_credentials');
    const oauthAuth = (calls[0]?.init?.headers as Record<string, string> | undefined)?.['Authorization'];
    expect(oauthAuth).toMatch(/^Basic /);
    const expectedBasic = Buffer.from('CK_TEST:CS_TEST').toString('base64');
    expect(oauthAuth).toBe(`Basic ${expectedBasic}`);
    expect(calls[1]?.url).toContain('/mpesa/b2c/v1/paymentrequest');
    const bearer = (calls[1]?.init?.headers as Record<string, string> | undefined)?.['Authorization'];
    expect(bearer).toBe('Bearer TOK');
  });

  it('builds a B2C body with shortcode/initiator/security-credential and minor->major conversion', async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (!captured && String(url).includes('/oauth/')) {
        return jsonResponse(200, { access_token: 'TOK', expires_in: 3599 });
      }
      captured = { url: String(url), init };
      return jsonResponse(200, { ConversationID: 'AG_BODY', ResponseCode: '0' });
    }) as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, {
      fetch: fetchImpl,
      correlationSuffix: () => 'CORR',
    });
    await adapter.send(VALID_INPUT);
    const body = JSON.parse(String((captured?.init?.body) ?? '{}'));
    expect(body.OriginatorConversationID).toBe('idem-1-CORR');
    expect(body.InitiatorName).toBe('BorjieInitiator');
    expect(body.SecurityCredential).toBe('ENCRYPTED_SUPER_SECRET');
    expect(body.CommandID).toBe('BusinessPayment');
    expect(body.Amount).toBe(7_500); // 750_000 cents -> 7,500 KES
    expect(body.PartyA).toBe('600000');
    expect(body.PartyB).toBe('254712345678');
    expect(body.QueueTimeOutURL).toBe('https://example.com/timeout');
    expect(body.ResultURL).toBe('https://example.com/result');
    expect(body.Occasion).toBe('tenant:tenant-A');
  });

  it('strips a leading + from the destination msisdn', async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('/oauth/')) {
        return jsonResponse(200, { access_token: 'TOK', expires_in: 3599 });
      }
      body = JSON.parse(String(init?.body ?? '{}'));
      return jsonResponse(200, { ConversationID: 'AG_PLUS', ResponseCode: '0' });
    }) as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    await adapter.send({ ...VALID_INPUT, destination: '+254712345678' });
    expect(body).not.toBeNull();
    expect((body as { PartyB: string }).PartyB).toBe('254712345678');
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('createMpesaB2CAdapter — validation', () => {
  it('rejects non-KES currencies without an HTTP call', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send({ ...VALID_INPUT, currency: 'TZS' });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('mpesa_b2c_unsupported_currency_TZS');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects negative amounts', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send({ ...VALID_INPUT, amountMinor: -100 });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('mpesa_b2c_invalid_amount');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects fractional-shilling amounts', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send({ ...VALID_INPUT, amountMinor: 750_001 });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('mpesa_b2c_fractional_shilling');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed msisdn', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send({ ...VALID_INPUT, destination: 'owner@example.com' });
    expect(result.status).toBe('failed');
    expect(result.failureReason).toBe('mpesa_b2c_invalid_msisdn');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// HTTP errors
// ---------------------------------------------------------------------------

describe('createMpesaB2CAdapter — HTTP errors', () => {
  it('returns failed on B2C 4xx with the body errorMessage surfaced', async () => {
    const fetchImpl = makeFetchSequence([
      jsonResponse(200, { access_token: 'tok', expires_in: 3599 }),
      jsonResponse(400, { errorCode: '400.002.05', errorMessage: 'Invalid Initiator' }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send(VALID_INPUT);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('mpesa_b2c_http_400');
    expect(result.failureReason).toContain('Invalid Initiator');
  });

  it('returns failed on B2C non-zero ResponseCode', async () => {
    const fetchImpl = makeFetchSequence([
      jsonResponse(200, { access_token: 'tok', expires_in: 3599 }),
      jsonResponse(200, { ResponseCode: '1', ResponseDescription: 'Insufficient funds' }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send(VALID_INPUT);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('mpesa_b2c_rejected_1');
    expect(result.failureReason).toContain('Insufficient funds');
  });

  it('returns failed when the network call throws', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3599 }))
      .mockRejectedValueOnce(new Error('ECONNRESET')) as unknown as typeof fetch;
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send(VALID_INPUT);
    expect(result.status).toBe('failed');
    expect(result.failureReason).toContain('mpesa_b2c_network_error');
    expect(result.failureReason).toContain('ECONNRESET');
  });
});

// ---------------------------------------------------------------------------
// Secret sanitisation
// ---------------------------------------------------------------------------

describe('createMpesaB2CAdapter — secret sanitisation', () => {
  it('redacts the security credential and consumer secret from error messages', async () => {
    const fetchImpl = makeFetchSequence([
      // Make OAuth fail with a body that *contains* the consumer secret.
      jsonResponse(401, {
        errorMessage: `bad creds: CK_TEST:CS_TEST and ENCRYPTED_SUPER_SECRET leaked`,
      }),
    ]);
    const adapter = createMpesaB2CAdapter(CONFIG, { fetch: fetchImpl });
    const result = await adapter.send(VALID_INPUT);
    expect(result.status).toBe('failed');
    const reason = result.failureReason ?? '';
    expect(reason).not.toContain('CS_TEST');
    expect(reason).not.toContain('ENCRYPTED_SUPER_SECRET');
    expect(reason).toContain('***');
  });
});
