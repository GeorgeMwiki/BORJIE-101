import { describe, it, expect } from 'vitest';
import { PaymentMatcher, type Payment, type Invoice } from '../reconciliation/matcher';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-1',
    transactionId: 'txn-1',
    amount: 40000,
    phoneNumber: '254712345678',
    accountReference: 'INV-001',
    customerName: 'John Kamau',
    transactionDate: new Date('2024-03-01'),
    status: 'pending',
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'INV-001',
    tenantId: 'tenant-1',
    tenantName: 'John Kamau',
    tenantPhone: '254712345678',
    unitId: 'unit-1',
    unitNumber: 'A1',
    propertyId: 'prop-1',
    amount: 40000,
    balance: 40000,
    dueDate: new Date('2024-03-01'),
    status: 'pending',
    ...overrides,
  };
}

describe('PaymentMatcher', () => {
  const matcher = new PaymentMatcher();

  describe('fuzzyMatch', () => {
    it('finds exact match when all fields align', () => {
      const payment = makePayment();
      const invoices = [makeInvoice()];

      const result = matcher.fuzzyMatch(payment, invoices);
      expect(result.matchType).toBe('exact');
      expect(result.confidence).toBeGreaterThan(0.9);
      expect(result.invoice).not.toBeNull();
    });

    it('returns no match when no invoices exist', () => {
      const payment = makePayment();
      const result = matcher.fuzzyMatch(payment, []);
      expect(result.matchType).toBe('none');
      expect(result.invoice).toBeNull();
    });

    it('skips paid invoices', () => {
      const payment = makePayment();
      const invoices = [makeInvoice({ status: 'paid', balance: 0 })];
      const result = matcher.fuzzyMatch(payment, invoices);
      expect(result.matchType).toBe('none');
    });

    it('matches by phone number even with different amount', () => {
      const payment = makePayment({ amount: 30000, accountReference: 'UNKNOWN' });
      const invoices = [makeInvoice()];

      const result = matcher.fuzzyMatch(payment, invoices);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.invoice?.id).toBe('INV-001');
    });

    it('matches partial payment', () => {
      const payment = makePayment({ amount: 20000 });
      const invoices = [makeInvoice()];

      const result = matcher.fuzzyMatch(payment, invoices);
      expect(result.invoice).not.toBeNull();
      expect(result.reasons.some(r => r.includes('partial'))).toBe(true);
    });

    it('picks best match from multiple invoices', () => {
      const payment = makePayment({ phoneNumber: '254712345678' });
      const invoices = [
        makeInvoice({ id: 'INV-002', tenantPhone: '254799999999', tenantName: 'Someone Else' }),
        makeInvoice({ id: 'INV-001', tenantPhone: '254712345678' }),
      ];

      const result = matcher.fuzzyMatch(payment, invoices);
      expect(result.invoice?.id).toBe('INV-001');
    });
  });

  describe('reconcile', () => {
    it('reconciles multiple payments against invoices', () => {
      const payments = [
        makePayment({ id: 'p1', transactionId: 't1' }),
        makePayment({ id: 'p2', transactionId: 't2', amount: 50000, phoneNumber: '254799888777', accountReference: 'INV-002' }),
      ];
      const invoices = [
        makeInvoice({ id: 'INV-001' }),
        makeInvoice({ id: 'INV-002', tenantPhone: '254799888777', amount: 50000, balance: 50000 }),
      ];

      const summary = matcher.reconcile(payments, invoices);
      expect(summary.totalPayments).toBe(2);
      expect(summary.matchedPayments).toBe(2);
      expect(summary.unmatchedPayments).toBe(0);
    });

    it('correctly counts unmatched payments', () => {
      const payments = [
        makePayment({ id: 'p1', phoneNumber: '254700000001', accountReference: 'NONE', customerName: 'Unknown' }),
      ];
      const invoices = [
        makeInvoice({ tenantPhone: '254799999999', tenantName: 'Other Person' }),
      ];

      const summary = matcher.reconcile(payments, invoices);
      expect(summary.unmatchedPayments + summary.partialMatches).toBeGreaterThan(0);
    });
  });

  describe('findDuplicates', () => {
    it('detects duplicate payments (same amount, phone, within 24h)', () => {
      const payments = [
        makePayment({ id: 'p1', transactionDate: new Date('2024-03-01T10:00:00') }),
        makePayment({ id: 'p2', transactionDate: new Date('2024-03-01T12:00:00') }),
      ];

      const duplicates = matcher.findDuplicates(payments);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].length).toBe(2);
    });

    it('does not flag different amounts as duplicates', () => {
      const payments = [
        makePayment({ id: 'p1', amount: 40000 }),
        makePayment({ id: 'p2', amount: 50000 }),
      ];

      const duplicates = matcher.findDuplicates(payments);
      expect(duplicates.length).toBe(0);
    });

    it('does not flag payments >24h apart as duplicates', () => {
      const payments = [
        makePayment({ id: 'p1', transactionDate: new Date('2024-03-01') }),
        makePayment({ id: 'p2', transactionDate: new Date('2024-03-03') }),
      ];

      const duplicates = matcher.findDuplicates(payments);
      expect(duplicates.length).toBe(0);
    });
  });
});
