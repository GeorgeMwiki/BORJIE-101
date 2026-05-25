/**
 * Ledger Entry domain model
 * Represents an immutable entry in the double-entry ledger
 */
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  TenantId,
  LedgerEntryId,
  AccountId,
  PaymentIntentId,
  LeaseId,
  PropertyId,
  UnitId,
  LedgerEntryType,
  LedgerEntryTypeSchema,
  TenantScopedEntity,
  createId
} from '../common/types';
import { CurrencyCodeSchema, CurrencyCode } from '../common/enums';
import { Money, MoneySchema } from '../common/money';

/**
 * Ledger entry direction
 * DEBIT: Increases asset/expense accounts, decreases liability/equity/revenue
 * CREDIT: Decreases asset/expense accounts, increases liability/equity/revenue
 */
export const EntryDirectionSchema = z.enum(['DEBIT', 'CREDIT']);
export type EntryDirection = z.infer<typeof EntryDirectionSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  accountId: z.string(),
  journalId: z.string(),  // Groups related entries (e.g., debit + credit pair)
  
  // Entry details
  type: LedgerEntryTypeSchema,
  direction: EntryDirectionSchema,
  amount: MoneySchema,
  
  // Running balance after this entry
  balanceAfter: MoneySchema,
  
  // Sequence number for ordering and gap detection
  sequenceNumber: z.number().int().positive(),
  
  // Timestamp when entry was recorded (immutable)
  effectiveDate: z.date(),
  postedAt: z.date(),
  
  // Reference to source transaction
  paymentIntentId: z.string().optional(),
  
  // Associated entities for reporting
  leaseId: z.string().optional(),
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  
  // Human-readable description
  description: z.string().max(500),
  
  // Additional context
  metadata: z.record(z.string(), z.unknown()).optional(),
  
  // For audit trail - who created this entry
  createdBy: z.string()
});

export type LedgerEntryData = z.infer<typeof LedgerEntrySchema>;

// LedgerEntry derives its shape by composition rather than multi-interface
// extension — Omit+extend conflicted with TenantScopedEntity's audit fields.
export type LedgerEntry =
  Omit<LedgerEntryData, 'amount' | 'balanceAfter' | 'id' | 'tenantId' | 'createdBy'> &
  TenantScopedEntity & {
  id: LedgerEntryId;
  tenantId: TenantId;
  accountId: AccountId;
  paymentIntentId?: PaymentIntentId;
  leaseId?: LeaseId;
  propertyId?: PropertyId;
  unitId?: UnitId;
  amount: Money;
  balanceAfter: Money;
};

/**
 * Journal entry request - used to create balanced entries
 */
export interface JournalEntryLine {
  accountId: AccountId;
  type: LedgerEntryType;
  direction: EntryDirection;
  amount: Money;
  description: string;
  leaseId?: LeaseId;
  propertyId?: PropertyId;
  unitId?: UnitId;
  metadata?: Record<string, unknown>;
}

export interface CreateJournalEntryRequest {
  tenantId: TenantId;
  effectiveDate: Date;
  paymentIntentId?: PaymentIntentId;
  lines: JournalEntryLine[];
  createdBy: string;
}

/**
 * Validates that a journal entry is balanced (debits = credits)
 */
export function validateJournalBalance(lines: JournalEntryLine[]): boolean {
  // Group by currency
  const byCurrency = new Map<CurrencyCode, { debits: number; credits: number }>();
  
  for (const line of lines) {
    const currency = line.amount.currency;
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, { debits: 0, credits: 0 });
    }
    const totals = byCurrency.get(currency)!;
    if (line.direction === 'DEBIT') {
      totals.debits += line.amount.amountMinorUnits;
    } else {
      totals.credits += line.amount.amountMinorUnits;
    }
  }
  
  // Check balance for each currency
  for (const [currency, totals] of byCurrency) {
    if (totals.debits !== totals.credits) {
      return false;
    }
  }
  
  return true;
}

/**
 * Creates a journal ID for grouping related entries
 */
export function createJournalId(): string {
  return `jnl_${uuidv4()}`;
}

/**
 * Pre-built journal entry templates for common transactions
 */
