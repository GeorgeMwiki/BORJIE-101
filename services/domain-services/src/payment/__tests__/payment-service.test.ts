/**
 * Unit tests for PaymentService
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import {
  type Money,
  money,
  zeroMoney,
  asCustomerId,
  asPropertyId,
  asUnitId,
} from '@borjie/domain-models';
import type {
  InvoiceRepository,
  PaymentRepository,
  TransactionRepository,
  Invoice,
  Payment,
} from '../index.js';
import type { EventBus } from '../../common/events.js';
import {
  PaymentService,
  PaymentServiceError,
  asInvoiceId,
  asPaymentId,
  type CreateInvoiceInput,
  type RecordPaymentInput,
} from '../index.js';

function createMockEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('PaymentService', () => {
  const tenantId = 'tnt_test' as TenantId;
  const userId = 'usr_1' as UserId;
  const correlationId = 'corr_123';

  describe('payment recording', () => {
    it('records a manual payment successfully', async () => {
      const recordInput: RecordPaymentInput = {
        customerId: asCustomerId('cust_1'),
        method: 'cash',
        amount: money(50000, 'KES'),
        description: 'January rent payment',
      };

      const mockPayment = {
        id: asPaymentId('pay_1'),
        tenantId,
        paymentNumber: 'PAY-2025-00001',
        invoiceId: null,
        customerId: recordInput.customerId,
        leaseId: null,
        status: 'completed',
        method: 'cash',
        amount: recordInput.amount,
        fee: zeroMoney('KES'),
        netAmount: recordInput.amount,
        currency: 'KES',
        reference: null,
        externalId: null,
        externalReference: null,
        description: recordInput.description,
        payerName: null,
        payerPhone: null,
        payerEmail: null,
        reconciliationStatus: 'pending',
        reconciliationConfidence: 0,
        reconciledAt: null,
        reconciledBy: null,
        failureReason: null,
        receiptUrl: null,
        metadata: {},
        processedAt: new Date().toISOString(),
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const paymentRepo: Partial<PaymentRepository> = {
        create: vi.fn().mockResolvedValue(mockPayment),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const transactionRepo: Partial<TransactionRepository> = {
        create: vi.fn().mockImplementation((t) => Promise.resolve(t)),
        getCustomerBalance: vi.fn().mockResolvedValue(zeroMoney('KES')),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new PaymentService(
        {} as InvoiceRepository,
        paymentRepo as PaymentRepository,
        transactionRepo as TransactionRepository,
        createMockEventBus()
      );

      const result = await service.recordPayment(tenantId, recordInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('completed');
        expect(result.data.amount.amount).toBe(50000);
      }
      expect(paymentRepo.create).toHaveBeenCalled();
      expect(transactionRepo.create).toHaveBeenCalled();
    });

    it('returns error for invalid (non-positive) amount', async () => {
      const recordInput: RecordPaymentInput = {
        customerId: asCustomerId('cust_1'),
        method: 'cash',
        amount: money(0, 'KES'),
        description: 'Invalid payment',
      };

      const service = new PaymentService(
        {} as InvoiceRepository,
        {} as PaymentRepository,
        {} as TransactionRepository,
        createMockEventBus()
      );

      const result = await service.recordPayment(tenantId, recordInput, userId, correlationId);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(PaymentServiceError.INVALID_AMOUNT);
      }
    });
  });

  describe('invoice generation', () => {
    it('creates an invoice successfully', async () => {
      const createInput: CreateInvoiceInput = {
        customerId: asCustomerId('cust_1'),
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        dueDate: '2025-02-15',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        lineItems: [
          {
            type: 'rent',
            description: 'January 2025 rent',
            quantity: 1,
            unitPrice: money(50000, 'KES'),
          },
        ],
      };

      const mockInvoice = {
        id: asInvoiceId('inv_1'),
        tenantId,
        invoiceNumber: 'INV-2025-00001',
        customerId: createInput.customerId,
        leaseId: null,
        propertyId: createInput.propertyId,
        unitId: createInput.unitId,
        status: 'draft',
        issueDate: '',
        dueDate: createInput.dueDate,
        periodStart: createInput.periodStart,
        periodEnd: createInput.periodEnd,
        lineItems: [],
        subtotal: money(50000, 'KES'),
        taxTotal: zeroMoney('KES'),
        total: money(50000, 'KES'),
        amountPaid: zeroMoney('KES'),
        amountDue: money(50000, 'KES'),
        currency: 'KES',
        notes: null,
        paymentInstructions: null,
        sentAt: null,
        paidAt: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const invoiceRepo: Partial<InvoiceRepository> = {
        create: vi.fn().mockResolvedValue(mockInvoice),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new PaymentService(
        invoiceRepo as InvoiceRepository,
        {} as PaymentRepository,
        {} as TransactionRepository,
        createMockEventBus()
      );

      const result = await service.createInvoice(tenantId, createInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('draft');
        expect(result.data.total.amount).toBe(50000);
      }
      expect(invoiceRepo.create).toHaveBeenCalled();
    });
  });

  describe('balance calculations', () => {
    it('returns customer balance from transaction repo', async () => {
      const customerId = asCustomerId('cust_1');
      const expectedBalance = money(-50000, 'KES'); // amount owed

      const transactionRepo: Partial<TransactionRepository> = {
        getCustomerBalance: vi.fn().mockResolvedValue(expectedBalance),
      };

      const service = new PaymentService(
        {} as InvoiceRepository,
        {} as PaymentRepository,
        transactionRepo as TransactionRepository,
        createMockEventBus()
      );

      const balance = await service.getCustomerBalance(customerId, tenantId);

      expect(balance).toEqual(expectedBalance);
      expect(transactionRepo.getCustomerBalance).toHaveBeenCalledWith(customerId, tenantId);
    });
  });

  describe('M-Pesa callback handling', () => {
    it('records payment with external reference (simulating M-Pesa callback)', async () => {
      const invoice = {
        id: asInvoiceId('inv_1'),
        tenantId,
        invoiceNumber: 'INV-2025-00001',
        customerId: asCustomerId('cust_1'),
        leaseId: null,
        propertyId: asPropertyId('prop_1'),
        unitId: asUnitId('unit_1'),
        status: 'sent',
        issueDate: '',
        dueDate: '2025-02-15',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        lineItems: [],
        subtotal: money(50000, 'KES'),
        taxTotal: zeroMoney('KES'),
        total: money(50000, 'KES'),
        amountPaid: zeroMoney('KES'),
        amountDue: money(50000, 'KES'),
        currency: 'KES',
        notes: null,
        paymentInstructions: null,
        sentAt: '',
        paidAt: null,
        createdAt: '',
        updatedAt: '',
        createdBy: userId,
        updatedBy: userId,
      };

      const recordInput: RecordPaymentInput = {
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        method: 'mpesa',
        amount: money(50000, 'KES'),
        externalId: 'MPX123456',
        externalReference: 'QGH12345',
        description: 'M-Pesa payment for INV-2025-00001',
        payerPhone: '+254700000000',
      };

      const invoiceRepo: Partial<InvoiceRepository> = {
        findById: vi.fn().mockResolvedValue(invoice),
        update: vi.fn().mockImplementation((inv) => Promise.resolve(inv)),
      };

      const paymentRepo: Partial<PaymentRepository> = {
        create: vi.fn().mockImplementation((p) => Promise.resolve(p)),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const transactionRepo: Partial<TransactionRepository> = {
        create: vi.fn().mockImplementation((t) => Promise.resolve(t)),
        getCustomerBalance: vi.fn().mockResolvedValue(zeroMoney('KES')),
        getNextSequence: vi.fn().mockResolvedValue(1),
      };

      const service = new PaymentService(
        invoiceRepo as InvoiceRepository,
        paymentRepo as PaymentRepository,
        transactionRepo as TransactionRepository,
        createMockEventBus()
      );

      const result = await service.recordPayment(tenantId, recordInput, userId, correlationId);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.externalId).toBe('MPX123456');
        expect(result.data.externalReference).toBe('QGH12345');
        expect(result.data.method).toBe('mpesa');
        expect(result.data.reconciliationStatus).toBe('matched');
      }
      expect(invoiceRepo.update).toHaveBeenCalled();
    });

    it('rejects payment for cancelled invoice', async () => {
      const cancelledInvoice = {
        id: asInvoiceId('inv_1'),
        tenantId,
        status: 'cancelled',
        customerId: asCustomerId('cust_1'),
        propertyId: asPropertyId('prop_1'),
        unitId: null,
        total: money(50000, 'KES'),
        amountPaid: zeroMoney('KES'),
        amountDue: money(50000, 'KES'),
        currency: 'KES',
      } as Invoice;

      const invoiceRepo: Partial<InvoiceRepository> = {
        findById: vi.fn().mockResolvedValue(cancelledInvoice),
      };

      const service = new PaymentService(
        invoiceRepo as InvoiceRepository,
        {} as PaymentRepository,
        {} as TransactionRepository,
        createMockEventBus()
      );

      const result = await service.recordPayment(
        tenantId,
        {
          invoiceId: cancelledInvoice.id,
          customerId: cancelledInvoice.customerId,
          method: 'mpesa',
          amount: money(50000, 'KES'),
          description: 'Payment',
        },
        userId,
        correlationId
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(PaymentServiceError.INVOICE_CANCELLED);
      }
    });
  });
});
