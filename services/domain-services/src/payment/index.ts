import { randomHex } from '../common/id-generator.js';
/**
 * Payment domain service.
 *
 * Handles payment processing, invoicing, rent collection, and ledger management
 * for the BORJIE platform. Supports mobile money (M-Pesa, etc.) and bank transfers.
 */

import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import {
  type Money,
  type CurrencyCode,
  type CustomerId,
  type LeaseId,
  type PropertyId,
  type UnitId,
  money,
  addMoney,
  subtractMoney,
  isPositive,
  isNegative,
  zeroMoney,
  ok,
  err,
} from '@borjie/domain-models';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Branded Types
// ============================================================================

export type InvoiceId = string & { __brand: 'InvoiceId' };
export type PaymentId = string & { __brand: 'PaymentId' };
export type TransactionId = string & { __brand: 'TransactionId' };

export function asInvoiceId(id: string): InvoiceId {
  return id as InvoiceId;
}

export function asPaymentId(id: string): PaymentId {
  return id as PaymentId;
}

export function asTransactionId(id: string): TransactionId {
  return id as TransactionId;
}

// ============================================================================
// Invoice Types
// ============================================================================

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' | 'void';

export type InvoiceLineItemType = 'rent' | 'deposit' | 'late_fee' | 'utility' | 'service_charge' | 'maintenance' | 'other';

export interface InvoiceLineItem {
  readonly id: string;
  readonly type: InvoiceLineItemType;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly amount: Money;
  readonly taxRate: number;
  readonly taxAmount: Money;
}

