/**
 * Ledger Repository Interface
 * Defines the contract for immutable ledger entry persistence
 */
import {
  LedgerEntry,
  LedgerEntryId,
  AccountId,
  TenantId,
  PaymentIntentId,
  LeaseId,
  PropertyId,
  LedgerEntryType,
  EntryDirection,
  CurrencyCode
} from '@borjie/domain-models';

export interface LedgerEntryFilters {
  tenantId: TenantId;
  accountId?: AccountId;
  journalId?: string;
  type?: LedgerEntryType | LedgerEntryType[];
  direction?: EntryDirection;
  paymentIntentId?: PaymentIntentId;
  leaseId?: LeaseId;
  propertyId?: PropertyId;
  fromDate?: Date;
  toDate?: Date;
}

export interface LedgerPaginatedResult {
  entries: LedgerEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AccountBalance {
  accountId: AccountId;
  balance: number;
  currency: CurrencyCode;
  asOf: Date;
  lastEntryId: LedgerEntryId;
}

export interface ILedgerRepository {
  /**
   * Create ledger entries (batch insert for journal)
   * MUST be atomic - all entries created or none
   */
  createEntries(entries: LedgerEntry[]): Promise<LedgerEntry[]>;

  /**
   * Get ledger entry by ID
   * Ledger entries are immutable - no update method
   */
  findById(id: LedgerEntryId, tenantId: TenantId): Promise<LedgerEntry | null>;

  /**
   * Get all entries for a journal (grouped transaction)
   */
  findByJournalId(journalId: string, tenantId: TenantId): Promise<LedgerEntry[]>;

  /**
   * Get entries for an account with pagination
   */
  findByAccount(
    accountId: AccountId,
    tenantId: TenantId,
    page?: number,
    pageSize?: number
  ): Promise<LedgerPaginatedResult>;

  /**
   * Get entries with filters
   */
  find(
    filters: LedgerEntryFilters,
    page?: number,
    pageSize?: number
  ): Promise<LedgerPaginatedResult>;

