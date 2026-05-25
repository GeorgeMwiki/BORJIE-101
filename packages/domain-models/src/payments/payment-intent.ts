/**
 * Payment Intent domain model
 * Represents an intent to collect payment from a customer
 */
import { z } from 'zod';
import {
  TenantId,
  CustomerId,
  PaymentIntentId,
  LeaseId,
  PaymentStatus,
  PaymentStatusSchema,
  TenantScopedEntity,
  CurrencyCodeSchema,
  asCustomerId,
  asLeaseId,
} from '../common/types';

export { asCustomerId, asLeaseId };
export type { CustomerId, LeaseId };

/** Payment channel for routing (mpesa, card, bank_transfer) */
export type PaymentChannel = 'mpesa' | 'card' | 'bank_transfer';

import { Money, MoneySchema } from '../common/money';
import { PaymentMethodId, PaymentMethodTypeSchema } from './payment-method';

export const PaymentIntentTypeSchema = z.enum([
  'RENT_PAYMENT',
  'DEPOSIT_PAYMENT',
  'LATE_FEE_PAYMENT',
  'MAINTENANCE_PAYMENT',
  'UTILITY_PAYMENT',
  'CONTRIBUTION',     // Owner contribution
  'OTHER'
]);
export type PaymentIntentType = z.infer<typeof PaymentIntentTypeSchema>;

export const PaymentIntentSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  leaseId: z.string().optional(),
  type: PaymentIntentTypeSchema,
  status: PaymentStatusSchema,
  amount: MoneySchema,
  platformFee: MoneySchema.optional(),
  netAmount: MoneySchema.optional(),
  description: z.string().max(500),
  paymentMethodId: z.string().optional(),
  paymentMethodType: PaymentMethodTypeSchema.optional(),
  externalId: z.string().optional(),          // Provider's payment intent ID
  externalStatus: z.string().optional(),       // Provider's status
  providerName: z.string().optional(),         // stripe, mpesa, etc.
  idempotencyKey: z.string(),
  dueDate: z.date().optional(),
  paidAt: z.date().optional(),
  failureReason: z.string().optional(),
  failureCode: z.string().optional(),
  refundedAmount: MoneySchema.optional(),
  receiptUrl: z.string().url().optional(),
  statementDescriptor: z.string().max(22).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type PaymentIntentData = z.infer<typeof PaymentIntentSchema>;

export interface PaymentIntent extends Omit<PaymentIntentData, 'amount' | 'platformFee' | 'netAmount' | 'refundedAmount'>, TenantScopedEntity {
  id: PaymentIntentId;
  tenantId: TenantId;
  customerId: CustomerId;
  leaseId?: LeaseId;
  paymentMethodId?: PaymentMethodId;
  amount: Money;
  platformFee?: Money;
  netAmount?: Money;
  refundedAmount?: Money;
}

/**
 * Payment Intent aggregate with business logic
 */
export class PaymentIntentAggregate {
  private data: PaymentIntent;
  private events: PaymentIntentEvent[] = [];

  constructor(data: PaymentIntent) {
    this.data = { ...data };
  }

  get id(): PaymentIntentId {
    return this.data.id;
  }

  get tenantId(): TenantId {
    return this.data.tenantId;
  }

  get status(): PaymentStatus {
    return this.data.status;
  }

  get amount(): Money {
    return this.data.amount;
  }

  get platformFee(): Money | undefined {
    return this.data.platformFee;
  }

  get netAmount(): Money | undefined {
    return this.data.netAmount;
  }

  /**
   * Mark as processing with external provider
   */
  markProcessing(externalId: string, providerName: string): void {
    this.assertStatus(['PENDING', 'REQUIRES_ACTION']);
    this.data.status = 'PROCESSING';
    this.data.externalId = externalId;
    this.data.providerName = providerName;
    this.data.updatedAt = new Date();
    this.events.push({
      type: 'PAYMENT_PROCESSING',
      paymentIntentId: this.data.id,
      timestamp: new Date(),
      data: { externalId, providerName }
    });
  }

  /**
   * Mark as requiring customer action (3DS, etc.)
   */
  markRequiresAction(reason: string): void {
    this.assertStatus(['PENDING', 'PROCESSING']);
    this.data.status = 'REQUIRES_ACTION';
    this.data.updatedAt = new Date();
    this.events.push({
      type: 'PAYMENT_REQUIRES_ACTION',
      paymentIntentId: this.data.id,
      timestamp: new Date(),
      data: { reason }
    });
  }

