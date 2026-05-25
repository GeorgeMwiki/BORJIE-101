/**
 * Drizzle-backed Ledger Repository.
 *
 * Production implementation of `ILedgerRepository` against the
 * Drizzle-managed `ledger_entries` table (declared in
 * `packages/database/src/schemas/ledger.schema.ts`).
 *
 * Notes specific to ledger entries:
 *
 *   - Entries are IMMUTABLE: no `update` method, ever. The interface
 *     reflects that — only `createEntries` mutates state.
 *   - Batch insert is atomic per the postgres-js driver semantics: a
 *     single multi-row INSERT either commits all rows or none. We do
 *     NOT wrap in an explicit transaction here because the caller
 *     (LedgerService) frequently composes ledger + account balance
 *     updates and owns the outer transaction boundary.
 *   - `sequenceNumber` per account: an account's next sequence number
 *     is computed via MAX(sequence_number) + 1 with the tenantId +
 *     accountId predicate. Two concurrent writers can collide here;
 *     the unique index `(account_id, sequence_number)` will reject the
 *     duplicate as a constraint violation, which the LedgerService
 *     translates into a retry. Same semantics the InMemory adapter
 *     modelled with its monotone counter.
 *   - Tenant predicate is on EVERY query. RLS (migration 0169) is
 *     defence-in-depth; this is the application-layer filter.
 *   - LedgerEntry domain has `amount: Money`; the row stores
 *     `amount_minor_units` + `currency`. Conversion is centralised in
 *     `rowToLedgerEntry`.
 */

import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import {
  Money,
  type AccountId,
  type CurrencyCode,
  type EntryDirection,
  type LeaseId,
  type LedgerEntry,
  type LedgerEntryId,
  type LedgerEntryType,
  type PaymentIntentId,
  type PropertyId,
  type TenantId,
  type UnitId,
} from '@borjie/domain-models';
import {
  ledgerEntries,
  type DatabaseClient,
  type LedgerEntryRow,
} from '@borjie/database';
import type {
  AccountBalance,
  ILedgerRepository,
  LedgerEntryFilters,
  LedgerPaginatedResult,
} from './ledger.repository';

// ────────────────────────────────────────────────────────────────────
// Row ⇄ Domain converters
// ────────────────────────────────────────────────────────────────────

function safeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function rowToLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  // ledger_entries.currency is `text NOT NULL` (see payment.schema.ts).
  // Fail loud if a row violates that invariant rather than silently defaulting
  // to a tenant-foreign currency (the old `?? 'KES'` fallback assumed Kenya
  // and was wrong for TZ / NG tenants).
  if (!row.currency) {
    throw new Error(
      `ledger_entries.currency invariant violated: row id=${String(row.id)} has empty currency`,
    );
  }
  const currency = row.currency as CurrencyCode;
  return {
    id: row.id as LedgerEntryId,
    tenantId: row.tenantId as TenantId,
    accountId: row.accountId as AccountId,
    journalId: row.journalId,
    type: row.type as LedgerEntryType,
    direction: row.direction as EntryDirection,
    amount: Money.fromMinorUnits(row.amountMinorUnits, currency),
    balanceAfter: Money.fromMinorUnits(row.balanceAfterMinorUnits, currency),
    sequenceNumber: row.sequenceNumber,
    effectiveDate: row.effectiveDate,
    postedAt: row.postedAt,
    paymentIntentId: (row.paymentIntentId ?? undefined) as
      | PaymentIntentId
      | undefined,
    leaseId: (row.leaseId ?? undefined) as LeaseId | undefined,
    propertyId: (row.propertyId ?? undefined) as PropertyId | undefined,
    unitId: (row.unitId ?? undefined) as UnitId | undefined,
    description: row.description ?? '',
    metadata: safeMetadata(row.metadata),
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? '',
    // Audit / tenant-scoped fields the domain demands. Ledger rows
    // are immutable so `updatedAt`/`updatedBy` mirror createdAt/By.
    updatedAt: row.createdAt,
    updatedBy: row.createdBy ?? '',
  } as LedgerEntry;
}

