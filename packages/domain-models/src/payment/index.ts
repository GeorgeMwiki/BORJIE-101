/**
 * Payment domain models.
 *
 * Handles all financial transactions including rent collection, disbursements,
 * and the immutable ledger for accounting purposes.
 */

import { BaseEntity, TenantScoped, Money, DateRange } from '../common';

// ============================================================================
// Payment Intent Entity
// ============================================================================

export interface PaymentIntent extends BaseEntity, TenantScoped {
  customerId: string;
  leaseId: string;
  type: PaymentType;
  amount: Money;
  fees: PaymentFees;
  status: PaymentStatus;
  paymentMethod?: PaymentMethodInfo;
  providerReference?: string;
  description: string;
  dueDate: Date;
  paidAt?: Date;
  metadata?: Record<string, unknown>;
}

export type PaymentType =
  | 'rent'
  | 'deposit'
  | 'late_fee'
  | 'utility'
  | 'maintenance_charge'
  | 'other';

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'partially_refunded';

export interface PaymentFees {
  platformFee: Money;
  processingFee: Money;
  totalFees: Money;
}

export interface PaymentMethodInfo {
  type: PaymentMethodType;
  last4?: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  bankName?: string;
  phoneNumber?: string;
}

export type PaymentMethodType =
  | 'mpesa'
  | 'card'
  | 'bank_transfer'
  | 'cash'
  | 'cheque';

// ============================================================================
// Invoice Entity
// ============================================================================

export interface Invoice extends BaseEntity, TenantScoped {
  customerId: string;
  leaseId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  billingPeriod: DateRange;
  lineItems: InvoiceLineItem[];
  subtotal: Money;
  taxes: InvoiceTax[];
  total: Money;
  amountPaid: Money;
  amountDue: Money;
  dueDate: Date;
  issuedAt: Date;
  paidAt?: Date;
  notes?: string;
}

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' | 'void';

export interface InvoiceLineItem {
  id: string;
  description: string;
  type: PaymentType;
  quantity: number;
  unitAmount: Money;
  totalAmount: Money;
}

export interface InvoiceTax {
  name: string;
  rate: number;
  amount: Money;
}

// ============================================================================
// Ledger Entry Entity (Immutable)
// ============================================================================

export interface LedgerEntry extends BaseEntity, TenantScoped {
  entryNumber: string;
  type: LedgerEntryType;
  direction: 'debit' | 'credit';
  amount: Money;
  balance: Money; // Running balance after this entry
  accountId: string;
  accountType: LedgerAccountType;
  referenceType: string;
  referenceId: string;
  description: string;
  effectiveDate: Date;
  postedAt: Date;
  postedBy: string;
  reversalOf?: string;
  reversedBy?: string;
}

export type LedgerEntryType =
  | 'rent_charge'
  | 'rent_payment'
  | 'deposit_charge'
  | 'deposit_payment'
  | 'deposit_refund'
  | 'late_fee'
  | 'adjustment'
  | 'disbursement'
  | 'owner_contribution'
  | 'maintenance_expense'
  | 'reversal';

export type LedgerAccountType =
  | 'tenant_receivable'
  | 'owner_payable'
  | 'security_deposit'
  | 'operating_account'
  | 'reserve_account';

// ============================================================================
// Statement Entity
// ============================================================================

export interface Statement extends BaseEntity, TenantScoped {
  accountId: string;
  accountType: 'customer' | 'owner';
  period: DateRange;
  openingBalance: Money;
  closingBalance: Money;
  totalDebits: Money;
  totalCredits: Money;
  entries: StatementEntry[];
  generatedAt: Date;
  documentUrl?: string;
}

export interface StatementEntry {
  date: Date;
  description: string;
  reference: string;
  debit?: Money;
  credit?: Money;
  balance: Money;
}

// ============================================================================
// Disbursement Entity
// ============================================================================

export interface Disbursement extends BaseEntity, TenantScoped {
  ownerAccountId: string;
  period: DateRange;
  status: DisbursementStatus;
  grossAmount: Money;
  deductions: DisbursementDeduction[];
  netAmount: Money;
  bankDetails: DisbursementBankDetails;
  processedAt?: Date;
  settlementReference?: string;
  statement?: DisbursementStatement;
}

export type DisbursementStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'on_hold';

export interface DisbursementDeduction {
  type: string;
  description: string;
  amount: Money;
}

export interface DisbursementBankDetails {
  accountName: string;
  bankName: string;
  accountNumber: string;
  branchCode?: string;
}

export interface DisbursementStatement {
  collections: CollectionSummary[];
  expenses: ExpenseSummary[];
  managementFee: Money;
}

export interface CollectionSummary {
  propertyId: string;
  propertyName: string;
  rentCollected: Money;
  otherIncome: Money;
  total: Money;
}

export interface ExpenseSummary {
  category: string;
  description: string;
  amount: Money;
}

// ============================================================================
// DTOs
// ============================================================================

export interface CreatePaymentIntentInput {
  customerId: string;
  leaseId: string;
  type: PaymentType;
  amount: Money;
  description: string;
  dueDate: Date;
}

export interface ProcessPaymentInput {
  paymentIntentId: string;
  paymentMethod: PaymentMethodType;
  providerToken?: string;
  phoneNumber?: string;
}

export interface CreateInvoiceInput {
  customerId: string;
  leaseId: string;
  billingPeriod: DateRange;
  lineItems: Omit<InvoiceLineItem, 'id'>[];
  dueDate: Date;
  notes?: string;
}

export interface CreateDisbursementInput {
  ownerAccountId: string;
  period: DateRange;
  deductions?: DisbursementDeduction[];
}
