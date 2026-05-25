/**
 * Unit tests for createMpesaRealAdapter — verifies the production Daraja
 * client surface. All IO mocked. No real network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMpesaRealAdapter,
  type MpesaRealCredentials,
} from '../adapters/mpesa-real.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FULL_CREDS: MpesaRealCredentials = Object.freeze({
  consumerKey: 'ck',
  consumerSecret: 'cs',
  shortCode: '174379',
  passKey: 'pk',
  initiatorName: 'TestInit',
  securityCredential: 'sec-cred',
});

beforeEach(() => {
  vi.useRealTimers();
});

describe('createMpesaRealAdapter — env selection', () => {
  it('defaults to sandbox base url', () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    expect(adapter.env).toBe('sandbox');
    expect(adapter.connector.id).toBe('mpesa-real');
  });

  it('selects production base url when env=production', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M1',
          CheckoutRequestID: 'C1',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const adapter = createMpesaRealAdapter({
      env: 'production',
      credentials: FULL_CREDS,
      fetch: fetchMock,
    });
    await adapter.stkPush({
      amount: 100,
      msisdn: '0712345678',
      accountReference: 'ref',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });
    const url0 = fetchMock.mock.calls[0]?.[0] as string;
    expect(url0.startsWith('https://api.safaricom.co.ke')).toBe(true);
  });

  it('refuses to construct without consumerKey/Secret', () => {
    expect(() =>
      createMpesaRealAdapter({
        credentials: { ...FULL_CREDS, consumerKey: '' },
        fetch: vi.fn(),
      }),
    ).toThrowError(/consumerKey/);
  });
});

describe('createMpesaRealAdapter — OAuth token caching', () => {
  it('fetches token on first call, caches for subsequent calls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-1', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M1',
          CheckoutRequestID: 'C1',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M2',
          CheckoutRequestID: 'C2',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });

    await adapter.stkPush({
      amount: 100,
      msisdn: '0712345678',
      accountReference: 'ref',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });
    await adapter.stkPush({
      amount: 200,
      msisdn: '0712345678',
      accountReference: 'ref2',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });

    // 1 oauth + 2 stk-push calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(firstUrl).toContain('/oauth/v1/generate');
    expect(adapter.tokenExpiryMs()).not.toBeNull();
  });

  it('refetches token when expired', async () => {
    let nowMs = 1_000_000;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-1', expires_in: 60 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M1',
          CheckoutRequestID: 'C1',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok-2', expires_in: 60 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M2',
          CheckoutRequestID: 'C2',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const adapter = createMpesaRealAdapter({
      credentials: FULL_CREDS,
      fetch: fetchMock,
      clock: () => nowMs,
    });

    await adapter.stkPush({
      amount: 100,
      msisdn: '0712345678',
      accountReference: 'ref',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });
    nowMs += 120_000; // advance past expiry
    await adapter.stkPush({
      amount: 200,
      msisdn: '0712345678',
      accountReference: 'ref',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('createMpesaRealAdapter — STK push', () => {
  it('refuses with unconfigured when passKey missing', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaRealAdapter({
      credentials: { ...FULL_CREDS, passKey: undefined },
      fetch: fetchMock,
    });
    const out = await adapter.stkPush({
      amount: 100,
      msisdn: '0712345678',
      accountReference: 'ref',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });
    expect(out.kind).toBe('unconfigured');
  });

  it('returns validation-failed for invalid msisdn', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    const out = await adapter.stkPush({
      amount: 100,
      msisdn: 'not-a-phone',
      accountReference: 'ref',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });
    expect(out.kind).toBe('validation-failed');
  });

  it('passes Bearer token + Idempotency-Key on STK push', async () => {
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
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    const out = await adapter.stkPush(
      {
        amount: 100,
        msisdn: '+254712345678',
        accountReference: 'ref',
        transactionDesc: 'rent',
        callbackUrl: 'https://x.test/cb',
      },
      'idem-1',
    );
    expect(out.kind).toBe('ok');
    const init = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.['Authorization']).toBe('Bearer tok-xyz');
    expect(headers?.['Idempotency-Key']).toBe('idem-1');
    const body = JSON.parse((init?.body as string) ?? '{}');
    expect(body.PhoneNumber).toMatch(/^254/);
  });
});

describe('createMpesaRealAdapter — C2B', () => {
  it('registerC2bUrl POSTs to the correct path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, { ResponseDescription: 'success', ResponseCode: '0' }),
      );
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    const out = await adapter.registerC2bUrl({
      responseType: 'Completed',
      confirmationUrl: 'https://x.test/conf',
      validationUrl: 'https://x.test/val',
    });
    expect(out.kind).toBe('ok');
    const url = fetchMock.mock.calls[1]?.[0] as string;
    expect(url).toContain('/mpesa/c2b/v2/registerurl');
  });

  it('parseC2bCallback accepts a well-formed Daraja webhook body', () => {
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: vi.fn() });
    const parsed = adapter.parseC2bCallback({
      TransactionType: 'Pay Bill',
      TransID: 'NLJ7RT61SV',
      TransTime: '20191122063845',
      TransAmount: '10.00',
      BusinessShortCode: '600638',
      BillRefNumber: 'AccountRef',
      MSISDN: '254708374149',
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.TransID).toBe('NLJ7RT61SV');
    }
  });

  it('parseC2bCallback rejects malformed payload', () => {
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: vi.fn() });
    const parsed = adapter.parseC2bCallback({ random: 'shape' });
    expect(parsed.ok).toBe(false);
  });
});

describe('createMpesaRealAdapter — B2C / status / balance', () => {
  it('B2C refuses with unconfigured when initiator credentials missing', async () => {
    const fetchMock = vi.fn();
    const adapter = createMpesaRealAdapter({
      credentials: { ...FULL_CREDS, securityCredential: undefined },
      fetch: fetchMock,
    });
    const out = await adapter.payB2c({
      amount: 100,
      msisdn: '0712345678',
      commandId: 'BusinessPayment',
      remarks: 'payout',
      queueTimeoutUrl: 'https://x.test/timeout',
      resultUrl: 'https://x.test/result',
    });
    expect(out.kind).toBe('unconfigured');
  });

  it('B2C posts to v3 paymentrequest with token bearer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ConversationID: 'AG1',
          OriginatorConversationID: 'OG1',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    const out = await adapter.payB2c({
      amount: 1500,
      msisdn: '0712345678',
      commandId: 'BusinessPayment',
      remarks: 'payout',
      queueTimeoutUrl: 'https://x.test/timeout',
      resultUrl: 'https://x.test/result',
    });
    expect(out.kind).toBe('ok');
    const url = fetchMock.mock.calls[1]?.[0] as string;
    expect(url).toContain('/mpesa/b2c/v3/paymentrequest');
  });

  it('queryTransactionStatus posts to status query path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ConversationID: 'AG1',
          OriginatorConversationID: 'OG1',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    const out = await adapter.queryTransactionStatus({
      transactionId: 'TX123',
      remarks: 'status',
      queueTimeoutUrl: 'https://x.test/timeout',
      resultUrl: 'https://x.test/result',
    });
    expect(out.kind).toBe('ok');
    const url = fetchMock.mock.calls[1]?.[0] as string;
    expect(url).toContain('/mpesa/transactionstatus/v1/query');
  });

  it('queryAccountBalance posts to balance query path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'tok', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ConversationID: 'AG1',
          OriginatorConversationID: 'OG1',
          ResponseCode: '0',
          ResponseDescription: 'ok',
        }),
      );
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    const out = await adapter.queryAccountBalance({
      remarks: 'balance',
      queueTimeoutUrl: 'https://x.test/timeout',
      resultUrl: 'https://x.test/result',
    });
    expect(out.kind).toBe('ok');
    const url = fetchMock.mock.calls[1]?.[0] as string;
    expect(url).toContain('/mpesa/accountbalance/v1/query');
  });
});

describe('createMpesaRealAdapter — full STK round-trip', () => {
  it('completes oauth → stk-push and surfaces upstream body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'AT', expires_in: 3599 }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          MerchantRequestID: 'M-99',
          CheckoutRequestID: 'C-99',
          ResponseCode: '0',
          ResponseDescription: 'Success',
          CustomerMessage: 'Pay now',
        }),
      );
    const adapter = createMpesaRealAdapter({ credentials: FULL_CREDS, fetch: fetchMock });
    const out = await adapter.stkPush({
      amount: 250,
      msisdn: '0712345678',
      accountReference: 'unit-1',
      transactionDesc: 'rent',
      callbackUrl: 'https://x.test/cb',
    });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data.MerchantRequestID).toBe('M-99');
      expect(out.data.ResponseCode).toBe('0');
    }
  });
});