function entryToInsert(e: LedgerEntry): typeof ledgerEntries.$inferInsert {
  return {
    id: e.id,
    tenantId: e.tenantId,
    accountId: e.accountId,
    journalId: e.journalId,
    type: e.type,
    direction: e.direction,
    amountMinorUnits: e.amount.amountMinorUnits,
    currency: e.amount.currency,
    balanceAfterMinorUnits: e.balanceAfter.amountMinorUnits,
    sequenceNumber: e.sequenceNumber,
    effectiveDate: e.effectiveDate,
    postedAt: e.postedAt,
    paymentIntentId: e.paymentIntentId ?? null,
    leaseId: e.leaseId ?? null,
    propertyId: e.propertyId ?? null,
    unitId: e.unitId ?? null,
    invoiceId: null,
    description: e.description ?? null,
    metadata: e.metadata ?? {},
    createdBy: e.createdBy ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────
// Drizzle repository
// ────────────────────────────────────────────────────────────────────

export class DrizzleLedgerRepository implements ILedgerRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createEntries(entries: LedgerEntry[]): Promise<LedgerEntry[]> {
    if (entries.length === 0) return [];

    const inserted = await this.db
      .insert(ledgerEntries)
      .values(entries.map(entryToInsert))
      .returning();

    if (inserted.length !== entries.length) {
      throw new Error(
        `DrizzleLedgerRepository.createEntries: expected ${entries.length} rows, got ${inserted.length}`,
      );
    }
    return inserted.map(rowToLedgerEntry);
  }

  async findById(
    id: LedgerEntryId,
    tenantId: TenantId,
  ): Promise<LedgerEntry | null> {
    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.id, id), eq(ledgerEntries.tenantId, tenantId)),
      )
      .limit(1);
    return rows[0] ? rowToLedgerEntry(rows[0]) : null;
  }

  async findByJournalId(
    journalId: string,
    tenantId: TenantId,
  ): Promise<LedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.journalId, journalId),
          eq(ledgerEntries.tenantId, tenantId),
        ),
      )
      .orderBy(asc(ledgerEntries.sequenceNumber));
    return rows.map(rowToLedgerEntry);
  }

  async findByAccount(
    accountId: AccountId,
    tenantId: TenantId,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<LedgerPaginatedResult> {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(500, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;
    const where = and(
      eq(ledgerEntries.accountId, accountId),
      eq(ledgerEntries.tenantId, tenantId),
    );

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(ledgerEntries)
        .where(where)
        .orderBy(desc(ledgerEntries.sequenceNumber))
        .limit(safePageSize)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(ledgerEntries)
        .where(where),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      entries: rows.map(rowToLedgerEntry),
      total,
      page: safePage,
      pageSize: safePageSize,
      hasMore: offset + rows.length < total,
    };
  }

  async find(
    filters: LedgerEntryFilters,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<LedgerPaginatedResult> {
    const conditions = [eq(ledgerEntries.tenantId, filters.tenantId)];

    if (filters.accountId) {
      conditions.push(eq(ledgerEntries.accountId, filters.accountId));
    }
    if (filters.journalId) {
      conditions.push(eq(ledgerEntries.journalId, filters.journalId));
    }
    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      conditions.push(inArray(ledgerEntries.type, types));
    }
    if (filters.direction) {
      conditions.push(eq(ledgerEntries.direction, filters.direction));
    }
    if (filters.paymentIntentId) {
      conditions.push(eq(ledgerEntries.paymentIntentId, filters.paymentIntentId));
    }
    if (filters.leaseId) {
      conditions.push(eq(ledgerEntries.leaseId, filters.leaseId));
    }
    if (filters.propertyId) {
      conditions.push(eq(ledgerEntries.propertyId, filters.propertyId));
    }
    if (filters.fromDate) {
      conditions.push(gte(ledgerEntries.effectiveDate, filters.fromDate));
    }
    if (filters.toDate) {
      conditions.push(lte(ledgerEntries.effectiveDate, filters.toDate));
    }

    const where = and(...conditions);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(500, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    const [rows, totalRow] = await Promise.all([
      this.db
        .select()
        .from(ledgerEntries)
        .where(where)
        .orderBy(desc(ledgerEntries.postedAt))
        .limit(safePageSize)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(ledgerEntries)
        .where(where),
    ]);

    const total = Number(totalRow[0]?.total ?? 0);
    return {
      entries: rows.map(rowToLedgerEntry),
      total,
      page: safePage,
      pageSize: safePageSize,
      hasMore: offset + rows.length < total,
    };
  }

  async findLatestByAccount(
    accountId: AccountId,
    tenantId: TenantId,
  ): Promise<LedgerEntry | null> {
    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.accountId, accountId),
          eq(ledgerEntries.tenantId, tenantId),
        ),
      )
      .orderBy(desc(ledgerEntries.sequenceNumber))
      .limit(1);

    return rows[0] ? rowToLedgerEntry(rows[0]) : null;
  }

  async getNextSequenceNumber(
    accountId: AccountId,
    tenantId: TenantId,
  ): Promise<number> {
    // MAX + 1. The race window between this read and the subsequent
    // INSERT is closed by the (account_id, sequence_number) unique
    // index — the INSERT will fail loudly, the caller retries.
    const rows = await this.db
      .select({
        maxSeq: sql<number | null>`MAX(${ledgerEntries.sequenceNumber})`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.accountId, accountId),
          eq(ledgerEntries.tenantId, tenantId),
        ),
      );

    const maxSeq = Number(rows[0]?.maxSeq ?? 0);
    return maxSeq + 1;
  }

  async calculateAccountBalance(
    accountId: AccountId,
    tenantId: TenantId,
    asOfDate?: Date,
  ): Promise<AccountBalance | null> {
    const baseConditions = [
      eq(ledgerEntries.accountId, accountId),
      eq(ledgerEntries.tenantId, tenantId),
    ];
    if (asOfDate) {
      baseConditions.push(lte(ledgerEntries.effectiveDate, asOfDate));
    }
    const where = and(...baseConditions);

    // Compute net balance + the most-recent entry's currency + the
    // last entry's id in two queries instead of pulling all rows.
    const [aggRow, lastRow] = await Promise.all([
      this.db
        .select({
          debits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'DEBIT' THEN ${ledgerEntries.amountMinorUnits} ELSE 0 END), 0)::bigint`,
          credits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'CREDIT' THEN ${ledgerEntries.amountMinorUnits} ELSE 0 END), 0)::bigint`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(ledgerEntries)
        .where(where),
      this.db
        .select({
          id: ledgerEntries.id,
          currency: ledgerEntries.currency,
        })
        .from(ledgerEntries)
        .where(where)
        .orderBy(desc(ledgerEntries.sequenceNumber))
        .limit(1),
    ]);

    if (!lastRow[0] || Number(aggRow[0]?.count ?? 0) === 0) {
      return null;
    }

    const debits = Number(aggRow[0]?.debits ?? 0);
    const credits = Number(aggRow[0]?.credits ?? 0);

    return {
      accountId,
      balance: debits - credits,
      currency: lastRow[0].currency as CurrencyCode,
      asOf: asOfDate || new Date(),
      lastEntryId: lastRow[0].id as LedgerEntryId,
    };
  }

  async findForStatement(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date,
  ): Promise<LedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.accountId, accountId),
          eq(ledgerEntries.tenantId, tenantId),
          gte(ledgerEntries.effectiveDate, fromDate),
          lte(ledgerEntries.effectiveDate, toDate),
        ),
      )
      .orderBy(asc(ledgerEntries.sequenceNumber));

    return rows.map(rowToLedgerEntry);
  }

  async getTotalsByType(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date,
  ): Promise<Map<LedgerEntryType, { debits: number; credits: number }>> {
    const rows = await this.db
      .select({
        type: ledgerEntries.type,
        debits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'DEBIT' THEN ${ledgerEntries.amountMinorUnits} ELSE 0 END), 0)::bigint`,
        credits: sql<number>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'CREDIT' THEN ${ledgerEntries.amountMinorUnits} ELSE 0 END), 0)::bigint`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.accountId, accountId),
          eq(ledgerEntries.tenantId, tenantId),
          gte(ledgerEntries.effectiveDate, fromDate),
          lte(ledgerEntries.effectiveDate, toDate),
        ),
      )
      .groupBy(ledgerEntries.type);

    const totals = new Map<
      LedgerEntryType,
      { debits: number; credits: number }
    >();
    for (const row of rows) {
      totals.set(row.type as LedgerEntryType, {
        debits: Number(row.debits ?? 0),
        credits: Number(row.credits ?? 0),
      });
    }
    return totals;
  }

  async verifyIntegrity(
    accountId: AccountId,
    tenantId: TenantId,
  ): Promise<{ valid: boolean; gaps: number[]; duplicates: number[] }> {
    // Pull all sequence numbers for the account and scan in JS — this
    // is a verification path, not a hot read. For an account with N
    // entries this is N rows; the unique index (account_id,
    // sequence_number) means duplicates are physically impossible
    // under the Drizzle adapter, but we keep the check so a legacy DB
    // imported before the unique index landed still gets caught.
    const rows = await this.db
      .select({ sequenceNumber: ledgerEntries.sequenceNumber })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.accountId, accountId),
          eq(ledgerEntries.tenantId, tenantId),
        ),
      )
      .orderBy(asc(ledgerEntries.sequenceNumber));

    const gaps: number[] = [];
    const duplicates: number[] = [];
    const seen = new Set<number>();

    for (let i = 0; i < rows.length; i++) {
      const seq = rows[i].sequenceNumber;
      if (seen.has(seq)) {
        duplicates.push(seq);
      }
      seen.add(seq);

      if (i > 0) {
        const prevSeq = rows[i - 1].sequenceNumber;
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
      duplicates,
    };
  }
}