export const JournalTemplates = {
  /**
   * Record rent charge to customer
   */
  rentCharge: (
    tenantId: TenantId,
    customerLiabilityAccountId: AccountId,
    ownerOperatingAccountId: AccountId,
    amount: Money,
    leaseId: LeaseId,
    propertyId: PropertyId,
    unitId: UnitId,
    createdBy: string
  ): CreateJournalEntryRequest => ({
    tenantId,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: customerLiabilityAccountId,
        type: 'RENT_CHARGE',
        direction: 'DEBIT',
        amount,
        description: 'Rent charge',
        leaseId,
        propertyId,
        unitId
      },
      {
        accountId: ownerOperatingAccountId,
        type: 'RENT_CHARGE',
        direction: 'CREDIT',
        amount,
        description: 'Rent income accrued',
        leaseId,
        propertyId,
        unitId
      }
    ],
    createdBy
  }),

  /**
   * Record rent payment received
   * Includes platform fee split
   */
  rentPayment: (
    tenantId: TenantId,
    customerLiabilityAccountId: AccountId,
    platformHoldingAccountId: AccountId,
    platformRevenueAccountId: AccountId,
    grossAmount: Money,
    platformFee: Money,
    paymentIntentId: PaymentIntentId,
    leaseId: LeaseId,
    propertyId: PropertyId,
    unitId: UnitId,
    createdBy: string
  ): CreateJournalEntryRequest => ({
    tenantId,
    effectiveDate: new Date(),
    paymentIntentId,
    lines: [
      // Credit customer liability (reduce what they owe)
      {
        accountId: customerLiabilityAccountId,
        type: 'RENT_PAYMENT',
        direction: 'CREDIT',
        amount: grossAmount,
        description: 'Rent payment received',
        leaseId,
        propertyId,
        unitId
      },
      // Debit platform holding (we received cash)
      {
        accountId: platformHoldingAccountId,
        type: 'RENT_PAYMENT',
        direction: 'DEBIT',
        amount: grossAmount,
        description: 'Payment received into holding',
        leaseId,
        propertyId,
        unitId
      },
      // Record platform fee
      {
        accountId: platformHoldingAccountId,
        type: 'PLATFORM_FEE',
        direction: 'CREDIT',
        amount: platformFee,
        description: 'Platform fee deducted',
        leaseId,
        propertyId,
        unitId
      },
      {
        accountId: platformRevenueAccountId,
        type: 'PLATFORM_FEE',
        direction: 'DEBIT',
        amount: platformFee,
        description: 'Platform fee earned',
        leaseId,
        propertyId,
        unitId
      }
    ],
    createdBy
  }),

  /**
   * Record disbursement to owner
   */
  ownerDisbursement: (
    tenantId: TenantId,
    platformHoldingAccountId: AccountId,
    ownerOperatingAccountId: AccountId,
    amount: Money,
    createdBy: string
  ): CreateJournalEntryRequest => ({
    tenantId,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: platformHoldingAccountId,
        type: 'OWNER_DISBURSEMENT',
        direction: 'CREDIT',
        amount,
        description: 'Disbursement to owner'
      },
      {
        accountId: ownerOperatingAccountId,
        type: 'OWNER_DISBURSEMENT',
        direction: 'DEBIT',
        amount,
        description: 'Owner disbursement received'
      }
    ],
    createdBy
  }),

  /**
   * Record late fee charge
   */
  lateFeeCharge: (
    tenantId: TenantId,
    customerLiabilityAccountId: AccountId,
    ownerOperatingAccountId: AccountId,
    amount: Money,
    leaseId: LeaseId,
    propertyId: PropertyId,
    unitId: UnitId,
    createdBy: string
  ): CreateJournalEntryRequest => ({
    tenantId,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: customerLiabilityAccountId,
        type: 'LATE_FEE',
        direction: 'DEBIT',
        amount,
        description: 'Late fee charge',
        leaseId,
        propertyId,
        unitId
      },
      {
        accountId: ownerOperatingAccountId,
        type: 'LATE_FEE',
        direction: 'CREDIT',
        amount,
        description: 'Late fee income',
        leaseId,
        propertyId,
        unitId
      }
    ],
    createdBy
  }),

  /**
   * Record security deposit payment
   */
  securityDepositPayment: (
    tenantId: TenantId,
    customerDepositAccountId: AccountId,
    platformHoldingAccountId: AccountId,
    amount: Money,
    paymentIntentId: PaymentIntentId,
    leaseId: LeaseId,
    propertyId: PropertyId,
    unitId: UnitId,
    createdBy: string
  ): CreateJournalEntryRequest => ({
    tenantId,
    effectiveDate: new Date(),
    paymentIntentId,
    lines: [
      {
        accountId: platformHoldingAccountId,
        type: 'DEPOSIT_PAYMENT',
        direction: 'DEBIT',
        amount,
        description: 'Security deposit received',
        leaseId,
        propertyId,
        unitId
      },
      {
        accountId: customerDepositAccountId,
        type: 'DEPOSIT_PAYMENT',
        direction: 'CREDIT',
        amount,
        description: 'Security deposit liability',
        leaseId,
        propertyId,
        unitId
      }
    ],
    createdBy
  }),

  /**
   * Record security deposit refund
   */
  securityDepositRefund: (
    tenantId: TenantId,
    customerDepositAccountId: AccountId,
    platformHoldingAccountId: AccountId,
    amount: Money,
    leaseId: LeaseId,
    propertyId: PropertyId,
    unitId: UnitId,
    createdBy: string
  ): CreateJournalEntryRequest => ({
    tenantId,
    effectiveDate: new Date(),
    lines: [
      {
        accountId: customerDepositAccountId,
        type: 'DEPOSIT_REFUND',
        direction: 'DEBIT',
        amount,
        description: 'Security deposit refund',
        leaseId,
        propertyId,
        unitId
      },
      {
        accountId: platformHoldingAccountId,
        type: 'DEPOSIT_REFUND',
        direction: 'CREDIT',
        amount,
        description: 'Security deposit refund disbursed',
        leaseId,
        propertyId,
        unitId
      }
    ],
    createdBy
  }),

  /**
   * Record owner contribution (investment into property)
   */
  ownerContribution: (
    tenantId: TenantId,
    platformHoldingAccountId: AccountId,
    ownerReserveAccountId: AccountId,
    amount: Money,
    paymentIntentId: PaymentIntentId,
    propertyId: PropertyId,
    createdBy: string
  ): CreateJournalEntryRequest => ({
    tenantId,
    effectiveDate: new Date(),
    paymentIntentId,
    lines: [
      {
        accountId: platformHoldingAccountId,
        type: 'OWNER_CONTRIBUTION',
        direction: 'DEBIT',
        amount,
        description: 'Owner contribution received',
        propertyId
      },
      {
        accountId: ownerReserveAccountId,
        type: 'OWNER_CONTRIBUTION',
        direction: 'CREDIT',
        amount,
        description: 'Owner contribution to reserve',
        propertyId
      }
    ],
    createdBy
  })
};