  /**
   * Get the latest entry for an account
   */
  findLatestByAccount(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<LedgerEntry | null>;

  /**
   * Get next sequence number for an account
   */
  getNextSequenceNumber(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<number>;

  /**
   * Calculate account balance from entries
   * Used for reconciliation and verification
   */
  calculateAccountBalance(
    accountId: AccountId,
    tenantId: TenantId,
    asOfDate?: Date
  ): Promise<AccountBalance | null>;

  /**
   * Get entries for statement generation
   */
  findForStatement(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<LedgerEntry[]>;

  /**
   * Get totals by entry type for a period
   */
  getTotalsByType(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<Map<LedgerEntryType, { debits: number; credits: number }>>;

  /**
   * Verify ledger integrity (no gaps in sequence numbers)
   */
  verifyIntegrity(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<{ valid: boolean; gaps: number[]; duplicates: number[] }>;
}

/**
 * In-memory implementation for testing
 */
export class InMemoryLedgerRepository implements ILedgerRepository {
  private entries: Map<string, LedgerEntry> = new Map();
  private sequenceCounters: Map<string, number> = new Map();

  async createEntries(entries: LedgerEntry[]): Promise<LedgerEntry[]> {
    // Atomic insert - all or nothing
    const created: LedgerEntry[] = [];
    for (const entry of entries) {
      this.entries.set(entry.id, { ...entry });
      created.push({ ...entry });
      
      // Update sequence counter
      const key = `${entry.tenantId}:${entry.accountId}`;
      const current = this.sequenceCounters.get(key) || 0;
      if (entry.sequenceNumber > current) {
        this.sequenceCounters.set(key, entry.sequenceNumber);
      }
    }
    return created;
  }

  async findById(id: LedgerEntryId, tenantId: TenantId): Promise<LedgerEntry | null> {
    const entry = this.entries.get(id);
    if (entry && entry.tenantId === tenantId) {
      return { ...entry };
    }
    return null;
  }

  async findByJournalId(journalId: string, tenantId: TenantId): Promise<LedgerEntry[]> {
    return Array.from(this.entries.values())
      .filter(e => e.journalId === journalId && e.tenantId === tenantId)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map(e => ({ ...e }));
  }

  async findByAccount(
    accountId: AccountId,
    tenantId: TenantId,
    page: number = 1,
    pageSize: number = 50
  ): Promise<LedgerPaginatedResult> {
    const items = Array.from(this.entries.values())
      .filter(e => e.accountId === accountId && e.tenantId === tenantId)
      .sort((a, b) => b.sequenceNumber - a.sequenceNumber); // Newest first

    const total = items.length;
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    return {
      entries: pageItems.map(e => ({ ...e })),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    };
  }

  async find(
    filters: LedgerEntryFilters,
    page: number = 1,
    pageSize: number = 50
  ): Promise<LedgerPaginatedResult> {
    let items = Array.from(this.entries.values())
      .filter(e => e.tenantId === filters.tenantId);

    if (filters.accountId) {
      items = items.filter(e => e.accountId === filters.accountId);
    }
    if (filters.journalId) {
      items = items.filter(e => e.journalId === filters.journalId);
    }
    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      items = items.filter(e => types.includes(e.type));
    }
    if (filters.direction) {
      items = items.filter(e => e.direction === filters.direction);
    }
    if (filters.paymentIntentId) {
      items = items.filter(e => e.paymentIntentId === filters.paymentIntentId);
    }
    if (filters.leaseId) {
      items = items.filter(e => e.leaseId === filters.leaseId);
    }
    if (filters.propertyId) {
      items = items.filter(e => e.propertyId === filters.propertyId);
    }
    if (filters.fromDate) {
      items = items.filter(e => e.effectiveDate >= filters.fromDate!);
    }
    if (filters.toDate) {
      items = items.filter(e => e.effectiveDate <= filters.toDate!);
    }

    items.sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime());

    const total = items.length;
    const start = (page - 1) * pageSize;
    const pageItems = items.slice(start, start + pageSize);

    return {
      entries: pageItems.map(e => ({ ...e })),
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    };
  }

  async findLatestByAccount(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<LedgerEntry | null> {
    const entries = Array.from(this.entries.values())
      .filter(e => e.accountId === accountId && e.tenantId === tenantId)
      .sort((a, b) => b.sequenceNumber - a.sequenceNumber);

    return entries.length > 0 ? { ...entries[0] } : null;
  }

  async getNextSequenceNumber(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<number> {
    const key = `${tenantId}:${accountId}`;
    const current = this.sequenceCounters.get(key) || 0;
    return current + 1;
  }

  async calculateAccountBalance(
    accountId: AccountId,
    tenantId: TenantId,
    asOfDate?: Date
  ): Promise<AccountBalance | null> {
    let entries = Array.from(this.entries.values())
      .filter(e => e.accountId === accountId && e.tenantId === tenantId);

    if (asOfDate) {
      entries = entries.filter(e => e.effectiveDate <= asOfDate);
    }

    if (entries.length === 0) {
      return null;
    }

    entries.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const lastEntry = entries[entries.length - 1];

    // Calculate balance from entries
    let balance = 0;
    for (const entry of entries) {
      if (entry.direction === 'DEBIT') {
        balance += entry.amount.amountMinorUnits;
      } else {
        balance -= entry.amount.amountMinorUnits;
      }
    }

    return {
      accountId,
      balance,
      currency: lastEntry.amount.currency,
      asOf: asOfDate || new Date(),
      lastEntryId: lastEntry.id
    };
  }

  async findForStatement(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<LedgerEntry[]> {
    return Array.from(this.entries.values())
      .filter(e =>
        e.accountId === accountId &&
        e.tenantId === tenantId &&
        e.effectiveDate >= fromDate &&
        e.effectiveDate <= toDate
      )
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map(e => ({ ...e }));
  }

  async getTotalsByType(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<Map<LedgerEntryType, { debits: number; credits: number }>> {
    const entries = await this.findForStatement(accountId, tenantId, fromDate, toDate);
    const totals = new Map<LedgerEntryType, { debits: number; credits: number }>();

    for (const entry of entries) {
      if (!totals.has(entry.type)) {
        totals.set(entry.type, { debits: 0, credits: 0 });
      }
      const t = totals.get(entry.type)!;
      if (entry.direction === 'DEBIT') {
        t.debits += entry.amount.amountMinorUnits;
      } else {
        t.credits += entry.amount.amountMinorUnits;
      }
    }

    return totals;
  }

  async verifyIntegrity(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<{ valid: boolean; gaps: number[]; duplicates: number[] }> {
    const entries = Array.from(this.entries.values())
      .filter(e => e.accountId === accountId && e.tenantId === tenantId)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

    const gaps: number[] = [];
    const duplicates: number[] = [];
    const seen = new Set<number>();

    for (let i = 0; i < entries.length; i++) {
      const seq = entries[i].sequenceNumber;
      
      if (seen.has(seq)) {
        duplicates.push(seq);
      }
      seen.add(seq);

      if (i > 0) {
        const prevSeq = entries[i - 1].sequenceNumber;
        if (seq !== prevSeq + 1) {
          for (let g = prevSeq + 1; g < seq; g++) {
            gaps.push(g);
          }
        }
      }
    }

    return {
      valid: gaps.length === 0 && duplicates.length === 0,
      gaps,
      duplicates
    };
  }
}
