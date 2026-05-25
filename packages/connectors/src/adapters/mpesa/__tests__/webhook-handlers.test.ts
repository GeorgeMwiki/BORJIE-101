/**
 * webhook-handlers — decode + dedupe of Daraja `stkCallback`.
 *
 * Covers:
 *   - Decoding a well-formed success callback.
 *   - Decoding a well-formed failure callback.
 *   - Rejecting malformed callbacks.
 *   - Idempotency on `MpesaReceiptNumber` for success.
 *   - Idempotency on `CheckoutRequestID` for failure.
 *   - Always ACKs 200 (Safaricom retry semantics).
 *   - In-memory idempotency store atomicity.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  decodeStkCallback,
  stkCallbackReceiptKey,
  processStkCallback,
  createInMemoryIdempotencyStore,
} from '../webhook-handlers.js';

function successEnvelope(opts: {
  checkoutRequestId?: string;
  receipt?: string;
  amount?: number;
  phone?: string;
} = {}): unknown {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'M-1',
        CheckoutRequestID: opts.checkoutRequestId ?? 'C-1',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: opts.amount ?? 1500 },
            { Name: 'MpesaReceiptNumber', Value: opts.receipt ?? 'PLR8X9KK0Q' },
            { Name: 'TransactionDate', Value: 20260524181530 },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
      },
    },
  };
}

function failureEnvelope(opts: { checkoutRequestId?: string; resultCode?: number } = {}): unknown {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: 'M-2',
        CheckoutRequestID: opts.checkoutRequestId ?? 'C-2',
        ResultCode: opts.resultCode ?? 1032,
        ResultDesc: 'Request cancelled by user',
      },
    },
  };
}

describe('decodeStkCallback', () => {
  it('decodes a successful callback into the flat shape', () => {
    const r = decodeStkCallback(successEnvelope());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.success).toBe(true);
    expect(r.data.mpesaReceiptNumber).toBe('PLR8X9KK0Q');
    expect(r.data.amount).toBe(1500);
    expect(r.data.checkoutRequestId).toBe('C-1');
    expect(r.data.phoneNumber).toBe('254712345678');
  });

  it('decodes a failure callback (no metadata)', () => {
    const r = decodeStkCallback(failureEnvelope());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.success).toBe(false);
    expect(r.data.resultCode).toBe(1032);
    expect(r.data.mpesaReceiptNumber).toBeUndefined();
  });

  it('rejects malformed payload', () => {
    const r = decodeStkCallback({ random: 'noise' });
    expect(r.ok).toBe(false);
  });

  it('rejects empty / null body', () => {
    expect(decodeStkCallback(null).ok).toBe(false);
    expect(decodeStkCallback(undefined).ok).toBe(false);
    expect(decodeStkCallback({}).ok).toBe(false);
  });

  it('coerces string Amount to number', () => {
    const env = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'M-1',
          CheckoutRequestID: 'C-1',
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: '750' },
              { Name: 'MpesaReceiptNumber', Value: 'REC1' },
            ],
          },
        },
      },
    };
    const r = decodeStkCallback(env);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.amount).toBe(750);
  });
});

describe('stkCallbackReceiptKey', () => {
  it('uses MpesaReceiptNumber on success (prefixed)', () => {
    const r = decodeStkCallback(successEnvelope({ receipt: 'ABC123' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(stkCallbackReceiptKey(r.data)).toBe('mpesa-stk:ABC123');
    }
  });

  it('uses CheckoutRequestID on failure (prefixed)', () => {
    const r = decodeStkCallback(failureEnvelope({ checkoutRequestId: 'C-FAIL-99' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(stkCallbackReceiptKey(r.data)).toBe('mpesa-stk:C-FAIL-99');
    }
  });

  it('falls back to CheckoutRequestID when success but no receipt', () => {
    const env = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'M-1',
          CheckoutRequestID: 'C-NO-REC',
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: { Item: [] },
        },
      },
    };
    const r = decodeStkCallback(env);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(stkCallbackReceiptKey(r.data)).toBe('mpesa-stk:C-NO-REC');
    }
  });
});

describe('processStkCallback — idempotency', () => {
  it('applies on first call, marks duplicate on second (success path, dedupe on receipt)', async () => {
    const store = createInMemoryIdempotencyStore();
    const onPayment = vi.fn();
    const r1 = await processStkCallback(
      { store, onPayment },
      successEnvelope({ receipt: 'RX1', checkoutRequestId: 'C-A' }),
    );
    const r2 = await processStkCallback(
      { store, onPayment },
      successEnvelope({ receipt: 'RX1', checkoutRequestId: 'C-A' }),
    );
    expect(r1.kind).toBe('applied');
    expect(r2.kind).toBe('duplicate');
    expect(onPayment).toHaveBeenCalledTimes(1);
    expect(r1.idempotencyKey).toBe('mpesa-stk:RX1');
    expect(r2.idempotencyKey).toBe('mpesa-stk:RX1');
  });

  it('different receipts both apply (no false dedupe)', async () => {
    const store = createInMemoryIdempotencyStore();
    const onPayment = vi.fn();
    const r1 = await processStkCallback(
      { store, onPayment },
      successEnvelope({ receipt: 'RX1' }),
    );
    const r2 = await processStkCallback(
      { store, onPayment },
      successEnvelope({ receipt: 'RX2' }),
    );
    expect(r1.kind).toBe('applied');
    expect(r2.kind).toBe('applied');
    expect(onPayment).toHaveBeenCalledTimes(2);
  });

  it('failure path dedupes on CheckoutRequestID', async () => {
    const store = createInMemoryIdempotencyStore();
    const onPayment = vi.fn();
    const r1 = await processStkCallback(
      { store, onPayment },
      failureEnvelope({ checkoutRequestId: 'C-FAIL' }),
    );
    const r2 = await processStkCallback(
      { store, onPayment },
      failureEnvelope({ checkoutRequestId: 'C-FAIL' }),
    );
    expect(r1.kind).toBe('applied');
    expect(r2.kind).toBe('duplicate');
    expect(onPayment).toHaveBeenCalledTimes(1);
  });

  it('always returns HTTP 200 with Daraja ack body (incl. decode-error)', async () => {
    const store = createInMemoryIdempotencyStore();
    const onPayment = vi.fn();
    const ok = await processStkCallback({ store, onPayment }, successEnvelope());
    const dup = await processStkCallback({ store, onPayment }, successEnvelope());
    const bad = await processStkCallback({ store, onPayment }, { trash: true });
    for (const r of [ok, dup, bad]) {
      expect(r.httpStatus).toBe(200);
      expect(r.body).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
    }
    expect(bad.kind).toBe('decode-error');
    expect(bad.issue).toBeDefined();
  });
});

describe('createInMemoryIdempotencyStore', () => {
  it('seenRecently is atomic — first call false, second true', async () => {
    const s = createInMemoryIdempotencyStore();
    expect(await s.seenRecently('k1')).toBe(false);
    expect(await s.seenRecently('k1')).toBe(true);
    expect(s.size()).toBe(1);
    s.clear();
    expect(s.size()).toBe(0);
  });
});
