/**
 * Ledger Account domain model
 * Represents a financial account in the double-entry ledger
 */
import { z } from 'zod';
import {
  TenantId,
  AccountId,
  AccountType,
  AccountTypeSchema,
  CustomerId,
  OwnerId,
  PropertyId,
  TenantScopedEntity,
  CurrencyCodeSchema,
  CurrencyCode
} from '../common/types';
import { Money } from '../common/money';

export const AccountStatusSchema = z.enum([
  'ACTIVE',
  'FROZEN',
  'CLOSED'
]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const AccountSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  type: AccountTypeSchema,
  status: AccountStatusSchema,
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  currency: CurrencyCodeSchema,
  
  // Association with entities (only one should be set based on account type)
  customerId: z.string().optional(),
  ownerId: z.string().optional(),
  propertyId: z.string().optional(),
  
  // Balance tracking (denormalized for query performance)
  balanceMinorUnits: z.number().int().default(0),
  
  // For control and audit
  lastEntryId: z.string().optional(),
  lastEntryAt: z.date().optional(),
  entryCount: z.number().int().default(0),
  
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type AccountData = z.infer<typeof AccountSchema>;

export interface Account extends AccountData, TenantScopedEntity {
  id: AccountId;
  tenantId: TenantId;
  customerId?: CustomerId;
  ownerId?: OwnerId;
  propertyId?: PropertyId;
}

/**
 * Account aggregate with business logic
 */
export class AccountAggregate {
  private data: Account;

  constructor(data: Account) {
    this.data = { ...data };
  }

  get id(): AccountId {
    return this.data.id;
  }

  get tenantId(): TenantId {
    return this.data.tenantId;
  }

  get type(): AccountType {
    return this.data.type;
  }

  get status(): AccountStatus {
    return this.data.status;
  }

  get currency(): CurrencyCode {
    return this.data.currency;
  }

  get balance(): Money {
    return Money.fromMinorUnits(this.data.balanceMinorUnits, this.data.currency);
  }

  /**
   * Check if account is active
   */
  isActive(): boolean {
    return this.data.status === 'ACTIVE';
  }

  /**
   * Check if account can be debited/credited
   */
  canTransact(): boolean {
    return this.data.status === 'ACTIVE';
  }

  /**
   * Update balance after ledger entry
   * This is called internally by the ledger service
   */
  updateBalance(newBalance: Money, entryId: string): void {
    if (newBalance.currency !== this.data.currency) {
      throw new Error(`Currency mismatch: account is ${this.data.currency}, got ${newBalance.currency}`);
    }
    this.data.balanceMinorUnits = newBalance.amountMinorUnits;
    this.data.lastEntryId = entryId;
    this.data.lastEntryAt = new Date();
    this.data.entryCount += 1;
    this.data.updatedAt = new Date();
  }

  /**
   * Freeze account (prevent transactions)
   */
  freeze(reason: string): void {
    if (this.data.status === 'CLOSED') {
      throw new Error('Cannot freeze a closed account');
    }
    this.data.status = 'FROZEN';
    this.data.metadata = {
      ...this.data.metadata,
      frozenAt: new Date().toISOString(),
      frozenReason: reason
    };
    this.data.updatedAt = new Date();
  }

  /**
   * Unfreeze account
   */
  unfreeze(): void {
    if (this.data.status !== 'FROZEN') {
      throw new Error('Account is not frozen');
    }
    this.data.status = 'ACTIVE';
    this.data.metadata = {
      ...this.data.metadata,
      unfrozenAt: new Date().toISOString()
    };
    this.data.updatedAt = new Date();
  }

  /**
   * Close account (must have zero balance)
   */
  close(): void {
    if (this.data.balanceMinorUnits !== 0) {
      throw new Error('Cannot close account with non-zero balance');
    }
    this.data.status = 'CLOSED';
    this.data.updatedAt = new Date();
  }

  toData(): Account {
    return { ...this.data };
  }
}

/**
 * Factory functions for creating accounts
 */
export function createCustomerLiabilityAccount(
  id: AccountId,
  tenantId: TenantId,
  customerId: CustomerId,
  currency: CurrencyCode,
  createdBy: string
): Account {
  const now = new Date();
  return {
    id,
    tenantId,
    type: 'CUSTOMER_LIABILITY',
    status: 'ACTIVE',
    name: `Customer Receivable - ${customerId}`,
    currency,
    customerId,
    balanceMinorUnits: 0,
    entryCount: 0,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy
  };
}

export function createCustomerDepositAccount(
  id: AccountId,
  tenantId: TenantId,
  customerId: CustomerId,
  currency: CurrencyCode,
  createdBy: string
): Account {
  const now = new Date();
  return {
    id,
    tenantId,
    type: 'CUSTOMER_DEPOSIT',
    status: 'ACTIVE',
    name: `Security Deposit - ${customerId}`,
    currency,
    customerId,
    balanceMinorUnits: 0,
    entryCount: 0,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy
  };
}

export function createOwnerOperatingAccount(
  id: AccountId,
  tenantId: TenantId,
  ownerId: OwnerId,
  currency: CurrencyCode,
  createdBy: string
): Account {
  const now = new Date();
  return {
    id,
    tenantId,
    type: 'OWNER_OPERATING',
    status: 'ACTIVE',
    name: `Owner Operating - ${ownerId}`,
    currency,
    ownerId,
    balanceMinorUnits: 0,
    entryCount: 0,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy
  };
}

export function createOwnerReserveAccount(
  id: AccountId,
  tenantId: TenantId,
  ownerId: OwnerId,
  currency: CurrencyCode,
  createdBy: string
): Account {
  const now = new Date();
  return {
    id,
    tenantId,
    type: 'OWNER_RESERVE',
    status: 'ACTIVE',
    name: `Owner Reserve - ${ownerId}`,
    currency,
    ownerId,
    balanceMinorUnits: 0,
    entryCount: 0,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy
  };
}

export function createPlatformRevenueAccount(
  id: AccountId,
  tenantId: TenantId,
  currency: CurrencyCode,
  createdBy: string
): Account {
  const now = new Date();
  return {
    id,
    tenantId,
    type: 'PLATFORM_REVENUE',
    status: 'ACTIVE',
    name: 'Platform Revenue',
    currency,
    balanceMinorUnits: 0,
    entryCount: 0,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy
  };
}

export function createPlatformHoldingAccount(
  id: AccountId,
  tenantId: TenantId,
  currency: CurrencyCode,
  createdBy: string
): Account {
  const now = new Date();
  return {
    id,
    tenantId,
    type: 'PLATFORM_HOLDING',
    status: 'ACTIVE',
    name: 'Platform Holding',
    currency,
    balanceMinorUnits: 0,
    entryCount: 0,
    createdAt: now,
    createdBy,
    updatedAt: now,
    updatedBy: createdBy
  };
}
