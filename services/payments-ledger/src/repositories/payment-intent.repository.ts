/**
 * Payment Intent Repository Interface
 * Defines the contract for payment intent persistence
 */
import {
  PaymentIntent,
  PaymentIntentId,
  TenantId,
  CustomerId,
  LeaseId,
  CurrencyCode
} from '@borjie/domain-models';
import type { PaymentStatus } from '../types';

export interface PaymentIntentFilters {
  tenantId: TenantId;
  customerId?: CustomerId;
  leaseId?: LeaseId;
  status?: PaymentStatus | PaymentStatus[];
  fromDate?: Date;
  toDate?: Date;
  currency?: CurrencyCode;
  minAmount?: number;
  maxAmount?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface IPaymentIntentRepository {
  /**
   * Create a new payment intent
   */
  create(paymentIntent: PaymentIntent): Promise<PaymentIntent>;

  /**
   * Get payment intent by ID
   */
  findById(id: PaymentIntentId, tenantId: TenantId): Promise<PaymentIntent | null>;

  /**
   * Get payment intent by external ID (provider's ID).
   *
   * W4-A: tenantId is REQUIRED. The DB unique index is
   * (tenant_id, provider_name, external_id) per migration 0169, so a
   * provider-issued external_id is not globally unique — two tenants may
   * legitimately share the same id. Without the tenantId predicate a
   * leaked external_id would let tenant A read tenant B's payment row.
   */
  findByExternalId(
    externalId: string,
    providerName: string,
    tenantId: TenantId
  ): Promise<PaymentIntent | null>;

  /**
   * Get payment intent by idempotency key
   */
  findByIdempotencyKey(idempotencyKey: string, tenantId: TenantId): Promise<PaymentIntent | null>;

  /**
   * Update payment intent
   */
  update(paymentIntent: PaymentIntent): Promise<PaymentIntent>;

  /**
   * Find payment intents with filters
   */
  find(
    filters: PaymentIntentFilters,
    page?: number,
    pageSize?: number
  ): Promise<PaginatedResult<PaymentIntent>>;

  /**
   * Get pending payments for a customer
   */
  findPendingByCustomer(
    tenantId: TenantId,
    customerId: CustomerId
  ): Promise<PaymentIntent[]>;

  /**
   * Get successful payments for a lease in date range
   */
  findSuccessfulByLease(
    tenantId: TenantId,
    leaseId: LeaseId,
    fromDate: Date,
    toDate: Date
  ): Promise<PaymentIntent[]>;

  /**
   * Get total amount paid by customer in period
   */
  getTotalPaidByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    fromDate: Date,
    toDate: Date
  ): Promise<number>;

  /**
   * Get payment intents needing reconciliation
   */
  findNeedingReconciliation(
    tenantId: TenantId,
    olderThan: Date
  ): Promise<PaymentIntent[]>;
}

/**
 * In-memory implementation for testing
 */
export class InMemoryPaymentIntentRepository implements IPaymentIntentRepository {
  private paymentIntents: Map<string, PaymentIntent> = new Map();

  async create(paymentIntent: PaymentIntent): Promise<PaymentIntent> {
    this.paymentIntents.set(paymentIntent.id, { ...paymentIntent });
    return paymentIntent;
  }

  async findById(id: PaymentIntentId, tenantId: TenantId): Promise<PaymentIntent | null> {
    const pi = this.paymentIntents.get(id);
    if (pi && pi.tenantId === tenantId) {
      return { ...pi };
    }
    return null;
  }

  async findByExternalId(
    externalId: string,
    providerName: string,
    tenantId: TenantId
  ): Promise<PaymentIntent | null> {
    for (const pi of this.paymentIntents.values()) {
      if (
        pi.externalId === externalId
        && pi.providerName === providerName
        && pi.tenantId === tenantId
      ) {
        return { ...pi };
      }
    }
    return null;
  }

  async findByIdempotencyKey(idempotencyKey: string, tenantId: TenantId): Promise<PaymentIntent | null> {
    for (const pi of this.paymentIntents.values()) {
      if (pi.idempotencyKey === idempotencyKey && pi.tenantId === tenantId) {
        return { ...pi };
      }
    }
    return null;
  }

  async update(paymentIntent: PaymentIntent): Promise<PaymentIntent> {
    this.paymentIntents.set(paymentIntent.id, { ...paymentIntent });
    return paymentIntent;
  }

  async find(
    filters: PaymentIntentFilters,
    page: number = 1,
    pageSize: number = 20
  ): Promise<PaginatedResult<PaymentIntent>> {
    let items = Array.from(this.paymentIntents.values())
      .filter(pi => pi.tenantId === filters.tenantId);

    if (filters.customerId) {
      items = items.filter(pi => pi.customerId === filters.customerId);
    }
    if (filters.leaseId) {
      items = items.filter(pi => pi.leaseId === filters.leaseId);
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      items = items.filter(pi => statuses.includes(pi.status));
    }
    if (filters.fromDate) {
      items = items.filter(pi => pi.createdAt >= filters.fromDate!);
    }
    if (filters.toDate) {
      items = items.filter(pi => pi.createdAt <= filters.toDate!);
    }

    const total = items.length;
    const start = (page - 1) * pageSize;
    items = items.slice(start, start + pageSize);

    return {
      items: items.map(pi => ({ ...pi })),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    };
  }

  async findPendingByCustomer(
    tenantId: TenantId,
    customerId: CustomerId
  ): Promise<PaymentIntent[]> {
    return Array.from(this.paymentIntents.values())
      .filter(pi => 
        pi.tenantId === tenantId &&
        pi.customerId === customerId &&
        ['PENDING', 'PROCESSING', 'REQUIRES_ACTION'].includes(pi.status)
      )
      .map(pi => ({ ...pi }));
  }

  async findSuccessfulByLease(
    tenantId: TenantId,
    leaseId: LeaseId,
    fromDate: Date,
    toDate: Date
  ): Promise<PaymentIntent[]> {
    return Array.from(this.paymentIntents.values())
      .filter(pi =>
        pi.tenantId === tenantId &&
        pi.leaseId === leaseId &&
        pi.status === 'SUCCEEDED' &&
        pi.paidAt &&
        pi.paidAt >= fromDate &&
        pi.paidAt <= toDate
      )
      .map(pi => ({ ...pi }));
  }

  async getTotalPaidByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
    fromDate: Date,
    toDate: Date
  ): Promise<number> {
    return Array.from(this.paymentIntents.values())
      .filter(pi =>
        pi.tenantId === tenantId &&
        pi.customerId === customerId &&
        pi.status === 'SUCCEEDED' &&
        pi.paidAt &&
        pi.paidAt >= fromDate &&
        pi.paidAt <= toDate
      )
      .reduce((sum, pi) => sum + pi.amount.amountMinorUnits, 0);
  }

  async findNeedingReconciliation(
    tenantId: TenantId,
    olderThan: Date
  ): Promise<PaymentIntent[]> {
    return Array.from(this.paymentIntents.values())
      .filter(pi =>
        pi.tenantId === tenantId &&
        pi.status === 'PROCESSING' &&
        pi.createdAt < olderThan
      )
      .map(pi => ({ ...pi }));
  }
}
