/**
 * Financial Services Type Definitions
 * 
 * Core types for the payments-ledger service including:
 * - Ledger entries (immutable)
 * - Invoices
 * - Statements
 * - Financial calculations
 */
import { CurrencyCode } from '@borjie/domain-models';

// =============================================================================
// Branded Type Helpers
// =============================================================================

export type Brand<K, T> = K & { __brand: T };

// =============================================================================
// Identifier Types
// =============================================================================

export type LedgerEntryId = Brand<string, 'LedgerEntryId'>;
export type JournalId = Brand<string, 'JournalId'>;
export type InvoiceId = Brand<string, 'InvoiceId'>;
export type StatementId = Brand<string, 'StatementId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type OwnerId = Brand<string, 'OwnerId'>;
export type PropertyId = Brand<string, 'PropertyId'>;
export type UnitId = Brand<string, 'UnitId'>;
export type LeaseId = Brand<string, 'LeaseId'>;

// =============================================================================
// Money Types
// =============================================================================

/**
 * Serialized money representation
 * All amounts stored in minor units (cents/pennies)
 */
export interface MoneyData {
  readonly amountMinorUnits: number;
  readonly currency: CurrencyCode;
}

/**
 * Create MoneyData from major units (e.g., dollars, shillings)
 */
export function moneyFromMajorUnits(amount: number, currency: CurrencyCode): MoneyData {
  return {
    amountMinorUnits: Math.round(amount * 100),
    currency,
  };
}

/**
 * Create MoneyData from minor units (e.g., cents)
 */
export function moneyFromMinorUnits(amountMinorUnits: number, currency: CurrencyCode): MoneyData {
  return {
    amountMinorUnits,
    currency,
  };
}

/**
 * Format money for display
 */
