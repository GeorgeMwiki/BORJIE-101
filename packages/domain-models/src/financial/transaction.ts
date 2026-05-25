/**
 * Transaction domain model
 * Represents financial transactions in the system
 */

import { z } from 'zod';
import type {
  TenantId,
  CustomerId,
  LeaseId,
  PropertyId,
  UnitId,
  UserId,
  TransactionId,
  InvoiceId,
  PaymentIntentId,
  AccountId,
  EntityMetadata,
  ISOTimestamp,
} from '../common/types';

// ============================================================================
// Enums and Schemas
// ============================================================================

export const TransactionStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'reversed',
  'disputed',
]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TransactionTypeSchema = z.enum([
  'payment',
  'refund',
  'deposit',
  'withdrawal',
  'transfer',
  'fee',
  'adjustment',
  'reversal',
  'chargeback',
]);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

export const TransactionCategorySchema = z.enum([
  'rent',
  'deposit',
  'utility',
  'maintenance',
  'late_fee',
  'penalty',
  'service_charge',
  'platform_fee',
  'owner_disbursement',
  'other',
]);
export type TransactionCategory = z.infer<typeof TransactionCategorySchema>;

export const PaymentMethodTypeSchema = z.enum([
  'mpesa',
  'mpesa_paybill',
  'mpesa_stk',
  'card',
  'bank_transfer',
  'cash',
  'cheque',
  'mobile_money',
  'wallet',
]);
export type PaymentMethodType = z.infer<typeof PaymentMethodTypeSchema>;

