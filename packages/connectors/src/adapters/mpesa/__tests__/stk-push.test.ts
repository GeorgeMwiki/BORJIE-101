/**
 * stk-push — Daraja STK Push initiation.
 *
 * Covers helper purity (timestamp / msisdn / password / callback URL)
 * and the wire-level shape of the POST request.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildStkPushPassword,
  isoTimestampEAT,
  initiateStkPush,
  normaliseMsisdn,
  resolveCallbackUrl,
} from '../stk-push.js';
import { createMpesaClient } from '../mpesa-client.js';
import type { MpesaCredentials } from '../types.js';

const CREDS: MpesaCredentials = Object.freeze({
  consumerKey: 'ck',
  consumerSecret: 'cs',
  shortCode: '174379',
  passKey: 'PK',
  callbackBaseUrl: 'https://api.borjie.test',
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('normaliseMsisdn', () => {
  it('strips +254 prefix', () => {
    expect(normaliseMsisdn('+254712345678')).toBe('254712345678');
  });

  it('replaces leading 0 with 254', () => {
    expect(normaliseMsisdn('0712345678')).toBe('254712345678');
  });

  it('prepends 254 to a bare local number starting with 7', () => {
    expect(normaliseMsisdn('712345678')).toBe('254712345678');
  });

  it('passes through 254-prefixed input', () => {
    expect(normaliseMsisdn('254712345678')).toBe('254712345678');
  });
});

describe('isoTimestampEAT', () => {
  it('produces YYYYMMDDHHMMSS in EAT (UTC+3)', () => {
    // 2026-01-01T00:00:00Z → EAT 2026-01-01T03:00:00 → "20260101030000"
    const ts = isoTimestampEAT(() => Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(ts).toBe('20260101030000');
  });

  it('is exactly 14 chars', () => {
    expect(isoTimestampEAT(() => Date.now())).toHaveLength(14);
  });
});

describe('buildStkPushPassword', () => {
  it('is base64(shortCode + passKey + timestamp)', () => {
    const got = buildStkPushPassword('174379', 'PK', '20260101030000');
    const expected = Buffer.from('174379PK20260101030000', 'utf8').toString('base64');
    expect(got).toBe(expected);
  });
});

describe('resolveCallbackUrl', () => {
  it('defaults to base + /webhooks/mpesa/stk', () => {
    expect(resolveCallbackUrl('https://api.borjie.test')).toBe(
      'https://api.borjie.test/webhooks/mpesa/stk',
    );
  });

  it('strips trailing slash from base', () => {
    expect(resolveCallbackUrl('https://api.borjie.test/')).toBe(
      'https://api.borjie.test/webhooks/mpesa/stk',
    );
  });

  it('honours explicit override', () => {
    expect(
      resolveCallbackUrl('https://api.borjie.test', 'https://override.test/cb'),
    ).toBe('https://override.test/cb');
  });
});

describe('initiateStkPush — wire shape', () => {
  it('POSTs to processrequest with normalised phone + Bearer token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-xyz', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M',
          CheckoutRequestID: 'C',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const client = createMpesaClient({ credentials: CREDS, fetch: fetchMock });
    const out = await initiateStkPush(
      { client },
      {
        amount: 1500,
        msisdn: '+254712345678',
        accountReference: 'unit-A1',
        transactionDesc: 'rent',
      },
      'idem-k1',
    );
    expect(out.kind).toBe('ok');
    const url = fetchMock.mock.calls[1]?.[0] as string;
    expect(url).toContain('/mpesa/stkpush/v1/processrequest');
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok-xyz');
    expect(headers['Idempotency-Key']).toBe('idem-k1');
    const body = JSON.parse(init.body as string);
    expect(body.PhoneNumber).toBe('254712345678');
    expect(body.PartyA).toBe('254712345678');
    expect(body.PartyB).toBe('174379');
    expect(body.BusinessShortCode).toBe('174379');
    expect(body.AccountReference).toBe('unit-A1');
    expect(body.TransactionDesc).toBe('rent');
    expect(body.Amount).toBe(1500);
    expect(body.TransactionType).toBe('CustomerPayBillOnline');
    expect(typeof body.Password).toBe('string');
    expect(body.Password.length).toBeGreaterThan(0);
    expect(body.CallBackURL).toBe('https://api.borjie.test/webhooks/mpesa/stk');
  });

  it('uses default callback URL when input omits it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M',
          CheckoutRequestID: 'C',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const client = createMpesaClient({ credentials: CREDS, fetch: fetchMock });
    const out = await initiateStkPush(
      { client },
      {
        amount: 100,
        msisdn: '0712345678',
        accountReference: 'r1',
        transactionDesc: 'rent',
      },
    );
    expect(out.kind).toBe('ok');
    const body = JSON.parse(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).body as string,
    );
    expect(body.CallBackURL).toBe('https://api.borjie.test/webhooks/mpesa/stk');
  });

  it('returns validation-failed for bad msisdn', async () => {
    const fetchMock = vi.fn();
    const client = createMpesaClient({ credentials: CREDS, fetch: fetchMock });
    const out = await initiateStkPush(
      { client },
      {
        amount: 100,
        msisdn: 'not-a-phone',
        accountReference: 'r1',
        transactionDesc: 'rent',
      },
    );
    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns validation-failed for non-integer amount', async () => {
    const fetchMock = vi.fn();
    const client = createMpesaClient({ credentials: CREDS, fetch: fetchMock });
    const out = await initiateStkPush(
      { client },
      {
        amount: 100.5,
        msisdn: '0712345678',
        accountReference: 'r1',
        transactionDesc: 'rent',
      },
    );
    expect(out.kind).toBe('validation-failed');
  });
});

describe('createMpesaClient — guards', () => {
  it('throws when consumerKey missing', () => {
    expect(() =>
      createMpesaClient({
        credentials: { ...CREDS, consumerKey: '' },
        fetch: vi.fn(),
      }),
    ).toThrow(/consumerKey/);
  });

  it('throws when shortCode missing', () => {
    expect(() =>
      createMpesaClient({
        credentials: { ...CREDS, shortCode: '' },
        fetch: vi.fn(),
      }),
    ).toThrow(/shortCode/);
  });

  it('throws when callbackBaseUrl missing', () => {
    expect(() =>
      createMpesaClient({
        credentials: { ...CREDS, callbackBaseUrl: '' },
        fetch: vi.fn(),
      }),
    ).toThrow(/callbackBaseUrl/);
  });

  it('defaults to sandbox base URL', () => {
    const c = createMpesaClient({ credentials: CREDS, fetch: vi.fn() });
    expect(c.env).toBe('sandbox');
    expect(c.baseUrl).toBe('https://sandbox.safaricom.co.ke');
  });

  it('selects production base URL when env=production', () => {
    const c = createMpesaClient({
      env: 'production',
      credentials: CREDS,
      fetch: vi.fn(),
    });
    expect(c.baseUrl).toBe('https://api.safaricom.co.ke');
  });
});
