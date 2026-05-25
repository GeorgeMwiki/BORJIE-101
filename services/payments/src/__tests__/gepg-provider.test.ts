import { describe, it, expect, vi } from 'vitest';
import {
  createGepgProvider,
  type GepgConfig,
  type GepgSignatureConfig,
} from '../providers/gepg';
import { signPayloadHmac } from '../providers/gepg/gepg-signature';
import { matchByGepgControlNumber } from '../reconciliation/matcher';

function makeConfig(): GepgConfig {
  return {
    sp: 'SP001',
    spSysId: 'SYS001',
    environment: 'sandbox',
    baseUrl: 'https://sandbox.gepg.tz',
    callbackBaseUrl: 'http://localhost:3000',
    pspMode: true,
  };
}

function makeSigConfig(secret = 'test-secret'): GepgSignatureConfig {
  return { mode: 'hmac-psp', hmacSecret: secret };
}

describe('GepgProvider', () => {
  describe('requestControlNumber', () => {
    it('issues a deterministic sandbox control number', async () => {
      const provider = createGepgProvider({
        config: makeConfig(),
        signatureConfig: makeSigConfig(),
      });
      const r = await provider.requestControlNumber({
        tenantId: 't1',
        invoiceId: 'inv-1',
        billId: 'BILL-1',
        amount: 100_000,
        currency: 'TZS',
        payerName: 'Test Payer',
        description: 'rent',
      });
      expect(r.status).toBe('issued');
      expect(r.billId).toBe('BILL-1');
      expect(r.controlNumber).toMatch(/^\d{12}$/);
    });

    it('fires onControlNumberIssued hook', async () => {
      const hook = vi.fn();
      const provider = createGepgProvider({
        config: makeConfig(),
        signatureConfig: makeSigConfig(),
        onControlNumberIssued: hook,
      });
      await provider.requestControlNumber({
        tenantId: 't1',
        invoiceId: 'inv-1',
        billId: 'BILL-2',
        amount: 500,
        currency: 'TZS',
        payerName: 'A',
        description: 'd',
      });
      expect(hook).toHaveBeenCalledOnce();
    });

    it('validates required fields', async () => {
      const provider = createGepgProvider({
        config: makeConfig(),
        signatureConfig: makeSigConfig(),
      });
      await expect(
        provider.requestControlNumber({
          tenantId: '',
          invoiceId: 'inv',
          billId: 'B',
          amount: 100,
          currency: 'TZS',
          payerName: 'x',
          description: 'd',
        })
      ).rejects.toThrow(/requires tenantId/);
    });
  });

  describe('handleCallback', () => {
    it('accepts callback with valid HMAC signature', async () => {
      const secret = 'topsecret';
      const provider = createGepgProvider({
        config: makeConfig(),
        signatureConfig: makeSigConfig(secret),
      });
      const parsed = {
        controlNumber: '990000000001',
        billId: 'BILL-99',
        paidAmount: 100_000,
        currency: 'TZS',
        paidAt: '2026-01-01T10:00:00Z',
        pspReceiptNumber: 'PSP-1',
        pspChannel: 'mpesa',
      };
      const raw = JSON.stringify(parsed);
      const sig = signPayloadHmac(raw, secret);

      const onReceived = vi.fn();
      const p2 = createGepgProvider({
        config: makeConfig(),
        signatureConfig: makeSigConfig(secret),
        onPaymentReceived: onReceived,
      });
      const result = await p2.handleCallback(raw, sig, parsed);
      expect(result.accepted).toBe(true);
      expect(onReceived).toHaveBeenCalledOnce();
    });

    it('rejects callback with bad signature', async () => {
      const provider = createGepgProvider({
        config: makeConfig(),
        signatureConfig: makeSigConfig('right-secret'),
      });
      const parsed = {
        controlNumber: '990000000002',
        billId: 'BILL-100',
        paidAmount: 1000,
        currency: 'TZS',
        paidAt: '2026-01-01T10:00:00Z',
        pspReceiptNumber: 'PSP-2',
        pspChannel: 'mpesa',
      };
      const raw = JSON.stringify(parsed);
      const sig = signPayloadHmac(raw, 'wrong-secret');
      await expect(
        provider.handleCallback(raw, sig, parsed)
      ).rejects.toThrow(/signature/i);
    });

    it('rejects callback missing signature', async () => {
      const provider = createGepgProvider({
        config: makeConfig(),
        signatureConfig: makeSigConfig('x'),
      });
      await expect(
        provider.handleCallback('{}', undefined, {
          controlNumber: '1',
          billId: 'b',
          paidAmount: 0,
          currency: 'TZS',
          paidAt: '2026-01-01T10:00:00Z',
          pspReceiptNumber: 'r',
          pspChannel: 'x',
        })
      ).rejects.toThrow();
    });
  });
});

describe('matchByGepgControlNumber', () => {
  const basePayment = {
    id: 'p1',
    transactionId: 'tx',
    amount: 100,
    phoneNumber: '254700000000',
    transactionDate: new Date(),
    status: 'pending' as const,
  };
  const baseInvoice = {
    id: 'inv-1',
    tenantId: 't1',
    unitId: 'u1',
    propertyId: 'p1',
    amount: 100,
    balance: 100,
    dueDate: new Date(),
    status: 'pending' as const,
  };

  it('returns exact match when control numbers agree', () => {
    const res = matchByGepgControlNumber(
      { ...basePayment, gepgControlNumber: '990000000001' },
      { ...baseInvoice, gepgControlNumber: '990000000001' }
    );
    expect(res.matched).toBe(true);
    expect(res.confidence).toBe(1);
  });

  it('returns no match on mismatch', () => {
    const res = matchByGepgControlNumber(
      { ...basePayment, gepgControlNumber: '990000000001' },
      { ...baseInvoice, gepgControlNumber: '990000000002' }
    );
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('control_number_mismatch');
  });

  it('returns no match when payment lacks control number', () => {
    const res = matchByGepgControlNumber(basePayment, {
      ...baseInvoice,
      gepgControlNumber: '1',
    });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe('no_control_number_on_payment');
  });

  it('matches even when invoice is already paid (idempotency)', () => {
    const res = matchByGepgControlNumber(
      { ...basePayment, gepgControlNumber: 'CN' },
      { ...baseInvoice, gepgControlNumber: 'CN', status: 'paid', balance: 0 }
    );
    expect(res.matched).toBe(true);
    expect(res.reason).toBe('control_number_match_invoice_already_paid');
  });
});