export interface Invoice {
  readonly id: InvoiceId;
  readonly tenantId: TenantId;
  readonly invoiceNumber: string;
  readonly customerId: CustomerId;
  readonly leaseId: LeaseId | null;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId | null;
  readonly status: InvoiceStatus;
  readonly issueDate: ISOTimestamp;
  readonly dueDate: ISOTimestamp;
  readonly periodStart: ISOTimestamp;
  readonly periodEnd: ISOTimestamp;
  readonly lineItems: readonly InvoiceLineItem[];
  readonly subtotal: Money;
  readonly taxTotal: Money;
  readonly total: Money;
  readonly amountPaid: Money;
  readonly amountDue: Money;
  readonly currency: CurrencyCode;
  readonly notes: string | null;
  readonly paymentInstructions: string | null;
  readonly sentAt: ISOTimestamp | null;
  readonly paidAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Payment Types
// ============================================================================

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'refunded';

export type PaymentMethod = 
  | 'mpesa'           // M-Pesa (Kenya/Tanzania)
  | 'bank_transfer'   // Direct bank transfer
  | 'card'            // Credit/Debit card
  | 'cash'            // Cash (recorded manually)
  | 'mobile_money'    // Generic mobile money
  | 'pesapal'         // Pesapal integration
  | 'flutterwave';    // Flutterwave integration

export interface Payment {
  readonly id: PaymentId;
  readonly tenantId: TenantId;
  readonly paymentNumber: string;
  readonly invoiceId: InvoiceId | null;
  readonly customerId: CustomerId;
  readonly leaseId: LeaseId | null;
  readonly status: PaymentStatus;
  readonly method: PaymentMethod;
  readonly amount: Money;
  readonly fee: Money;
  readonly netAmount: Money;
  readonly currency: CurrencyCode;
  readonly reference: string | null;
  readonly externalId: string | null;
  readonly externalReference: string | null;
  readonly description: string;
  readonly payerName: string | null;
  readonly payerPhone: string | null;
  readonly payerEmail: string | null;
  readonly reconciliationStatus: 'pending' | 'matched' | 'unmatched' | 'disputed';
  readonly reconciliationConfidence: number;
  readonly reconciledAt: ISOTimestamp | null;
  readonly reconciledBy: UserId | null;
  readonly failureReason: string | null;
  readonly receiptUrl: string | null;
  readonly metadata: Record<string, unknown>;
  readonly processedAt: ISOTimestamp | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
  readonly createdBy: UserId;
  readonly updatedBy: UserId;
}

// ============================================================================
// Transaction Types (Ledger)
// ============================================================================

export type TransactionType = 'debit' | 'credit';

export type TransactionCategory = 
  | 'rent_income'
  | 'deposit_received'
  | 'late_fee_income'
  | 'utility_income'
  | 'service_charge_income'
  | 'maintenance_expense'
  | 'refund'
  | 'adjustment'
  | 'fee'
  | 'other';

export interface Transaction {
  readonly id: TransactionId;
  readonly tenantId: TenantId;
  readonly transactionNumber: string;
  readonly type: TransactionType;
  readonly category: TransactionCategory;
  readonly customerId: CustomerId | null;
  readonly leaseId: LeaseId | null;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  readonly invoiceId: InvoiceId | null;
  readonly paymentId: PaymentId | null;
  readonly amount: Money;
  readonly runningBalance: Money;
  readonly description: string;
  readonly reference: string | null;
  readonly effectiveDate: ISOTimestamp;
  readonly postedAt: ISOTimestamp;
  readonly postedBy: UserId;
  readonly reversedBy: TransactionId | null;
  readonly createdAt: ISOTimestamp;
}

// ============================================================================
// Error Types
// ============================================================================

export const PaymentServiceError = {
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INVOICE_ALREADY_PAID: 'INVOICE_ALREADY_PAID',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  PAYMENT_ALREADY_PROCESSED: 'PAYMENT_ALREADY_PROCESSED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_PAYMENT_METHOD: 'INVALID_PAYMENT_METHOD',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  LEASE_NOT_FOUND: 'LEASE_NOT_FOUND',
  RECONCILIATION_FAILED: 'RECONCILIATION_FAILED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  DUPLICATE_PAYMENT: 'DUPLICATE_PAYMENT',
} as const;

export type PaymentServiceErrorCode = (typeof PaymentServiceError)[keyof typeof PaymentServiceError];

export interface PaymentServiceErrorResult {
  code: PaymentServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface InvoiceRepository {
  findById(id: InvoiceId, tenantId: TenantId): Promise<Invoice | null>;
  findByInvoiceNumber(invoiceNumber: string, tenantId: TenantId): Promise<Invoice | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findByLease(leaseId: LeaseId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findByStatus(status: InvoiceStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findOverdue(tenantId: TenantId): Promise<Invoice[]>;
  findDueSoon(daysThreshold: number, tenantId: TenantId): Promise<Invoice[]>;
  create(invoice: Invoice): Promise<Invoice>;
  update(invoice: Invoice): Promise<Invoice>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

export interface PaymentRepository {
  findById(id: PaymentId, tenantId: TenantId): Promise<Payment | null>;
  findByPaymentNumber(paymentNumber: string, tenantId: TenantId): Promise<Payment | null>;
  findByExternalId(externalId: string, tenantId: TenantId): Promise<Payment | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Payment>>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Payment>>;
  findByInvoice(invoiceId: InvoiceId, tenantId: TenantId): Promise<Payment[]>;
  findUnreconciled(tenantId: TenantId): Promise<Payment[]>;
  findByDateRange(startDate: ISOTimestamp, endDate: ISOTimestamp, tenantId: TenantId): Promise<Payment[]>;
  create(payment: Payment): Promise<Payment>;
  update(payment: Payment): Promise<Payment>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

export interface TransactionRepository {
  findById(id: TransactionId, tenantId: TenantId): Promise<Transaction | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Transaction>>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Transaction>>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Transaction>>;
  findByDateRange(startDate: ISOTimestamp, endDate: ISOTimestamp, tenantId: TenantId): Promise<Transaction[]>;
  create(transaction: Transaction): Promise<Transaction>;
  getCustomerBalance(customerId: CustomerId, tenantId: TenantId): Promise<Money>;
  getPropertyBalance(propertyId: PropertyId, tenantId: TenantId): Promise<Money>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

// ============================================================================
// Payment Provider Interface
// ============================================================================

export interface PaymentProviderConfig {
  apiKey: string;
  secretKey: string;
  environment: 'sandbox' | 'production';
  webhookSecret?: string;
}

export interface InitiatePaymentRequest {
  amount: Money;
  phone?: string;
  email?: string;
  reference: string;
  description: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitiatePaymentResponse {
  success: boolean;
  externalId: string;
  checkoutUrl?: string;
  instructions?: string;
  error?: string;
}

export interface PaymentStatusResponse {
  status: PaymentStatus;
  externalId: string;
  externalReference?: string;
  amount: Money;
  fee?: Money;
  paidAt?: ISOTimestamp;
  failureReason?: string;
}

export interface PaymentProvider {
  readonly name: PaymentMethod;
  initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResponse>;
  checkStatus(externalId: string): Promise<PaymentStatusResponse>;
  refund(externalId: string, amount?: Money): Promise<Result<void, string>>;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateInvoiceInput {
  customerId: CustomerId;
  leaseId?: LeaseId;
  propertyId: PropertyId;
  unitId?: UnitId;
  dueDate: ISOTimestamp;
  periodStart: ISOTimestamp;
  periodEnd: ISOTimestamp;
  lineItems: Array<{
    type: InvoiceLineItemType;
    description: string;
    quantity: number;
    unitPrice: Money;
    taxRate?: number;
  }>;
  notes?: string;
  paymentInstructions?: string;
}

export interface RecordPaymentInput {
  invoiceId?: InvoiceId;
  customerId: CustomerId;
  leaseId?: LeaseId;
  method: PaymentMethod;
  amount: Money;
  reference?: string;
  externalId?: string;
  externalReference?: string;
  description: string;
  payerName?: string;
  payerPhone?: string;
  payerEmail?: string;
  metadata?: Record<string, unknown>;
}

export interface InitiateMobilePaymentInput {
  invoiceId?: InvoiceId;
  customerId: CustomerId;
  leaseId?: LeaseId;
  method: PaymentMethod;
  amount: Money;
  phone: string;
  description: string;
}

// ============================================================================
// Domain Events
// ============================================================================

export interface InvoiceCreatedEvent {
  eventId: string;
  eventType: 'InvoiceCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    invoiceId: InvoiceId;
    invoiceNumber: string;
    customerId: CustomerId;
    total: Money;
    dueDate: ISOTimestamp;
  };
}

export interface PaymentReceivedEvent {
  eventId: string;
  eventType: 'PaymentReceived';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    paymentId: PaymentId;
    paymentNumber: string;
    customerId: CustomerId;
    invoiceId: InvoiceId | null;
    amount: Money;
    method: PaymentMethod;
  };
}

export interface InvoicePaidEvent {
  eventId: string;
  eventType: 'InvoicePaid';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    invoiceId: InvoiceId;
    invoiceNumber: string;
    customerId: CustomerId;
    paidAmount: Money;
  };
}

// ============================================================================
// Payment Service Implementation
// ============================================================================

/**
 * Payment and invoicing service.
 * Handles rent collection, invoice generation, payment processing, 
 * reconciliation, and ledger management.
 */
export class PaymentService {
  private providers: Map<PaymentMethod, PaymentProvider> = new Map();

  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly paymentRepo: PaymentRepository,
    private readonly transactionRepo: TransactionRepository,
    private readonly eventBus: EventBus
  ) {}

  /**
   * Register a payment provider.
   */
  registerProvider(provider: PaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  // ==================== Invoice Operations ====================

  /**
   * Create a new invoice.
   */
  async createInvoice(
    tenantId: TenantId,
    input: CreateInvoiceInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Invoice, PaymentServiceErrorResult>> {
    const now = new Date().toISOString();
    const invoiceNumber = await this.generateInvoiceNumber(tenantId);
    const invoiceId = asInvoiceId(`inv_${Date.now()}_${randomHex(4)}`);

    // Calculate line items with tax
    const currency = input.lineItems[0]?.unitPrice.currency ?? 'USD';
    const lineItems: InvoiceLineItem[] = input.lineItems.map((item, index) => {
      const amount = money(item.unitPrice.amount * item.quantity, currency);
      const taxRate = item.taxRate ?? 0;
      const taxAmount = money(Math.round(amount.amount * taxRate / 100), currency);

      return {
        id: `item_${index}`,
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount,
        taxRate,
        taxAmount,
      };
    });

    // Calculate totals
    let subtotal = zeroMoney(currency);
    let taxTotal = zeroMoney(currency);
    
    for (const item of lineItems) {
      subtotal = addMoney(subtotal, item.amount);
      taxTotal = addMoney(taxTotal, item.taxAmount);
    }
    
    const total = addMoney(subtotal, taxTotal);

    const invoice: Invoice = {
      id: invoiceId,
      tenantId,
      invoiceNumber,
      customerId: input.customerId,
      leaseId: input.leaseId ?? null,
      propertyId: input.propertyId,
      unitId: input.unitId ?? null,
      status: 'draft',
      issueDate: now,
      dueDate: input.dueDate,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      lineItems,
      subtotal,
      taxTotal,
      total,
      amountPaid: zeroMoney(currency),
      amountDue: total,
      currency,
      notes: input.notes ?? null,
      paymentInstructions: input.paymentInstructions ?? null,
      sentAt: null,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const savedInvoice = await this.invoiceRepo.create(invoice);

    // Publish event
    const event: InvoiceCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'InvoiceCreated',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        invoiceId: savedInvoice.id,
        invoiceNumber: savedInvoice.invoiceNumber,
        customerId: savedInvoice.customerId,
        total: savedInvoice.total,
        dueDate: savedInvoice.dueDate,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedInvoice.id, 'Invoice'));

    return ok(savedInvoice);
  }

  /**
   * Get an invoice by ID.
   */
  async getInvoice(invoiceId: InvoiceId, tenantId: TenantId): Promise<Invoice | null> {
    return this.invoiceRepo.findById(invoiceId, tenantId);
  }

  /**
   * List invoices.
   */
  async listInvoices(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Invoice>> {
    return this.invoiceRepo.findMany(tenantId, pagination);
  }

  /**
   * List invoices by customer.
   */
  async listInvoicesByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Invoice>> {
    return this.invoiceRepo.findByCustomer(customerId, tenantId, pagination);
  }

  /**
   * List overdue invoices.
   */
  async listOverdueInvoices(tenantId: TenantId): Promise<Invoice[]> {
    return this.invoiceRepo.findOverdue(tenantId);
  }

  /**
   * Send an invoice (mark as sent).
   */
  async sendInvoice(
    invoiceId: InvoiceId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Invoice, PaymentServiceErrorResult>> {
    const invoice = await this.invoiceRepo.findById(invoiceId, tenantId);
    if (!invoice) {
      return err({
        code: PaymentServiceError.INVOICE_NOT_FOUND,
        message: 'Invoice not found',
      });
    }

    const now = new Date().toISOString();
    const updatedInvoice: Invoice = {
      ...invoice,
      status: 'sent',
      sentAt: now,
      updatedAt: now,
      updatedBy,
    };

    const savedInvoice = await this.invoiceRepo.update(updatedInvoice);
    return ok(savedInvoice);
  }

  /**
   * Cancel an invoice.
   */
  async cancelInvoice(
    invoiceId: InvoiceId,
    tenantId: TenantId,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Invoice, PaymentServiceErrorResult>> {
    const invoice = await this.invoiceRepo.findById(invoiceId, tenantId);
    if (!invoice) {
      return err({
        code: PaymentServiceError.INVOICE_NOT_FOUND,
        message: 'Invoice not found',
      });
    }

    if (invoice.status === 'paid') {
      return err({
        code: PaymentServiceError.INVOICE_ALREADY_PAID,
        message: 'Cannot cancel a paid invoice',
      });
    }

    const now = new Date().toISOString();
    const updatedInvoice: Invoice = {
      ...invoice,
      status: 'cancelled',
      updatedAt: now,
      updatedBy,
    };

    const savedInvoice = await this.invoiceRepo.update(updatedInvoice);
    return ok(savedInvoice);
  }

  // ==================== Payment Operations ====================

  /**
   * Record a manual payment (cash, bank transfer, etc.).
   */
  async recordPayment(
    tenantId: TenantId,
    input: RecordPaymentInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Payment, PaymentServiceErrorResult>> {
    // Validate amount
    if (!isPositive(input.amount)) {
      return err({
        code: PaymentServiceError.INVALID_AMOUNT,
        message: 'Payment amount must be positive',
      });
    }

    // If linked to invoice, validate invoice
    let invoice: Invoice | null = null;
    if (input.invoiceId) {
      invoice = await this.invoiceRepo.findById(input.invoiceId, tenantId);
      if (!invoice) {
        return err({
          code: PaymentServiceError.INVOICE_NOT_FOUND,
          message: 'Invoice not found',
        });
      }

      if (invoice.status === 'cancelled' || invoice.status === 'void') {
        return err({
          code: PaymentServiceError.INVOICE_CANCELLED,
          message: 'Cannot make payment on cancelled invoice',
        });
      }
    }

    const now = new Date().toISOString();
    const paymentNumber = await this.generatePaymentNumber(tenantId);
    const paymentId = asPaymentId(`pay_${Date.now()}_${randomHex(4)}`);

    const fee = zeroMoney(input.amount.currency);
    const netAmount = subtractMoney(input.amount, fee);

    const payment: Payment = {
      id: paymentId,
      tenantId,
      paymentNumber,
      invoiceId: input.invoiceId ?? null,
      customerId: input.customerId,
      leaseId: input.leaseId ?? null,
      status: 'completed',
      method: input.method,
      amount: input.amount,
      fee,
      netAmount,
      currency: input.amount.currency,
      reference: input.reference ?? null,
      externalId: input.externalId ?? null,
      externalReference: input.externalReference ?? null,
      description: input.description,
      payerName: input.payerName ?? null,
      payerPhone: input.payerPhone ?? null,
      payerEmail: input.payerEmail ?? null,
      reconciliationStatus: input.invoiceId ? 'matched' : 'pending',
      reconciliationConfidence: input.invoiceId ? 100 : 0,
      reconciledAt: input.invoiceId ? now : null,
      reconciledBy: input.invoiceId ? createdBy : null,
      failureReason: null,
      receiptUrl: null,
      metadata: input.metadata ?? {},
      processedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const savedPayment = await this.paymentRepo.create(payment);

    // Update invoice if linked
    if (invoice) {
      await this.applyPaymentToInvoice(invoice, savedPayment, createdBy, correlationId);
    }

    // Create ledger transaction
    await this.createTransaction(tenantId, {
      type: 'credit',
      category: this.getCategoryFromInvoice(invoice),
      customerId: input.customerId,
      leaseId: input.leaseId ?? null,
      propertyId: invoice?.propertyId ?? null,
      unitId: invoice?.unitId ?? null,
      invoiceId: input.invoiceId ?? null,
      paymentId: savedPayment.id,
      amount: savedPayment.amount,
      description: input.description,
      reference: paymentNumber,
    }, createdBy);

    // Publish event
    const event: PaymentReceivedEvent = {
      eventId: generateEventId(),
      eventType: 'PaymentReceived',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        paymentId: savedPayment.id,
        paymentNumber: savedPayment.paymentNumber,
        customerId: savedPayment.customerId,
        invoiceId: savedPayment.invoiceId,
        amount: savedPayment.amount,
        method: savedPayment.method,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedPayment.id, 'Payment'));

    return ok(savedPayment);
  }

  /**
   * Initiate a mobile money payment (M-Pesa, etc.).
   */
  async initiateMobilePayment(
    tenantId: TenantId,
    input: InitiateMobilePaymentInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Payment, PaymentServiceErrorResult>> {
    const provider = this.providers.get(input.method);
    if (!provider) {
      return err({
        code: PaymentServiceError.INVALID_PAYMENT_METHOD,
        message: `Payment method ${input.method} is not configured`,
      });
    }

    // Validate amount
    if (!isPositive(input.amount)) {
      return err({
        code: PaymentServiceError.INVALID_AMOUNT,
        message: 'Payment amount must be positive',
      });
    }

    const now = new Date().toISOString();
    const paymentNumber = await this.generatePaymentNumber(tenantId);
    const paymentId = asPaymentId(`pay_${Date.now()}_${randomHex(4)}`);

    // Create pending payment record
    const payment: Payment = {
      id: paymentId,
      tenantId,
      paymentNumber,
      invoiceId: input.invoiceId ?? null,
      customerId: input.customerId,
      leaseId: input.leaseId ?? null,
      status: 'pending',
      method: input.method,
      amount: input.amount,
      fee: zeroMoney(input.amount.currency),
      netAmount: input.amount,
      currency: input.amount.currency,
      reference: null,
      externalId: null,
      externalReference: null,
      description: input.description,
      payerName: null,
      payerPhone: input.phone,
      payerEmail: null,
      reconciliationStatus: 'pending',
      reconciliationConfidence: 0,
      reconciledAt: null,
      reconciledBy: null,
      failureReason: null,
      receiptUrl: null,
      metadata: {},
      processedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy,
    };

    const savedPayment = await this.paymentRepo.create(payment);

    // Initiate payment with provider
    const response = await provider.initiate({
      amount: input.amount,
      phone: input.phone,
      reference: paymentNumber,
      description: input.description,
    });

    // Update payment with external ID
    const updatedPayment: Payment = {
      ...savedPayment,
      status: response.success ? 'processing' : 'failed',
      externalId: response.externalId,
      failureReason: response.error ?? null,
      updatedAt: new Date().toISOString(),
      updatedBy: createdBy,
    };

    const finalPayment = await this.paymentRepo.update(updatedPayment);
    return ok(finalPayment);
  }

  /**
   * Get a payment by ID.
   */
  async getPayment(paymentId: PaymentId, tenantId: TenantId): Promise<Payment | null> {
    return this.paymentRepo.findById(paymentId, tenantId);
  }

  /**
   * List payments.
   */
  async listPayments(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Payment>> {
    return this.paymentRepo.findMany(tenantId, pagination);
  }

  /**
   * List payments by customer.
   */
  async listPaymentsByCustomer(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Payment>> {
    return this.paymentRepo.findByCustomer(customerId, tenantId, pagination);
  }

  /**
   * Get unreconciled payments.
   */
  async getUnreconciledPayments(tenantId: TenantId): Promise<Payment[]> {
    return this.paymentRepo.findUnreconciled(tenantId);
  }

  /**
   * Reconcile a payment with an invoice.
   */
  async reconcilePayment(
    paymentId: PaymentId,
    invoiceId: InvoiceId,
    tenantId: TenantId,
    reconciledBy: UserId,
    correlationId: string
  ): Promise<Result<Payment, PaymentServiceErrorResult>> {
    const payment = await this.paymentRepo.findById(paymentId, tenantId);
    if (!payment) {
      return err({
        code: PaymentServiceError.PAYMENT_NOT_FOUND,
        message: 'Payment not found',
      });
    }

    const invoice = await this.invoiceRepo.findById(invoiceId, tenantId);
    if (!invoice) {
      return err({
        code: PaymentServiceError.INVOICE_NOT_FOUND,
        message: 'Invoice not found',
      });
    }

    const now = new Date().toISOString();
    const updatedPayment: Payment = {
      ...payment,
      invoiceId,
      reconciliationStatus: 'matched',
      reconciliationConfidence: 100,
      reconciledAt: now,
      reconciledBy,
      updatedAt: now,
      updatedBy: reconciledBy,
    };

    const savedPayment = await this.paymentRepo.update(updatedPayment);

    // Apply payment to invoice
    await this.applyPaymentToInvoice(invoice, savedPayment, reconciledBy, correlationId);

    return ok(savedPayment);
  }

  // ==================== Ledger Operations ====================

  /**
   * Get customer balance (amount owed).
   */
  async getCustomerBalance(customerId: CustomerId, tenantId: TenantId): Promise<Money> {
    return this.transactionRepo.getCustomerBalance(customerId, tenantId);
  }

  /**
   * Get property balance.
   */
  async getPropertyBalance(propertyId: PropertyId, tenantId: TenantId): Promise<Money> {
    return this.transactionRepo.getPropertyBalance(propertyId, tenantId);
  }

  /**
   * Get customer statement (transactions).
   */
  async getCustomerStatement(
    customerId: CustomerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Transaction>> {
    return this.transactionRepo.findByCustomer(customerId, tenantId, pagination);
  }

  // ==================== Helpers ====================

  private async applyPaymentToInvoice(
    invoice: Invoice,
    payment: Payment,
    updatedBy: UserId,
    correlationId: string
  ): Promise<void> {
    const newAmountPaid = addMoney(invoice.amountPaid, payment.amount);
    const newAmountDue = subtractMoney(invoice.total, newAmountPaid);

    let newStatus: InvoiceStatus = invoice.status;
    if (!isPositive(newAmountDue) || newAmountDue.amount === 0) {
      newStatus = 'paid';
    } else if (isPositive(newAmountPaid) && newAmountPaid.amount < invoice.total.amount) {
      newStatus = 'partially_paid';
    }

    const now = new Date().toISOString();
    const updatedInvoice: Invoice = {
      ...invoice,
      status: newStatus,
      amountPaid: newAmountPaid,
      amountDue: newAmountDue,
      paidAt: newStatus === 'paid' ? now : invoice.paidAt,
      updatedAt: now,
      updatedBy,
    };

    await this.invoiceRepo.update(updatedInvoice);

    // Publish event if fully paid
    if (newStatus === 'paid') {
      const event: InvoicePaidEvent = {
        eventId: generateEventId(),
        eventType: 'InvoicePaid',
        timestamp: now,
        tenantId: invoice.tenantId,
        correlationId,
        causationId: null,
        metadata: {},
        payload: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          paidAmount: invoice.total,
        },
      };

      await this.eventBus.publish(createEventEnvelope(event, invoice.id, 'Invoice'));
    }
  }

  private async createTransaction(
    tenantId: TenantId,
    input: {
      type: TransactionType;
      category: TransactionCategory;
      customerId: CustomerId | null;
      leaseId: LeaseId | null;
      propertyId: PropertyId | null;
      unitId: UnitId | null;
      invoiceId: InvoiceId | null;
      paymentId: PaymentId | null;
      amount: Money;
      description: string;
      reference: string | null;
    },
    postedBy: UserId
  ): Promise<Transaction> {
    const now = new Date().toISOString();
    const transactionNumber = await this.generateTransactionNumber(tenantId);
    const transactionId = asTransactionId(`txn_${Date.now()}_${randomHex(4)}`);

    // Get running balance (simplified - in production would lock for consistency)
    let runningBalance = zeroMoney(input.amount.currency);
    if (input.customerId) {
      const currentBalance = await this.transactionRepo.getCustomerBalance(input.customerId, tenantId);
      runningBalance = input.type === 'credit' 
        ? subtractMoney(currentBalance, input.amount)
        : addMoney(currentBalance, input.amount);
    }

    const transaction: Transaction = {
      id: transactionId,
      tenantId,
      transactionNumber,
      type: input.type,
      category: input.category,
      customerId: input.customerId,
      leaseId: input.leaseId,
      propertyId: input.propertyId,
      unitId: input.unitId,
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
      amount: input.amount,
      runningBalance,
      description: input.description,
      reference: input.reference,
      effectiveDate: now,
      postedAt: now,
      postedBy,
      reversedBy: null,
      createdAt: now,
    };

    return this.transactionRepo.create(transaction);
  }

  private getCategoryFromInvoice(invoice: Invoice | null): TransactionCategory {
    if (!invoice || invoice.lineItems.length === 0) return 'other';
    const primaryType = invoice.lineItems[0].type;
    
    switch (primaryType) {
      case 'rent': return 'rent_income';
      case 'deposit': return 'deposit_received';
      case 'late_fee': return 'late_fee_income';
      case 'utility': return 'utility_income';
      case 'service_charge': return 'service_charge_income';
      default: return 'other';
    }
  }

  private async generateInvoiceNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.invoiceRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return `INV-${year}-${String(sequence).padStart(5, '0')}`;
  }

  private async generatePaymentNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.paymentRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return `PAY-${year}-${String(sequence).padStart(5, '0')}`;
  }

  private async generateTransactionNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.transactionRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return `TXN-${year}-${String(sequence).padStart(6, '0')}`;
  }
}
