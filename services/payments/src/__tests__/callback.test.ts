import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MpesaCallbackHandler, type StkCallbackBody, type C2BConfirmation } from '../mpesa/callback';

describe('MpesaCallbackHandler', () => {
  let handler: MpesaCallbackHandler;

  beforeEach(() => {
    handler = new MpesaCallbackHandler();
  });

  describe('parseStkCallback', () => {
    it('parses successful STK callback with metadata', () => {
      const body: StkCallbackBody = {
        stkCallback: {
          MerchantRequestID: 'MR-001',
          CheckoutRequestID: 'CR-001',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 1000 },
              { Name: 'MpesaReceiptNumber', Value: 'ABC123XYZ' },
              { Name: 'TransactionDate', Value: '20240301120000' },
              { Name: 'PhoneNumber', Value: '254712345678' },
            ],
          },
        },
      };

      const result = handler.parseStkCallback(body);
      expect(result.success).toBe(true);
      expect(result.merchantRequestId).toBe('MR-001');
      expect(result.checkoutRequestId).toBe('CR-001');
      expect(result.amount).toBe(1000);
      expect(result.mpesaReceiptNumber).toBe('ABC123XYZ');
      expect(result.phoneNumber).toBe('254712345678');
      expect(result.transactionDate).toBeInstanceOf(Date);
    });

    it('parses failed STK callback without metadata', () => {
      const body: StkCallbackBody = {
        stkCallback: {
          MerchantRequestID: 'MR-002',
          CheckoutRequestID: 'CR-002',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      };

      const result = handler.parseStkCallback(body);
      expect(result.success).toBe(false);
      expect(result.resultCode).toBe(1032);
      expect(result.amount).toBeUndefined();
    });
  });

  describe('parseC2BConfirmation', () => {
    it('parses C2B confirmation body', () => {
      const body: C2BConfirmation = {
        TransactionType: 'Pay Bill',
        TransID: 'TXN123',
        TransTime: '20240301120000',
        TransAmount: '5000.00',
        BusinessShortCode: '174379',
        BillRefNumber: 'INV-001',
        InvoiceNumber: 'INV-001',
        OrgAccountBalance: '100000.00',
        ThirdPartyTransID: '',
        MSISDN: '254712345678',
        FirstName: 'John',
        MiddleName: '',
        LastName: 'Kamau',
      };

      const result = handler.parseC2BConfirmation(body);
      expect(result.transactionId).toBe('TXN123');
      // Bug fix A-BUG-DEEP #5: amount is now integer minor units (cents).
      expect(result.amountMinor).toBe(500_000);
      expect(result.orgBalanceMinor).toBe(10_000_000);
      expect(result.phoneNumber).toBe('254712345678');
      expect(result.customerName).toBe('John Kamau');
      expect(result.accountReference).toBe('INV-001');
      // Bug fix A-BUG-DEEP #4: '20240301120000' is EAT (UTC+3), so the
      // UTC instant is 09:00:00.
      expect(result.transactionTime.toISOString()).toBe('2024-03-01T09:00:00.000Z');
    });
  });

  describe('handleStkCallback', () => {
    it('processes successful callback and calls onSuccess', async () => {
      const onSuccess = vi.fn();
      const body: StkCallbackBody = {
        stkCallback: {
          MerchantRequestID: 'MR-003',
          CheckoutRequestID: 'CR-003',
          ResultCode: 0,
          ResultDesc: 'Success',
          CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }] },
        },
      };

      const result = await handler.handleStkCallback(body, onSuccess);
      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledOnce();
    });

    it('deduplicates callbacks with same checkoutRequestId', async () => {
      const onSuccess = vi.fn();
      const body: StkCallbackBody = {
        stkCallback: {
          MerchantRequestID: 'MR-004',
          CheckoutRequestID: 'CR-004',
          ResultCode: 0,
          ResultDesc: 'Success',
        },
      };

      await handler.handleStkCallback(body, onSuccess);
      const result = await handler.handleStkCallback(body, onSuccess);
      expect(result.message).toBe('Callback already processed');
      expect(onSuccess).toHaveBeenCalledOnce();
    });

    it('emits stk:cancelled for code 1032', async () => {
      const onFailure = vi.fn();
      const body: StkCallbackBody = {
        stkCallback: {
          MerchantRequestID: 'MR-005',
          CheckoutRequestID: 'CR-005',
          ResultCode: 1032,
          ResultDesc: 'Cancelled by user',
        },
      };

      const result = await handler.handleStkCallback(body, undefined, onFailure);
      expect(result.success).toBe(false);
      expect(onFailure).toHaveBeenCalledOnce();
    });
  });

  describe('getErrorMessage', () => {
    it('returns known error messages', () => {
      expect(handler.getErrorMessage(0)).toBe('Success');
      expect(handler.getErrorMessage(1)).toBe('Insufficient balance');
      expect(handler.getErrorMessage(1032)).toBe('Request cancelled by user');
    });

    it('returns generic message for unknown codes', () => {
      expect(handler.getErrorMessage(9999)).toContain('failed with code 9999');
    });
  });

  describe('isProcessed', () => {
    it('returns false for unprocessed callbacks', () => {
      expect(handler.isProcessed('stk', 'unknown')).toBe(false);
    });
  });

  describe('generateAckResponse', () => {
    it('returns ResultCode 0', () => {
      const ack = handler.generateAckResponse();
      expect(ack).toEqual({ ResultCode: 0, ResultDesc: 'Success' });
    });
  });

  describe('generateValidationResponse', () => {
    it('accepts with code 0', () => {
      const resp = handler.generateValidationResponse(true);
      expect(resp).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
    });

    it('rejects with code 1 and reason', () => {
      const resp = handler.generateValidationResponse(false, 'Invalid account');
      expect(resp).toEqual({ ResultCode: 1, ResultDesc: 'Invalid account' });
    });
  });
});
