import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ClickPesaProvider } from './clickpesa-provider';

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://api.test/v1',
  webhookSecret: 'shhh',
  merchantId: 'M-001',
};

const originalFetch = globalThis.fetch;

describe('ClickPesaProvider', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('initiates a payment and returns control number', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        controlNumber: '991234567890',
        billReference: 'BILL-001',
        expiresAt: '2026-04-25T00:00:00Z',
        status: 'issued',
      }),
    });
    const provider = new ClickPesaProvider(config);
    const r = await provider.requestPayment({
      invoiceId: 'INV-001',
      amountMinor: 100_000,
      currency: 'TZS',
      payerPhone: '+255712345678',
    });
    expect(r.controlNumber).toBe('991234567890');
    expect(r.provider).toBe('clickpesa');
  });

  it('raises AUTH_FAILED on 401', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });
    const provider = new ClickPesaProvider(config);
    await expect(
      provider.requestPayment({
        invoiceId: 'INV-001',
        amountMinor: 1,
        currency: 'TZS',
        payerPhone: '+255712345678',
      })
    ).rejects.toThrow(/AUTH_FAILED|rejected credentials/);
  });

  it('accepts webhook with correct HMAC signature', () => {
    const provider = new ClickPesaProvider(config);
    const rawBody = '{"controlNumber":"991","status":"paid"}';
    // Expected hex HMAC
    const { createHmac } = require('node:crypto');
    const sig = createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
    expect(provider.verifyWebhookSignature(rawBody, sig)).toBe(true);
    expect(provider.verifyWebhookSignature(rawBody, 'wrong')).toBe(false);
  });
});
