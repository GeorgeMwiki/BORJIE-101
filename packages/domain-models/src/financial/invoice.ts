/**
 * Invoice domain model
 * Represents billing documents for rent and other charges
 */

import { z } from 'zod';
import type {
  TenantId,
  CustomerId,
  LeaseId,
  PropertyId,
  UnitId,
  UserId,
  InvoiceId,
  EntityMetadata,
  SoftDeletable,
  ISOTimestamp,
} from '../common/types';
import { MoneySchema } from '../common/money';

// ============================================================================
// Enums and Schemas
// ============================================================================

export const InvoiceStatusSchema = z.enum([
  'draft',
  'pending',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
  'voided',
  'written_off',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceTypeSchema = z.enum([
  'rent',
  'deposit',
  'utility',
  'maintenance',
  'late_fee',
  'penalty',
  'service_charge',
  'other',
]);
export type InvoiceType = z.infer<typeof InvoiceTypeSchema>;

export const InvoiceLineItemSchema = z.object({
  id: z.string(),
  description: z.string(),
  quantity: z.number().positive(),
  unitPrice: z.number(),
  amount: z.number(),
  taxRate: z.number().default(0),
  taxAmount: z.number().default(0),
  totalAmount: z.number(),
  itemType: InvoiceTypeSchema,
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  leaseId: z.string().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  
  // Identity
  invoiceNumber: z.string(),
  
  // Type and status
  invoiceType: InvoiceTypeSchema,
  status: InvoiceStatusSchema,
  
  // Dates
  issueDate: z.string().datetime(),
  dueDate: z.string().datetime(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  
  // Line items
  lineItems: z.array(InvoiceLineItemSchema),
  
  // Amounts
  subtotal: z.number(),
  taxAmount: z.number().default(0),
  discountAmount: z.number().default(0),
  totalAmount: z.number(),
  amountPaid: z.number().default(0),
  amountDue: z.number(),
  currency: z.string().default('USD'),
  
  // Payment terms
  paymentTerms: z.string().optional(),
  lateFeePercentage: z.number().default(0),
  lateFeeFlat: z.number().default(0),
  gracePeriodDays: z.number().default(0),
  
  // Notes
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  
  // Reminders
  remindersSent: z.number().default(0),
  lastReminderAt: z.string().datetime().optional(),
  nextReminderAt: z.string().datetime().optional(),
  
  // Document
  pdfUrl: z.string().url().optional(),
  
  // Voiding
  voidedAt: z.string().datetime().optional(),
  voidedBy: z.string().optional(),
  voidReason: z.string().optional(),
  
  // Write-off
  writtenOffAt: z.string().datetime().optional(),
  writtenOffBy: z.string().optional(),
  writeOffReason: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type InvoiceData = z.infer<typeof InvoiceSchema>;

// ============================================================================
// Invoice Interface
// ============================================================================

export interface Invoice extends EntityMetadata, SoftDeletable {
  readonly id: InvoiceId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly leaseId: LeaseId | null;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  
  readonly invoiceNumber: string;
  readonly invoiceType: InvoiceType;
  readonly status: InvoiceStatus;
  
  readonly issueDate: ISOTimestamp;
  readonly dueDate: ISOTimestamp;
  readonly periodStart: ISOTimestamp | null;
  readonly periodEnd: ISOTimestamp | null;
  
  readonly lineItems: readonly InvoiceLineItem[];
  
  readonly subtotal: number;
  readonly taxAmount: number;
  readonly discountAmount: number;
  readonly totalAmount: number;
  readonly amountPaid: number;
  readonly amountDue: number;
  readonly currency: string;
  
  readonly paymentTerms: string | null;
  readonly lateFeePercentage: number;
  readonly lateFeeFlat: number;
  readonly gracePeriodDays: number;
  
  readonly notes: string | null;
  readonly internalNotes: string | null;
  
  readonly remindersSent: number;
  readonly lastReminderAt: ISOTimestamp | null;
  readonly nextReminderAt: ISOTimestamp | null;
  
  readonly pdfUrl: string | null;
  
  readonly voidedAt: ISOTimestamp | null;
  readonly voidedBy: UserId | null;
  readonly voidReason: string | null;
  
  readonly writtenOffAt: ISOTimestamp | null;
  readonly writtenOffBy: UserId | null;
  readonly writeOffReason: string | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createInvoice(
  id: InvoiceId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    invoiceNumber: string;
    invoiceType: InvoiceType;
    issueDate: Date;
    dueDate: Date;
    lineItems: InvoiceLineItem[];
    currency?: string;
    leaseId?: LeaseId;
    propertyId?: PropertyId;
    unitId?: UnitId;
    periodStart?: Date;
    periodEnd?: Date;
    paymentTerms?: string;
    lateFeePercentage?: number;
    lateFeeFlat?: number;
    gracePeriodDays?: number;
    notes?: string;
    internalNotes?: string;
  },
  createdBy: UserId
): Invoice {
  const now = new Date().toISOString();
  
  const subtotal = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = data.lineItems.reduce((sum, item) => sum + (item.taxAmount || 0), 0);
  const totalAmount = data.lineItems.reduce((sum, item) => sum + item.totalAmount, 0);

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    leaseId: data.leaseId ?? null,
    propertyId: data.propertyId ?? null,
    unitId: data.unitId ?? null,
    
    invoiceNumber: data.invoiceNumber,
    invoiceType: data.invoiceType,
    status: 'draft',
    
    issueDate: data.issueDate.toISOString(),
    dueDate: data.dueDate.toISOString(),
    periodStart: data.periodStart?.toISOString() ?? null,
    periodEnd: data.periodEnd?.toISOString() ?? null,
    
    lineItems: data.lineItems,
    
    subtotal,
    taxAmount,
    discountAmount: 0,
    totalAmount,
    amountPaid: 0,
    amountDue: totalAmount,
    currency: data.currency ?? 'USD',
    
    paymentTerms: data.paymentTerms ?? null,
    lateFeePercentage: data.lateFeePercentage ?? 0,
    lateFeeFlat: data.lateFeeFlat ?? 0,
    gracePeriodDays: data.gracePeriodDays ?? 0,
    
    notes: data.notes ?? null,
    internalNotes: data.internalNotes ?? null,
    
    remindersSent: 0,
    lastReminderAt: null,
    nextReminderAt: null,
    
    pdfUrl: null,
    
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    
    writtenOffAt: null,
    writtenOffBy: null,
    writeOffReason: null,
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function sendInvoice(invoice: Invoice, updatedBy: UserId): Invoice {
  if (invoice.status !== 'draft') {
    throw new Error('Can only send draft invoices');
  }
  return {
    ...invoice,
    status: 'pending',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function recordPayment(
  invoice: Invoice,
  paymentAmount: number,
  updatedBy: UserId
): Invoice {
  const newAmountPaid = invoice.amountPaid + paymentAmount;
  const newAmountDue = invoice.totalAmount - newAmountPaid;
  
  let newStatus: InvoiceStatus;
  if (newAmountDue <= 0) {
    newStatus = 'paid';
  } else if (newAmountPaid > 0) {
    newStatus = 'partially_paid';
  } else {
    newStatus = invoice.status;
  }

  return {
    ...invoice,
    amountPaid: newAmountPaid,
    amountDue: Math.max(0, newAmountDue),
    status: newStatus,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function markOverdue(invoice: Invoice, updatedBy: UserId): Invoice {
  if (invoice.status !== 'pending' && invoice.status !== 'partially_paid') {
    throw new Error('Can only mark pending or partially paid invoices as overdue');
  }
  return {
    ...invoice,
    status: 'overdue',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function voidInvoice(
  invoice: Invoice,
  reason: string,
  updatedBy: UserId
): Invoice {
  if (invoice.status === 'paid' || invoice.status === 'voided') {
    throw new Error('Cannot void paid or already voided invoices');
  }
  const now = new Date().toISOString();
  return {
    ...invoice,
    status: 'voided',
    voidedAt: now,
    voidedBy: updatedBy,
    voidReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

export function isOverdue(invoice: Invoice): boolean {
  if (invoice.status === 'paid' || invoice.status === 'voided' || invoice.status === 'cancelled') {
    return false;
  }
  const dueDate = new Date(invoice.dueDate);
  const gracePeriodEnd = new Date(dueDate);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + invoice.gracePeriodDays);
  return new Date() > gracePeriodEnd;
}

export function generateInvoiceNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}