  /**
   * Mark payment as succeeded
   */
  markSucceeded(receiptUrl?: string): void {
    this.assertStatus(['PROCESSING', 'REQUIRES_ACTION']);
    this.data.status = 'SUCCEEDED';
    this.data.paidAt = new Date();
    this.data.receiptUrl = receiptUrl;
    this.data.updatedAt = new Date();
    this.events.push({
      type: 'PAYMENT_SUCCEEDED',
      paymentIntentId: this.data.id,
      timestamp: new Date(),
      data: {
        amount: this.data.amount.toData(),
        platformFee: this.data.platformFee?.toData(),
        netAmount: this.data.netAmount?.toData()
      }
    });
  }

  /**
   * Mark payment as failed
   */
  markFailed(failureReason: string, failureCode?: string): void {
    this.assertStatus(['PENDING', 'PROCESSING', 'REQUIRES_ACTION']);
    this.data.status = 'FAILED';
    this.data.failureReason = failureReason;
    this.data.failureCode = failureCode;
    this.data.updatedAt = new Date();
    this.events.push({
      type: 'PAYMENT_FAILED',
      paymentIntentId: this.data.id,
      timestamp: new Date(),
      data: { failureReason, failureCode }
    });
  }

  /**
   * Cancel the payment intent
   */
  cancel(reason: string): void {
    this.assertStatus(['PENDING', 'REQUIRES_ACTION']);
    this.data.status = 'CANCELLED';
    this.data.failureReason = reason;
    this.data.updatedAt = new Date();
    this.events.push({
      type: 'PAYMENT_CANCELLED',
      paymentIntentId: this.data.id,
      timestamp: new Date(),
      data: { reason }
    });
  }

  /**
   * Record a refund
   */
  recordRefund(refundAmount: Money): void {
    this.assertStatus(['SUCCEEDED']);
    
    const currentRefunded = this.data.refundedAmount ?? Money.zero(this.data.amount.currency);
    const newTotalRefunded = currentRefunded.add(refundAmount);
    
    if (newTotalRefunded.isGreaterThan(this.data.amount)) {
      throw new Error('Refund amount exceeds original payment');
    }

    this.data.refundedAmount = newTotalRefunded;
    
    if (newTotalRefunded.equals(this.data.amount)) {
      this.data.status = 'REFUNDED';
    } else {
      this.data.status = 'PARTIALLY_REFUNDED';
    }
    
    this.data.updatedAt = new Date();
    this.events.push({
      type: this.data.status === 'REFUNDED' ? 'PAYMENT_REFUNDED' : 'PAYMENT_PARTIALLY_REFUNDED',
      paymentIntentId: this.data.id,
      timestamp: new Date(),
      data: {
        refundAmount: refundAmount.toData(),
        totalRefunded: newTotalRefunded.toData()
      }
    });
  }

  /**
   * Check if payment can be refunded
   */
  canRefund(): boolean {
    return this.data.status === 'SUCCEEDED' || this.data.status === 'PARTIALLY_REFUNDED';
  }

  /**
   * Get remaining refundable amount
   */
  getRefundableAmount(): Money {
    if (!this.canRefund()) {
      return Money.zero(this.data.amount.currency);
    }
    const refunded = this.data.refundedAmount ?? Money.zero(this.data.amount.currency);
    return this.data.amount.subtract(refunded);
  }

  /**
   * Get domain events
   */
  getEvents(): PaymentIntentEvent[] {
    return [...this.events];
  }

  /**
   * Clear events after persistence
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Export data
   */
  toData(): PaymentIntent {
    return { ...this.data };
  }

  private assertStatus(allowedStatuses: PaymentStatus[]): void {
    if (!allowedStatuses.includes(this.data.status)) {
      throw new Error(
        `Cannot perform operation: payment is in ${this.data.status} status. ` +
        `Allowed: ${allowedStatuses.join(', ')}`
      );
    }
  }
}

/**
 * Payment Intent domain events
 */
export interface PaymentIntentEvent {
  type: 
    | 'PAYMENT_PROCESSING'
    | 'PAYMENT_REQUIRES_ACTION'
    | 'PAYMENT_SUCCEEDED'
    | 'PAYMENT_FAILED'
    | 'PAYMENT_CANCELLED'
    | 'PAYMENT_REFUNDED'
    | 'PAYMENT_PARTIALLY_REFUNDED';
  paymentIntentId: PaymentIntentId;
  timestamp: Date;
  data: Record<string, unknown>;
}