export function formatMoney(money: MoneyData): string {
  const majorUnits = money.amountMinorUnits / 100;
  return `${money.currency} ${majorUnits.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Add two money values (must be same currency)
 */
export function addMoney(a: MoneyData, b: MoneyData): MoneyData {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return {
    amountMinorUnits: a.amountMinorUnits + b.amountMinorUnits,
    currency: a.currency,
  };
}

/**
 * Subtract money values (must be same currency)
 */
export function subtractMoney(a: MoneyData, b: MoneyData): MoneyData {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
  return {
    amountMinorUnits: a.amountMinorUnits - b.amountMinorUnits,
    currency: a.currency,
  };
}

/**
 * Zero money in a currency
 */
export function zeroMoney(currency: CurrencyCode): MoneyData {
  return { amountMinorUnits: 0, currency };
}

// =============================================================================
// Ledger Entry Types (Immutable)
// =============================================================================

/**
 * Direction of ledger entry
 * DEBIT increases asset/expense accounts, decreases liability/equity/revenue
 * CREDIT decreases asset/expense accounts, increases liability/equity/revenue
 */
export type EntryDirection = 'DEBIT' | 'CREDIT';

/**
 * Types of ledger entries
 */
export type LedgerEntryType =
  | 'RENT_CHARGE'
  | 'RENT_PAYMENT'
  | 'DEPOSIT_CHARGE'
  | 'DEPOSIT_PAYMENT'
  | 'DEPOSIT_REFUND'
  | 'LATE_FEE'
  | 'MAINTENANCE_CHARGE'
  | 'UTILITY_CHARGE'
  | 'OWNER_CONTRIBUTION'
  | 'OWNER_DISBURSEMENT'
  | 'PLATFORM_FEE'
  | 'PAYMENT_PROCESSING_FEE'
  | 'REFUND'
  | 'ADJUSTMENT'
  | 'CORRECTION'
  | 'WRITE_OFF'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT';

/**
 * Immutable ledger entry
 * Once created, entries cannot be modified - only correcting entries can be added
 */
export interface LedgerEntry {
  readonly id: LedgerEntryId;
  readonly tenantId: TenantId;
  readonly accountId: AccountId;
  readonly journalId: JournalId;
  readonly type: LedgerEntryType;
  readonly direction: EntryDirection;
  readonly amount: MoneyData;
  readonly balanceAfter: MoneyData;
  readonly sequenceNumber: number;
  readonly effectiveDate: Date;
  readonly postedAt: Date;
  readonly description?: string;
  readonly reference?: string;
  readonly paymentIntentId?: string;
  readonly leaseId?: LeaseId;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
  readonly correctionOf?: LedgerEntryId;  // Links to entry being corrected
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
  readonly createdBy: string;
}

/**
 * Journal entry request (double-entry bookkeeping)
 * Debits must equal credits for the journal to be valid
 */
export interface JournalEntryLine {
  readonly accountId: AccountId;
  readonly type: LedgerEntryType;
  readonly direction: EntryDirection;
  readonly amount: MoneyData;
  readonly description?: string;
  readonly leaseId?: LeaseId;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
  readonly metadata?: Record<string, unknown>;
}

export interface CreateJournalEntryRequest {
  readonly tenantId: TenantId;
  readonly effectiveDate: Date;
  readonly lines: JournalEntryLine[];
  readonly description?: string;
  readonly reference?: string;
  readonly paymentIntentId?: string;
  readonly createdBy: string;
}

/**
 * Correction entry request
 * Creates reversing entries for the original and new correcting entries
 */
export interface CorrectionEntryRequest {
  readonly tenantId: TenantId;
  readonly originalEntryId: LedgerEntryId;
  readonly reason: string;
  readonly correctedLines: JournalEntryLine[];
  readonly createdBy: string;
}

// =============================================================================
// Account Statement Types
// =============================================================================

export type StatementType = 'OWNER_STATEMENT' | 'CUSTOMER_STATEMENT' | 'PROPERTY_STATEMENT';
export type StatementPeriodType = 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM';
export type StatementStatus = 'DRAFT' | 'GENERATED' | 'SENT' | 'VIEWED';

/**
 * Statement line item (read-only view of ledger entries)
 */
export interface StatementLineItem {
  readonly date: Date;
  readonly type: LedgerEntryType;
  readonly description: string;
  readonly reference?: string;
  readonly debit?: MoneyData;
  readonly credit?: MoneyData;
  readonly balance: MoneyData;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
}

/**
 * Statement summary by category
 */
export interface StatementSummary {
  readonly category: string;
  readonly totalDebits: MoneyData;
  readonly totalCredits: MoneyData;
  readonly netAmount: MoneyData;
}

/**
 * Financial statement
 */
export interface Statement {
  readonly id: StatementId;
  readonly tenantId: TenantId;
  readonly type: StatementType;
  readonly status: StatementStatus;
  readonly accountId: AccountId;
  readonly ownerId?: OwnerId;
  readonly customerId?: CustomerId;
  readonly propertyId?: PropertyId;
  readonly periodType: StatementPeriodType;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly currency: CurrencyCode;
  readonly openingBalance: MoneyData;
  readonly closingBalance: MoneyData;
  readonly totalDebits: MoneyData;
  readonly totalCredits: MoneyData;
  readonly lineItems: StatementLineItem[];
  readonly summaries: StatementSummary[];
  readonly generatedAt?: Date;
  readonly sentAt?: Date;
  readonly sentTo?: string;
  readonly viewedAt?: Date;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

// =============================================================================
// Invoice Types
// =============================================================================

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'SENT' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE' | 'CANCELLED' | 'VOIDED';
export type InvoiceType = 'RENT' | 'DEPOSIT' | 'UTILITY' | 'MAINTENANCE' | 'LATE_FEE' | 'OTHER';

/**
 * Invoice line item
 */
export interface InvoiceLineItem {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: MoneyData;
  readonly amount: MoneyData;
  readonly taxRate?: number;  // Percentage (e.g., 16 for 16%)
  readonly taxAmount?: MoneyData;
  readonly totalAmount: MoneyData;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
  readonly leaseId?: LeaseId;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Tax breakdown
 */
export interface TaxBreakdown {
  readonly taxName: string;
  readonly taxRate: number;
  readonly taxableAmount: MoneyData;
  readonly taxAmount: MoneyData;
}

/**
 * Invoice payment record
 */
export interface InvoicePayment {
  readonly id: string;
  readonly amount: MoneyData;
  readonly paidAt: Date;
  readonly method: string;
  readonly reference?: string;
  readonly paymentIntentId?: string;
}

/**
 * Invoice
 */
export interface Invoice {
  readonly id: InvoiceId;
  readonly tenantId: TenantId;
  readonly invoiceNumber: string;
  readonly type: InvoiceType;
  readonly status: InvoiceStatus;
  readonly customerId: CustomerId;
  readonly customerName: string;
  readonly customerEmail?: string;
  readonly customerAddress?: string;
  readonly propertyId?: PropertyId;
  readonly propertyName?: string;
  readonly unitId?: UnitId;
  readonly unitName?: string;
  readonly leaseId?: LeaseId;
  readonly currency: CurrencyCode;
  readonly issueDate: Date;
  readonly dueDate: Date;
  readonly lineItems: InvoiceLineItem[];
  readonly subtotal: MoneyData;
  readonly taxBreakdown: TaxBreakdown[];
  readonly totalTax: MoneyData;
  readonly totalAmount: MoneyData;
  readonly amountPaid: MoneyData;
  readonly amountDue: MoneyData;
  readonly payments: InvoicePayment[];
  readonly notes?: string;
  readonly terms?: string;
  readonly reference?: string;
  readonly metadata?: Record<string, unknown>;
  readonly pdfUrl?: string;
  readonly sentAt?: Date;
  readonly paidAt?: Date;
  readonly voidedAt?: Date;
  readonly voidReason?: string;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy: string;
}

/**
 * Invoice creation request
 */
export interface CreateInvoiceRequest {
  readonly tenantId: TenantId;
  readonly type: InvoiceType;
  readonly customerId: CustomerId;
  readonly customerName: string;
  readonly customerEmail?: string;
  readonly customerAddress?: string;
  readonly propertyId?: PropertyId;
  readonly propertyName?: string;
  readonly unitId?: UnitId;
  readonly unitName?: string;
  readonly leaseId?: LeaseId;
  readonly currency: CurrencyCode;
  readonly issueDate?: Date;
  readonly dueDate: Date;
  readonly lineItems: Omit<InvoiceLineItem, 'id' | 'amount' | 'taxAmount' | 'totalAmount'>[];
  readonly notes?: string;
  readonly terms?: string;
  readonly reference?: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdBy: string;
}

// =============================================================================
// Disbursement Types
// =============================================================================

export type DisbursementStatus = 'PENDING' | 'PROCESSING' | 'IN_TRANSIT' | 'PAID' | 'FAILED' | 'CANCELLED';
export type DisbursementType = 'SCHEDULED' | 'MANUAL' | 'THRESHOLD';

/**
 * Local payment status vocabulary for payments-ledger service.
 * Uses UPPERCASE provider-style names (aligned with Stripe/M-Pesa terminology),
 * distinct from the lowercase domain-models PaymentStatus which is used in
 * aggregate/event layer. Provider adapters map to/from this local type.
 */
export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'REQUIRES_ACTION'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

/**
 * Disbursement calculation breakdown
 */
export interface DisbursementBreakdown {
  readonly grossAmount: MoneyData;
  readonly platformFee: MoneyData;
  readonly processingFee: MoneyData;
  readonly holdbackAmount: MoneyData;
  readonly netAmount: MoneyData;
  readonly items: DisbursementBreakdownItem[];
}

export interface DisbursementBreakdownItem {
  readonly type: string;
  readonly description: string;
  readonly amount: MoneyData;
  readonly propertyId?: PropertyId;
  readonly unitId?: UnitId;
}

/**
 * Disbursement
 */
export interface Disbursement {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly ownerId: OwnerId;
  readonly type: DisbursementType;
  readonly status: DisbursementStatus;
  readonly amount: MoneyData;
  readonly breakdown: DisbursementBreakdown;
  readonly destination: string;
  readonly destinationType: 'BANK_ACCOUNT' | 'MOBILE_MONEY' | 'CONNECTED_ACCOUNT';
  readonly provider?: string;
  readonly transferId?: string;
  readonly periodStart?: Date;
  readonly periodEnd?: Date;
  readonly description?: string;
  readonly idempotencyKey: string;
  readonly scheduledAt?: Date;
  readonly initiatedAt?: Date;
  readonly completedAt?: Date;
  readonly failedAt?: Date;
  readonly failureReason?: string;
  readonly estimatedArrival?: Date;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
  readonly createdBy: string;
  readonly updatedAt: Date;
  readonly updatedBy?: string;
}

// =============================================================================
// Report Types
// =============================================================================

/**
 * Account balance summary
 */
export interface AccountBalanceSummary {
  readonly accountId: AccountId;
  readonly accountName: string;
  readonly accountType: string;
  readonly balance: MoneyData;
  readonly asOfDate: Date;
  readonly lastActivityDate?: Date;
}

/**
 * Financial period summary
 */
export interface PeriodSummary {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly openingBalance: MoneyData;
  readonly closingBalance: MoneyData;
  readonly totalIncome: MoneyData;
  readonly totalExpenses: MoneyData;
  readonly netChange: MoneyData;
  readonly transactionCount: number;
}

/**
 * Owner payout summary
 */
export interface OwnerPayoutSummary {
  readonly ownerId: OwnerId;
  readonly ownerName: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly grossIncome: MoneyData;
  readonly platformFees: MoneyData;
  readonly maintenanceCosts: MoneyData;
  readonly otherDeductions: MoneyData;
  readonly netPayout: MoneyData;
  readonly properties: PropertyPayoutDetail[];
}

export interface PropertyPayoutDetail {
  readonly propertyId: PropertyId;
  readonly propertyName: string;
  readonly grossRent: MoneyData;
  readonly occupancyRate: number;
  readonly maintenanceCosts: MoneyData;
  readonly netContribution: MoneyData;
}

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that journal entries are balanced (debits = credits)
 */
export function validateJournalBalance(lines: JournalEntryLine[]): boolean {
  const totals = lines.reduce(
    (acc, line) => {
      if (line.direction === 'DEBIT') {
        acc.debits += line.amount.amountMinorUnits;
      } else {
        acc.credits += line.amount.amountMinorUnits;
      }
      return acc;
    },
    { debits: 0, credits: 0 }
  );
  return totals.debits === totals.credits;
}

/**
 * Calculate invoice totals from line items
 */
export function calculateInvoiceTotals(
  lineItems: InvoiceLineItem[],
  currency: CurrencyCode
): {
  subtotal: MoneyData;
  totalTax: MoneyData;
  totalAmount: MoneyData;
} {
  let subtotalMinor = 0;
  let taxMinor = 0;

  for (const item of lineItems) {
    subtotalMinor += item.amount.amountMinorUnits;
    if (item.taxAmount) {
      taxMinor += item.taxAmount.amountMinorUnits;
    }
  }

  return {
    subtotal: { amountMinorUnits: subtotalMinor, currency },
    totalTax: { amountMinorUnits: taxMinor, currency },
    totalAmount: { amountMinorUnits: subtotalMinor + taxMinor, currency },
  };
}

// =============================================================================
// Type Guards
// =============================================================================

export function isLedgerEntry(obj: unknown): obj is LedgerEntry {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'accountId' in obj &&
    'journalId' in obj &&
    'type' in obj &&
    'direction' in obj &&
    'amount' in obj
  );
}

export function isInvoice(obj: unknown): obj is Invoice {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'invoiceNumber' in obj &&
    'customerId' in obj &&
    'lineItems' in obj
  );
}

export function isStatement(obj: unknown): obj is Statement {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'id' in obj &&
    'type' in obj &&
    'accountId' in obj &&
    'lineItems' in obj
  );
}
