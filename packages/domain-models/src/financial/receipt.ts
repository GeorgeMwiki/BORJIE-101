/**
 * Receipt domain model
 * Represents proof of payment documents
 */

import { z } from 'zod';
import type {
  TenantId,
  CustomerId,
  LeaseId,
  PropertyId,
  UnitId,
  UserId,
  ReceiptId,
  InvoiceId,
  TransactionId,
  PaymentIntentId,
  EntityMetadata,
  ISOTimestamp,
} from '../common/types';

// ============================================================================
// Enums and Schemas
// ============================================================================

export const ReceiptStatusSchema = z.enum([
  'draft',
  'issued',
  'sent',
  'voided',
  'replaced',
]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const ReceiptTypeSchema = z.enum([
  'payment',
  'deposit',
  'refund',
  'credit_note',
]);
export type ReceiptType = z.infer<typeof ReceiptTypeSchema>;

export const ReceiptDeliveryMethodSchema = z.enum([
  'email',
  'sms',
  'whatsapp',
  'print',
  'in_app',
]);
export type ReceiptDeliveryMethod = z.infer<typeof ReceiptDeliveryMethodSchema>;

export const ReceiptSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string(),
  invoiceId: z.string().optional(),
  transactionId: z.string().optional(),
  paymentIntentId: z.string().optional(),
  leaseId: z.string().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  
  // Identity
  receiptNumber: z.string(),
  
  // Type and status
  receiptType: ReceiptTypeSchema,
  status: ReceiptStatusSchema,
  
  // Payment details
  paymentMethod: z.string(),
  paymentReference: z.string().optional(),
  
  // Amounts
  amount: z.number(),
  currency: z.string().default('USD'),
  
  // Dates
  paymentDate: z.string().datetime(),
  issueDate: z.string().datetime(),
  
  // Customer snapshot at time of receipt
  customerName: z.string(),
  customerEmail: z.string().optional(),
  customerPhone: z.string().optional(),
  customerAddress: z.string().optional(),
  
  // Property snapshot
  propertyName: z.string().optional(),
  unitNumber: z.string().optional(),
  
  // Description
  description: z.string(),
  narration: z.string().optional(),
  
  // Balance info
  previousBalance: z.number().default(0),
  newBalance: z.number().default(0),
  
  // Delivery
  deliveryMethod: ReceiptDeliveryMethodSchema.optional(),
  deliveredAt: z.string().datetime().optional(),
  deliveredTo: z.string().optional(),
  
  // Document
  pdfUrl: z.string().url().optional(),
  qrCode: z.string().optional(),
  
  // Voiding
  voidedAt: z.string().datetime().optional(),
  voidedBy: z.string().optional(),
  voidReason: z.string().optional(),
  replacementReceiptId: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ReceiptData = z.infer<typeof ReceiptSchema>;

// ============================================================================
// Receipt Interface
// ============================================================================

export interface Receipt extends EntityMetadata {
  readonly id: ReceiptId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId;
  readonly invoiceId: InvoiceId | null;
  readonly transactionId: TransactionId | null;
  readonly paymentIntentId: PaymentIntentId | null;
  readonly leaseId: LeaseId | null;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  
  readonly receiptNumber: string;
  readonly receiptType: ReceiptType;
  readonly status: ReceiptStatus;
  
  readonly paymentMethod: string;
  readonly paymentReference: string | null;
  
  readonly amount: number;
  readonly currency: string;
  
  readonly paymentDate: ISOTimestamp;
  readonly issueDate: ISOTimestamp;
  
  readonly customerName: string;
  readonly customerEmail: string | null;
  readonly customerPhone: string | null;
  readonly customerAddress: string | null;
  
  readonly propertyName: string | null;
  readonly unitNumber: string | null;
  
  readonly description: string;
  readonly narration: string | null;
  
  readonly previousBalance: number;
  readonly newBalance: number;
  
  readonly deliveryMethod: ReceiptDeliveryMethod | null;
  readonly deliveredAt: ISOTimestamp | null;
  readonly deliveredTo: string | null;
  
  readonly pdfUrl: string | null;
  readonly qrCode: string | null;
  
  readonly voidedAt: ISOTimestamp | null;
  readonly voidedBy: UserId | null;
  readonly voidReason: string | null;
  readonly replacementReceiptId: ReceiptId | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createReceipt(
  id: ReceiptId,
  data: {
    tenantId: TenantId;
    customerId: CustomerId;
    receiptNumber: string;
    receiptType: ReceiptType;
    paymentMethod: string;
    amount: number;
    paymentDate: Date;
    customerName: string;
    description: string;
    currency?: string;
    invoiceId?: InvoiceId;
    transactionId?: TransactionId;
    paymentIntentId?: PaymentIntentId;
    leaseId?: LeaseId;
    propertyId?: PropertyId;
    unitId?: UnitId;
    paymentReference?: string;
    customerEmail?: string;
    customerPhone?: string;
    customerAddress?: string;
    propertyName?: string;
    unitNumber?: string;
    narration?: string;
    previousBalance?: number;
  },
  createdBy: UserId
): Receipt {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId,
    invoiceId: data.invoiceId ?? null,
    transactionId: data.transactionId ?? null,
    paymentIntentId: data.paymentIntentId ?? null,
    leaseId: data.leaseId ?? null,
    propertyId: data.propertyId ?? null,
    unitId: data.unitId ?? null,
    
    receiptNumber: data.receiptNumber,
    receiptType: data.receiptType,
    status: 'draft',
    
    paymentMethod: data.paymentMethod,
    paymentReference: data.paymentReference ?? null,
    
    amount: data.amount,
    currency: data.currency ?? 'USD',
    
    paymentDate: data.paymentDate.toISOString(),
    issueDate: now,
    
    customerName: data.customerName,
    customerEmail: data.customerEmail ?? null,
    customerPhone: data.customerPhone ?? null,
    customerAddress: data.customerAddress ?? null,
    
    propertyName: data.propertyName ?? null,
    unitNumber: data.unitNumber ?? null,
    
    description: data.description,
    narration: data.narration ?? null,
    
    previousBalance: data.previousBalance ?? 0,
    newBalance: (data.previousBalance ?? 0) - data.amount,
    
    deliveryMethod: null,
    deliveredAt: null,
    deliveredTo: null,
    
    pdfUrl: null,
    qrCode: null,
    
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    replacementReceiptId: null,
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function issueReceipt(receipt: Receipt, updatedBy: UserId): Receipt {
  if (receipt.status !== 'draft') {
    throw new Error('Can only issue draft receipts');
  }
  return {
    ...receipt,
    status: 'issued',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function sendReceipt(
  receipt: Receipt,
  deliveryMethod: ReceiptDeliveryMethod,
  deliveredTo: string,
  updatedBy: UserId
): Receipt {
  if (receipt.status === 'voided') {
    throw new Error('Cannot send voided receipts');
  }
  const now = new Date().toISOString();
  return {
    ...receipt,
    status: 'sent',
    deliveryMethod,
    deliveredAt: now,
    deliveredTo,
    updatedAt: now,
    updatedBy,
  };
}

export function voidReceipt(
  receipt: Receipt,
  reason: string,
  updatedBy: UserId
): Receipt {
  if (receipt.status === 'voided') {
    throw new Error('Receipt is already voided');
  }
  const now = new Date().toISOString();
  return {
    ...receipt,
    status: 'voided',
    voidedAt: now,
    voidedBy: updatedBy,
    voidReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

export function generateReceiptNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}
