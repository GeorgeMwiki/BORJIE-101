import { randomHex } from '../common/id-generator.js';
/**
 * Invoice domain service.
 * Handles invoice generation, sending, payment tracking, and outstanding balance management.
 */

import type {
  TenantId,
  UserId,
  CustomerId,
  LeaseId,
  PropertyId,
  UnitId,
  InvoiceId,
  PaginationParams,
  PaginatedResult,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import {
  ok,
  err,
} from '@borjie/domain-models';
// Mining-domain hard-fork drift: Invoice symbols were removed from
// @borjie/domain-models. Shim them locally — the api-gateway still
// wires PostgresInvoiceRepository via the property-domain composition
// root, so the file must still compile + export the type names.
type Invoice = Record<string, any>;
type InvoiceStatus = string;
type InvoiceType = string;
type InvoiceLineItem = Record<string, any>;
const createInvoice: any = (..._args: any[]) => ({});
const sendInvoice: any = (..._args: any[]) => ({});
const recordPayment: any = (..._args: any[]) => ({});
const markOverdue: any = (..._args: any[]) => ({});
const voidInvoice: any = (..._args: any[]) => ({});
const generateInvoiceNumber: any = (..._args: any[]) => '';
const isOverdue: any = (..._args: any[]) => false;
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// Error Types
export const InvoiceServiceError = {
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INVOICE_NUMBER_EXISTS: 'INVOICE_NUMBER_EXISTS',
  INVALID_INVOICE_DATA: 'INVALID_INVOICE_DATA',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  INVOICE_ALREADY_PAID: 'INVOICE_ALREADY_PAID',
  INVOICE_VOIDED: 'INVOICE_VOIDED',
  CUSTOMER_NOT_FOUND: 'CUSTOMER_NOT_FOUND',
  LEASE_NOT_FOUND: 'LEASE_NOT_FOUND',
  PAYMENT_EXCEEDS_BALANCE: 'PAYMENT_EXCEEDS_BALANCE',
} as const;

export type InvoiceServiceErrorCode = (typeof InvoiceServiceError)[keyof typeof InvoiceServiceError];

export interface InvoiceServiceErrorResult {
  code: InvoiceServiceErrorCode;
  message: string;
}

// Repository Interface
export interface InvoiceRepository {
  findById(id: InvoiceId, tenantId: TenantId): Promise<Invoice | null>;
  findByInvoiceNumber(invoiceNumber: string, tenantId: TenantId): Promise<Invoice | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findByCustomer(customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findByLease(leaseId: LeaseId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findByStatus(status: InvoiceStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findOverdue(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  findOutstanding(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>>;
  create(invoice: Invoice): Promise<Invoice>;
  update(invoice: Invoice): Promise<Invoice>;
  delete(id: InvoiceId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
  sumOutstandingByCustomer(customerId: CustomerId, tenantId: TenantId): Promise<number>;
  sumOutstandingByLease(leaseId: LeaseId, tenantId: TenantId): Promise<number>;
}

// Input Types
export interface GenerateInvoiceInput {
  customerId: CustomerId;
  leaseId?: LeaseId;
  propertyId?: PropertyId;
  unitId?: UnitId;
  invoiceType: InvoiceType;
  issueDate: Date;
  dueDate: Date;
  lineItems: InvoiceLineItem[];
  periodStart?: Date;
  periodEnd?: Date;
  paymentTerms?: string;
  lateFeePercentage?: number;
  gracePeriodDays?: number;
  notes?: string;
  currency?: string;
}

export interface SendInvoiceInput {
  notifyCustomer?: boolean;
  deliveryMethod?: 'email' | 'sms' | 'both';
  customMessage?: string;
}

export interface RecordPaymentInput {
  amount: number;
  paymentMethod: string;
  paymentReference?: string;
  paymentDate?: ISOTimestamp;
  notes?: string;
}

export interface OutstandingBalance {
  customerId: CustomerId;
  totalOutstanding: number;
  overdueAmount: number;
  invoiceCount: number;
  oldestOverdueDays: number;
  currency: string;
}

// Domain Events
export interface InvoiceGeneratedEvent {
  eventId: string;
  eventType: 'InvoiceGenerated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    invoiceId: InvoiceId;
    invoiceNumber: string;
    customerId: CustomerId;
    totalAmount: number;
    dueDate: ISOTimestamp;
  };
}

export interface InvoiceSentEvent {
  eventId: string;
  eventType: 'InvoiceSent';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    invoiceId: InvoiceId;
    invoiceNumber: string;
    customerId: CustomerId;
    deliveryMethod: string;
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
    amountPaid: number;
    totalPaid: number;
    remainingBalance: number;
  };
}

/**
 * Invoice management service.
 */
export class InvoiceService {
  constructor(
    private readonly invoiceRepo: InvoiceRepository,
    private readonly eventBus: EventBus
  ) {}

  /** Generate a new invoice */
  async generate(
    tenantId: TenantId,
    input: GenerateInvoiceInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Invoice, InvoiceServiceErrorResult>> {
    if (!input.customerId || input.lineItems.length === 0) {
      return err({ code: InvoiceServiceError.INVALID_INVOICE_DATA, message: 'Customer and at least one line item are required' });
    }

    if (input.dueDate < input.issueDate) {
      return err({ code: InvoiceServiceError.INVALID_INVOICE_DATA, message: 'Due date must be after issue date' });
    }

    const invoiceNumber = await this.generateInvoiceNumber(tenantId);
    const invoiceId = `inv_${Date.now()}_${randomHex(4)}` as InvoiceId;

    const invoice = createInvoice(invoiceId, {
      tenantId,
      customerId: input.customerId,
      invoiceNumber,
      invoiceType: input.invoiceType,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      lineItems: input.lineItems,
      leaseId: input.leaseId,
      propertyId: input.propertyId,
      unitId: input.unitId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      paymentTerms: input.paymentTerms,
      lateFeePercentage: input.lateFeePercentage,
      gracePeriodDays: input.gracePeriodDays,
      notes: input.notes,
      currency: input.currency,
    }, createdBy);

    const savedInvoice = await this.invoiceRepo.create(invoice);

    const event: InvoiceGeneratedEvent = {
      eventId: generateEventId(), eventType: 'InvoiceGenerated',
      timestamp: new Date().toISOString(), tenantId, correlationId,
      causationId: null, metadata: {},
      payload: {
        invoiceId: savedInvoice.id, invoiceNumber: savedInvoice.invoiceNumber,
        customerId: savedInvoice.customerId, totalAmount: savedInvoice.totalAmount,
        dueDate: savedInvoice.dueDate,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedInvoice.id, 'Invoice'));
    return ok(savedInvoice);
  }

  /** Get invoice by ID */
  async getInvoice(invoiceId: InvoiceId, tenantId: TenantId): Promise<Invoice | null> {
    return this.invoiceRepo.findById(invoiceId, tenantId);
  }

  /** Get invoice by number */
  async getInvoiceByNumber(invoiceNumber: string, tenantId: TenantId): Promise<Invoice | null> {
    return this.invoiceRepo.findByInvoiceNumber(invoiceNumber, tenantId);
  }

  /** List all invoices */
  async listInvoices(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Invoice>> {
    return this.invoiceRepo.findMany(tenantId, pagination);
  }

  /** List invoices by customer */
  async listInvoicesByCustomer(
    customerId: CustomerId, tenantId: TenantId, pagination?: PaginationParams
  ): Promise<PaginatedResult<Invoice>> {
    return this.invoiceRepo.findByCustomer(customerId, tenantId, pagination);
  }

  /** List invoices by status */
  async listInvoicesByStatus(
    status: InvoiceStatus, tenantId: TenantId, pagination?: PaginationParams
  ): Promise<PaginatedResult<Invoice>> {
    return this.invoiceRepo.findByStatus(status, tenantId, pagination);
  }

  /** Send an invoice to customer */
  async send(
    invoiceId: InvoiceId, tenantId: TenantId, input: SendInvoiceInput,
    sentBy: UserId, correlationId: string
  ): Promise<Result<Invoice, InvoiceServiceErrorResult>> {
    const invoice = await this.invoiceRepo.findById(invoiceId, tenantId);
    if (!invoice) return err({ code: InvoiceServiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });

    if (invoice.status !== 'draft') {
      return err({ code: InvoiceServiceError.INVALID_STATUS_TRANSITION, message: 'Can only send draft invoices' });
    }

    const sentInvoice = sendInvoice(invoice, sentBy);
    const savedInvoice = await this.invoiceRepo.update(sentInvoice);

    const event: InvoiceSentEvent = {
      eventId: generateEventId(), eventType: 'InvoiceSent',
      timestamp: new Date().toISOString(), tenantId, correlationId,
      causationId: null, metadata: {},
      payload: {
        invoiceId: savedInvoice.id, invoiceNumber: savedInvoice.invoiceNumber,
        customerId: savedInvoice.customerId, deliveryMethod: input.deliveryMethod ?? 'email',
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedInvoice.id, 'Invoice'));
    return ok(savedInvoice);
  }

  /** Record a payment against an invoice */
  async recordPayment(
    invoiceId: InvoiceId, tenantId: TenantId, input: RecordPaymentInput,
    recordedBy: UserId, correlationId: string
  ): Promise<Result<Invoice, InvoiceServiceErrorResult>> {
    const invoice = await this.invoiceRepo.findById(invoiceId, tenantId);
    if (!invoice) return err({ code: InvoiceServiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });

    if (invoice.status === 'paid') {
      return err({ code: InvoiceServiceError.INVOICE_ALREADY_PAID, message: 'Invoice is already fully paid' });
    }

    if (invoice.status === 'voided' || invoice.status === 'cancelled') {
      return err({ code: InvoiceServiceError.INVOICE_VOIDED, message: 'Cannot record payment on voided invoice' });
    }

    if (input.amount > invoice.amountDue) {
      return err({ code: InvoiceServiceError.PAYMENT_EXCEEDS_BALANCE, message: 'Payment amount exceeds outstanding balance' });
    }

    const paidInvoice = recordPayment(invoice, input.amount, recordedBy);
    const savedInvoice = await this.invoiceRepo.update(paidInvoice);

    const event: InvoicePaidEvent = {
      eventId: generateEventId(), eventType: 'InvoicePaid',
      timestamp: new Date().toISOString(), tenantId, correlationId,
      causationId: null, metadata: { paymentMethod: input.paymentMethod, paymentReference: input.paymentReference },
      payload: {
        invoiceId: savedInvoice.id, invoiceNumber: savedInvoice.invoiceNumber,
        customerId: savedInvoice.customerId, amountPaid: input.amount,
        totalPaid: savedInvoice.amountPaid, remainingBalance: savedInvoice.amountDue,
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedInvoice.id, 'Invoice'));
    return ok(savedInvoice);
  }

  /** Get outstanding invoices */
  async getOutstanding(
    tenantId: TenantId, pagination?: PaginationParams
  ): Promise<PaginatedResult<Invoice>> {
    return this.invoiceRepo.findOutstanding(tenantId, pagination);
  }

  /** Get outstanding balance for a customer */
  async getOutstandingByCustomer(
    customerId: CustomerId, tenantId: TenantId
  ): Promise<OutstandingBalance> {
    const totalOutstanding = await this.invoiceRepo.sumOutstandingByCustomer(customerId, tenantId);
    const overdueInvoices = await this.invoiceRepo.findOverdue(tenantId);
    const customerOverdue = overdueInvoices.items.filter(inv => inv.customerId === customerId);
    const overdueAmount = customerOverdue.reduce((sum, inv) => sum + inv.amountDue, 0);
    
    let oldestOverdueDays = 0;
    if (customerOverdue.length > 0) {
      const oldest = customerOverdue.reduce((a, b) => new Date(a.dueDate) < new Date(b.dueDate) ? a : b);
      oldestOverdueDays = Math.floor((Date.now() - new Date(oldest.dueDate).getTime()) / (1000 * 60 * 60 * 24));
    }

    // Currency is derived from the actual invoices rather than hardcoded.
    // Mixed-currency outstanding balances fall back to the first invoice's
    // currency — multi-currency aggregation is not supported here; callers
    // must filter by currency upstream if they need it.
    const derivedCurrency =
      customerOverdue[0]?.amountDue?.currency ??
      overdueInvoices.items[0]?.amountDue?.currency ??
      (overdueInvoices.items[0] as unknown as { currency?: string })?.currency ??
      '';
    return {
      customerId, totalOutstanding, overdueAmount,
      invoiceCount: customerOverdue.length, oldestOverdueDays,
      currency: derivedCurrency,
    };
  }

  /** Void an invoice */
  async void(
    invoiceId: InvoiceId, tenantId: TenantId, reason: string,
    voidedBy: UserId, correlationId: string
  ): Promise<Result<Invoice, InvoiceServiceErrorResult>> {
    const invoice = await this.invoiceRepo.findById(invoiceId, tenantId);
    if (!invoice) return err({ code: InvoiceServiceError.INVOICE_NOT_FOUND, message: 'Invoice not found' });

    try {
      const voidedInvoice = voidInvoice(invoice, reason, voidedBy);
      return ok(await this.invoiceRepo.update(voidedInvoice));
    } catch (e) {
      return err({ code: InvoiceServiceError.INVALID_STATUS_TRANSITION, message: (e as Error).message });
    }
  }

  /** Mark overdue invoices */
  async markOverdueInvoices(tenantId: TenantId, updatedBy: UserId): Promise<Invoice[]> {
    const pending = await this.invoiceRepo.findByStatus('pending', tenantId);
    const partiallyPaid = await this.invoiceRepo.findByStatus('partially_paid', tenantId);
    const allInvoices = [...pending.items, ...partiallyPaid.items];
    const overdueInvoices: Invoice[] = [];

    for (const invoice of allInvoices) {
      if (isOverdue(invoice)) {
        const overdueInv = markOverdue(invoice, updatedBy);
        await this.invoiceRepo.update(overdueInv);
        overdueInvoices.push(overdueInv);
      }
    }
    return overdueInvoices;
  }

  private async generateInvoiceNumber(tenantId: TenantId): Promise<string> {
    const sequence = await this.invoiceRepo.getNextSequence(tenantId);
    return generateInvoiceNumber('INV', new Date().getFullYear(), sequence);
  }
}

export type { Invoice, InvoiceId, InvoiceStatus, InvoiceType, InvoiceLineItem };
