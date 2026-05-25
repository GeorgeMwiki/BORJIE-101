/**
 * Account Repository Interface
 * Defines the contract for ledger account persistence
 */
import {
  Account,
  AccountId,
  TenantId,
  CustomerId,
  OwnerId,
  PropertyId,
  AccountType,
  AccountStatus,
  CurrencyCode
} from '@borjie/domain-models';

export interface AccountFilters {
  tenantId: TenantId;
  type?: AccountType | AccountType[];
  status?: AccountStatus | AccountStatus[];
  customerId?: CustomerId;
  ownerId?: OwnerId;
  propertyId?: PropertyId;
  currency?: CurrencyCode;
}

export interface IAccountRepository {
  /**
   * Create a new account
   */
  create(account: Account): Promise<Account>;

  /**
   * Get account by ID
   */
  findById(id: AccountId, tenantId: TenantId): Promise<Account | null>;

  /**
   * Update account
   */
  update(account: Account): Promise<Account>;

  /**
   * Find accounts with filters
   */
  find(filters: AccountFilters): Promise<Account[]>;

  /**
   * Get account by customer and type
   */
  findByCustomerAndType(
    tenantId: TenantId,
    customerId: CustomerId,
    type: AccountType
  ): Promise<Account | null>;

  /**
   * Get account by owner and type
   */
  findByOwnerAndType(
    tenantId: TenantId,
    ownerId: OwnerId,
    type: AccountType
  ): Promise<Account | null>;

  /**
   * Get platform accounts
   */
  findPlatformAccounts(
    tenantId: TenantId,
    type: AccountType
  ): Promise<Account | null>;

  /**
   * Get all accounts for a customer
   */
  findByCustomer(
    tenantId: TenantId,
    customerId: CustomerId
  ): Promise<Account[]>;

  /**
   * Get all accounts for an owner
   */
  findByOwner(
    tenantId: TenantId,
    ownerId: OwnerId
  ): Promise<Account[]>;

  /**
   * Get accounts with non-zero balance for disbursement
   */
  findWithPositiveBalance(
    tenantId: TenantId,
    type: AccountType,
    minBalance: number
  ): Promise<Account[]>;

  /**
   * Atomic balance update with optimistic locking
   * Returns true if successful, false if version mismatch
   */
  updateBalance(
    accountId: AccountId,
    tenantId: TenantId,
    newBalanceMinorUnits: number,
    lastEntryId: string,
    expectedVersion: number
  ): Promise<boolean>;
}

/**
 * In-memory implementation for testing
 */
export class InMemoryAccountRepository implements IAccountRepository {
  private accounts: Map<string, Account & { version: number }> = new Map();

  async create(account: Account): Promise<Account> {
    this.accounts.set(account.id, { ...account, version: 1 });
    return account;
  }

  async findById(id: AccountId, tenantId: TenantId): Promise<Account | null> {
    const account = this.accounts.get(id);
    if (account && account.tenantId === tenantId) {
      const { version, ...data } = account;
      return { ...data };
    }
    return null;
  }

  async update(account: Account): Promise<Account> {
    const existing = this.accounts.get(account.id);
    if (existing) {
      this.accounts.set(account.id, { ...account, version: existing.version + 1 });
    }
    return account;
  }

  async find(filters: AccountFilters): Promise<Account[]> {
    let items = Array.from(this.accounts.values())
      .filter(a => a.tenantId === filters.tenantId);

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      items = items.filter(a => types.includes(a.type));
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      items = items.filter(a => statuses.includes(a.status));
    }
    if (filters.customerId) {
      items = items.filter(a => a.customerId === filters.customerId);
    }
    if (filters.ownerId) {
      items = items.filter(a => a.ownerId === filters.ownerId);
    }
    if (filters.propertyId) {
      items = items.filter(a => a.propertyId === filters.propertyId);
    }
    if (filters.currency) {
      items = items.filter(a => a.currency === filters.currency);
    }

    return items.map(({ version, ...data }) => ({ ...data }));
  }

  async findByCustomerAndType(
    tenantId: TenantId,
    customerId: CustomerId,
    type: AccountType
  ): Promise<Account | null> {
    for (const account of this.accounts.values()) {
      if (
        account.tenantId === tenantId &&
        account.customerId === customerId &&
        account.type === type
      ) {
        const { version, ...data } = account;
        return { ...data };
      }
    }
    return null;
  }

  async findByOwnerAndType(
    tenantId: TenantId,
    ownerId: OwnerId,
    type: AccountType
  ): Promise<Account | null> {
    for (const account of this.accounts.values()) {
      if (
        account.tenantId === tenantId &&
        account.ownerId === ownerId &&
        account.type === type
      ) {
        const { version, ...data } = account;
        return { ...data };
      }
    }
    return null;
  }

  async findPlatformAccounts(
    tenantId: TenantId,
    type: AccountType
  ): Promise<Account | null> {
    for (const account of this.accounts.values()) {
      if (
        account.tenantId === tenantId &&
        account.type === type &&
        !account.customerId &&
        !account.ownerId
      ) {
        const { version, ...data } = account;
        return { ...data };
      }
    }
    return null;
  }

  async findByCustomer(
    tenantId: TenantId,
    customerId: CustomerId
  ): Promise<Account[]> {
    return Array.from(this.accounts.values())
      .filter(a => a.tenantId === tenantId && a.customerId === customerId)
      .map(({ version, ...data }) => ({ ...data }));
  }

  async findByOwner(
    tenantId: TenantId,
    ownerId: OwnerId
  ): Promise<Account[]> {
    return Array.from(this.accounts.values())
      .filter(a => a.tenantId === tenantId && a.ownerId === ownerId)
      .map(({ version, ...data }) => ({ ...data }));
  }

  async findWithPositiveBalance(
    tenantId: TenantId,
    type: AccountType,
    minBalance: number
  ): Promise<Account[]> {
    return Array.from(this.accounts.values())
      .filter(a =>
        a.tenantId === tenantId &&
        a.type === type &&
        a.status === 'ACTIVE' &&
        a.balanceMinorUnits >= minBalance
      )
      .map(({ version, ...data }) => ({ ...data }));
  }

  async updateBalance(
    accountId: AccountId,
    tenantId: TenantId,
    newBalanceMinorUnits: number,
    lastEntryId: string,
    expectedVersion: number
  ): Promise<boolean> {
    const account = this.accounts.get(accountId);
    if (!account || account.tenantId !== tenantId) {
      return false;
    }
    if (account.version !== expectedVersion) {
      return false; // Optimistic lock failure
    }
    
    account.balanceMinorUnits = newBalanceMinorUnits;
    account.lastEntryId = lastEntryId;
    account.lastEntryAt = new Date();
    account.entryCount += 1;
    account.updatedAt = new Date();
    account.version += 1;
    
    return true;
  }
}