export const TransactionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  customerId: z.string().optional(),
  invoiceId: z.string().optional(),
  paymentIntentId: z.string().optional(),
  leaseId: z.string().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  
  // Accounting
  debitAccountId: z.string().optional(),
  creditAccountId: z.string().optional(),
  
  // Identity
  transactionRef: z.string(),
  externalRef: z.string().optional(),
  
  // Type and status
  transactionType: TransactionTypeSchema,
  category: TransactionCategorySchema,
  status: TransactionStatusSchema,
  
  // Amounts
  amount: z.number(),
  fee: z.number().default(0),
  netAmount: z.number(),
  currency: z.string().default('USD'),
  exchangeRate: z.number().default(1),
  
  // Payment method
  paymentMethodType: PaymentMethodTypeSchema.optional(),
  paymentMethodDetails: z.record(z.string(), z.unknown()).default({}),
  
  // Provider details
  providerName: z.string().optional(),
  providerTransactionId: z.string().optional(),
  providerStatus: z.string().optional(),
  providerResponse: z.record(z.string(), z.unknown()).default({}),
  
  // Dates
  transactionDate: z.string().datetime(),
  valueDate: z.string().datetime().optional(),
  settledAt: z.string().datetime().optional(),
  
  // Description
  description: z.string(),
  narration: z.string().optional(),
  
  // Related transaction (for reversals/refunds)
  relatedTransactionId: z.string().optional(),
  
  // Failure details
  failedAt: z.string().datetime().optional(),
  failureReason: z.string().optional(),
  failureCode: z.string().optional(),
  
  // Reversal details
  reversedAt: z.string().datetime().optional(),
  reversedBy: z.string().optional(),
  reversalReason: z.string().optional(),
  
  // Reconciliation
  reconciledAt: z.string().datetime().optional(),
  reconciledBy: z.string().optional(),
  reconciliationRef: z.string().optional(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type TransactionData = z.infer<typeof TransactionSchema>;

// ============================================================================
// Transaction Interface
// ============================================================================

export interface Transaction extends EntityMetadata {
  readonly id: TransactionId;
  readonly tenantId: TenantId;
  readonly customerId: CustomerId | null;
  readonly invoiceId: InvoiceId | null;
  readonly paymentIntentId: PaymentIntentId | null;
  readonly leaseId: LeaseId | null;
  readonly propertyId: PropertyId | null;
  readonly unitId: UnitId | null;
  
  readonly debitAccountId: AccountId | null;
  readonly creditAccountId: AccountId | null;
  
  readonly transactionRef: string;
  readonly externalRef: string | null;
  
  readonly transactionType: TransactionType;
  readonly category: TransactionCategory;
  readonly status: TransactionStatus;
  
  readonly amount: number;
  readonly fee: number;
  readonly netAmount: number;
  readonly currency: string;
  readonly exchangeRate: number;
  
  readonly paymentMethodType: PaymentMethodType | null;
  readonly paymentMethodDetails: Record<string, unknown>;
  
  readonly providerName: string | null;
  readonly providerTransactionId: string | null;
  readonly providerStatus: string | null;
  readonly providerResponse: Record<string, unknown>;
  
  readonly transactionDate: ISOTimestamp;
  readonly valueDate: ISOTimestamp | null;
  readonly settledAt: ISOTimestamp | null;
  
  readonly description: string;
  readonly narration: string | null;
  
  readonly relatedTransactionId: TransactionId | null;
  
  readonly failedAt: ISOTimestamp | null;
  readonly failureReason: string | null;
  readonly failureCode: string | null;
  
  readonly reversedAt: ISOTimestamp | null;
  readonly reversedBy: UserId | null;
  readonly reversalReason: string | null;
  
  readonly reconciledAt: ISOTimestamp | null;
  readonly reconciledBy: UserId | null;
  readonly reconciliationRef: string | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createTransaction(
  id: TransactionId,
  data: {
    tenantId: TenantId;
    transactionRef: string;
    transactionType: TransactionType;
    category: TransactionCategory;
    amount: number;
    description: string;
    currency?: string;
    customerId?: CustomerId;
    invoiceId?: InvoiceId;
    paymentIntentId?: PaymentIntentId;
    leaseId?: LeaseId;
    propertyId?: PropertyId;
    unitId?: UnitId;
    debitAccountId?: AccountId;
    creditAccountId?: AccountId;
    fee?: number;
    paymentMethodType?: PaymentMethodType;
    paymentMethodDetails?: Record<string, unknown>;
    providerName?: string;
    externalRef?: string;
    narration?: string;
    transactionDate?: Date;
    valueDate?: Date;
  },
  createdBy: UserId
): Transaction {
  const now = new Date().toISOString();
  const fee = data.fee ?? 0;

  return {
    id,
    tenantId: data.tenantId,
    customerId: data.customerId ?? null,
    invoiceId: data.invoiceId ?? null,
    paymentIntentId: data.paymentIntentId ?? null,
    leaseId: data.leaseId ?? null,
    propertyId: data.propertyId ?? null,
    unitId: data.unitId ?? null,
    
    debitAccountId: data.debitAccountId ?? null,
    creditAccountId: data.creditAccountId ?? null,
    
    transactionRef: data.transactionRef,
    externalRef: data.externalRef ?? null,
    
    transactionType: data.transactionType,
    category: data.category,
    status: 'pending',
    
    amount: data.amount,
    fee,
    netAmount: data.amount - fee,
    currency: data.currency ?? 'USD',
    exchangeRate: 1,
    
    paymentMethodType: data.paymentMethodType ?? null,
    paymentMethodDetails: data.paymentMethodDetails ?? {},
    
    providerName: data.providerName ?? null,
    providerTransactionId: null,
    providerStatus: null,
    providerResponse: {},
    
    transactionDate: data.transactionDate?.toISOString() ?? now,
    valueDate: data.valueDate?.toISOString() ?? null,
    settledAt: null,
    
    description: data.description,
    narration: data.narration ?? null,
    
    relatedTransactionId: null,
    
    failedAt: null,
    failureReason: null,
    failureCode: null,
    
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
    
    reconciledAt: null,
    reconciledBy: null,
    reconciliationRef: null,
    
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

export function markProcessing(
  transaction: Transaction,
  providerTransactionId: string,
  updatedBy: UserId
): Transaction {
  if (transaction.status !== 'pending') {
    throw new Error('Can only process pending transactions');
  }
  return {
    ...transaction,
    status: 'processing',
    providerTransactionId,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

export function markCompleted(
  transaction: Transaction,
  settledAt: Date,
  updatedBy: UserId
): Transaction {
  if (transaction.status !== 'pending' && transaction.status !== 'processing') {
    throw new Error('Can only complete pending or processing transactions');
  }
  const now = new Date().toISOString();
  return {
    ...transaction,
    status: 'completed',
    settledAt: settledAt.toISOString(),
    updatedAt: now,
    updatedBy,
  };
}

export function markFailed(
  transaction: Transaction,
  failureReason: string,
  failureCode: string | undefined,
  updatedBy: UserId
): Transaction {
  if (transaction.status === 'completed' || transaction.status === 'reversed') {
    throw new Error('Cannot fail completed or reversed transactions');
  }
  const now = new Date().toISOString();
  return {
    ...transaction,
    status: 'failed',
    failedAt: now,
    failureReason,
    failureCode: failureCode ?? null,
    updatedAt: now,
    updatedBy,
  };
}

export function reverseTransaction(
  transaction: Transaction,
  reason: string,
  updatedBy: UserId
): Transaction {
  if (transaction.status !== 'completed') {
    throw new Error('Can only reverse completed transactions');
  }
  const now = new Date().toISOString();
  return {
    ...transaction,
    status: 'reversed',
    reversedAt: now,
    reversedBy: updatedBy,
    reversalReason: reason,
    updatedAt: now,
    updatedBy,
  };
}

export function reconcileTransaction(
  transaction: Transaction,
  reconciliationRef: string,
  updatedBy: UserId
): Transaction {
  if (transaction.status !== 'completed') {
    throw new Error('Can only reconcile completed transactions');
  }
  const now = new Date().toISOString();
  return {
    ...transaction,
    reconciledAt: now,
    reconciledBy: updatedBy,
    reconciliationRef,
    updatedAt: now,
    updatedBy,
  };
}

export function generateTransactionRef(prefix: string, timestamp: Date): string {
  const year = timestamp.getFullYear();
  const month = String(timestamp.getMonth() + 1).padStart(2, '0');
  const day = String(timestamp.getDate()).padStart(2, '0');
  // Crypto-strength random suffix — financial transaction refs must be
  // unguessable to prevent ID enumeration. Previously used Math.random()
  // which is not a CSPRNG.
  const { randomBytes } = require('node:crypto') as typeof import('node:crypto');
  const random = randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}${year}${month}${day}${random}`;
}
