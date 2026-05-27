/**
 * Drizzle-backed Account Repository.
 *
 * Production implementation of `IAccountRepository` against the
 * Drizzle-managed `accounts` table (declared in
 * `packages/database/src/schemas/ledger.schema.ts`, re-exported via
 * `payments-ledger.schema.ts`). Completes the second half of the
 * ORM-unification wave (W4-A shipped only `payment_intents`; this
 * wave covers the remaining four repos).
 *
 * Design notes:
 *
 *   - Tenant predicate is on EVERY query. RLS (migration 0169) is the
 *     belt; this repo is the suspenders. Defence in depth.
 *   - Domain ↔ row conversion is centralised in `rowToAccount` so
 *     schema additions only touch one spot.
 *   - Optimistic-locking `updateBalance` is implemented via a
 *     conditional UPDATE … WHERE entry_count = expectedVersion. The
 *     in-memory adapter modelled `version` as a separate counter; the
 *     DB collapses it onto `entry_count` since every balance mutation
 *     bumps the entry count by exactly one. Returning rowCount > 0
 *     tells us whether the optimistic check held.
 *   - DB enum has `SUSPENDED` whereas the domain has `FROZEN`. We
 *     translate at the boundary (`SUSPENDED` ⇔ `FROZEN`) so callers
 *     keep speaking the domain dialect.
 *   - Hard DB errors bubble up. We do NOT swallow them — the calling
 *     service decides whether to retry.
 */

import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type {
  Account,
  AccountId,
  AccountStatus,
  AccountType,
  CurrencyCode,
  CustomerId,
  OwnerId,
  PropertyId,
  TenantId,
} from '@borjie/domain-models';
import { type DatabaseClient } from '@borjie/database';
import { accounts, type AccountRow } from './drizzle-schema';
import type {
  AccountFilters,
  IAccountRepository,
} from './account.repository';

// ────────────────────────────────────────────────────────────────────
// Enum translation (domain ↔ DB)
//
// Domain models declare AccountStatus = 'ACTIVE'|'FROZEN'|'CLOSED'
// (see packages/domain-models/src/ledger/account.ts). The DB enum
// (ledger.schema.ts) uses 'ACTIVE'|'SUSPENDED'|'CLOSED'. Translate at
// the persistence boundary so neither side leaks into the other.
// ────────────────────────────────────────────────────────────────────

type DbAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

function statusToDb(status: AccountStatus): DbAccountStatus {
  if (status === 'FROZEN') return 'SUSPENDED';
  return status;
}

function statusFromDb(status: DbAccountStatus | string): AccountStatus {
  if (status === 'SUSPENDED') return 'FROZEN';
  return status as AccountStatus;
}

function safeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return undefined;
}

// ────────────────────────────────────────────────────────────────────
// Row ⇄ Domain converters
// ────────────────────────────────────────────────────────────────────

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id as AccountId,
    tenantId: row.tenantId as TenantId,
    type: row.type as AccountType,
    status: statusFromDb(row.status),
    name: row.name,
    description: row.description ?? undefined,
    currency: row.currency as CurrencyCode,
    customerId: (row.customerId ?? undefined) as CustomerId | undefined,
    ownerId: (row.ownerId ?? undefined) as OwnerId | undefined,
    propertyId: (row.propertyId ?? undefined) as PropertyId | undefined,
    balanceMinorUnits: row.balanceMinorUnits ?? 0,
    lastEntryId: row.lastEntryId ?? undefined,
    lastEntryAt: row.lastEntryAt ?? undefined,
    entryCount: row.entryCount ?? 0,
    metadata: safeMetadata(row.metadata),
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? '',
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? '',
  } as Account;
}

function accountToInsert(a: Account): typeof accounts.$inferInsert {
  return {
    id: a.id,
    tenantId: a.tenantId,
    customerId: a.customerId ?? null,
    ownerId: a.ownerId ?? null,
    propertyId: a.propertyId ?? null,
    name: a.name,
    type: a.type,
    status: statusToDb(a.status),
    currency: a.currency,
    balanceMinorUnits: a.balanceMinorUnits ?? 0,
    lastEntryId: a.lastEntryId ?? null,
    lastEntryAt: a.lastEntryAt ?? null,
    entryCount: a.entryCount ?? 0,
    description: a.description ?? null,
    metadata: a.metadata ?? {},
    createdBy: a.createdBy ?? null,
    updatedBy: a.updatedBy ?? null,
  };
}

// ────────────────────────────────────────────────────────────────────
// Drizzle repository
// ────────────────────────────────────────────────────────────────────

export class DrizzleAccountRepository implements IAccountRepository {
  constructor(private readonly db: DatabaseClient) {}

  async create(account: Account): Promise<Account> {
    const inserted = await this.db
      .insert(accounts)
      .values(accountToInsert(account))
      .returning();

    if (!inserted[0]) {
      throw new Error(
        `DrizzleAccountRepository.create: insert returned no row for id=${account.id}`,
      );
    }
    return rowToAccount(inserted[0]);
  }

  async findById(
    id: AccountId,
    tenantId: TenantId,
  ): Promise<Account | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.tenantId, tenantId)))
      .limit(1);
    return rows[0] ? rowToAccount(rows[0]) : null;
  }

  async update(account: Account): Promise<Account> {
    const updates = {
      customerId: account.customerId ?? null,
      ownerId: account.ownerId ?? null,
      propertyId: account.propertyId ?? null,
      name: account.name,
      type: account.type,
      status: statusToDb(account.status),
      currency: account.currency,
      balanceMinorUnits: account.balanceMinorUnits ?? 0,
      lastEntryId: account.lastEntryId ?? null,
      lastEntryAt: account.lastEntryAt ?? null,
      entryCount: account.entryCount ?? 0,
      description: account.description ?? null,
      metadata: account.metadata ?? {},
      updatedBy: account.updatedBy ?? null,
      updatedAt: new Date(),
    };

    const updated = await this.db
      .update(accounts)
      .set(updates)
      .where(
        and(eq(accounts.id, account.id), eq(accounts.tenantId, account.tenantId)),
      )
      .returning();

    if (!updated[0]) {
      throw new Error(
        `DrizzleAccountRepository.update: no row updated for id=${account.id}`,
      );
    }
    return rowToAccount(updated[0]);
  }

  async find(filters: AccountFilters): Promise<Account[]> {
    const conditions = [eq(accounts.tenantId, filters.tenantId)];

    if (filters.type) {
      const types = Array.isArray(filters.type) ? filters.type : [filters.type];
      conditions.push(inArray(accounts.type, types));
    }
    if (filters.status) {
      const statuses = (Array.isArray(filters.status)
        ? filters.status
        : [filters.status]
      ).map(statusToDb);
      conditions.push(inArray(accounts.status, statuses));
    }
    if (filters.customerId) {
      conditions.push(eq(accounts.customerId, filters.customerId));
    }
    if (filters.ownerId) {
      conditions.push(eq(accounts.ownerId, filters.ownerId));
    }
    if (filters.propertyId) {
      conditions.push(eq(accounts.propertyId, filters.propertyId));
    }
    if (filters.currency) {
      conditions.push(eq(accounts.currency, filters.currency));
    }

    const rows = await this.db
      .select()
      .from(accounts)
      .where(and(...conditions))
      .orderBy(desc(accounts.createdAt));

    return rows.map(rowToAccount);
  }

  async findByCustomerAndType(
    tenantId: TenantId,
    customerId: CustomerId,
    type: AccountType,
  ): Promise<Account | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.customerId, customerId),
          eq(accounts.type, type),
        ),
      )
      .limit(1);

    return rows[0] ? rowToAccount(rows[0]) : null;
  }

  async findByOwnerAndType(
    tenantId: TenantId,
    ownerId: OwnerId,
    type: AccountType,
  ): Promise<Account | null> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.ownerId, ownerId),
          eq(accounts.type, type),
        ),
      )
      .limit(1);

    return rows[0] ? rowToAccount(rows[0]) : null;
  }

  async findPlatformAccounts(
    tenantId: TenantId,
    type: AccountType,
  ): Promise<Account | null> {
    // Platform accounts are tenant-scoped accounts with neither a
    // customerId nor an ownerId — they belong to the platform itself.
    // Matches the InMemory adapter's "no customer && no owner" rule.
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.type, type),
          isNull(accounts.customerId),
          isNull(accounts.ownerId),
        ),
      )
      .limit(1);

    return rows[0] ? rowToAccount(rows[0]) : null;
  }

  async findByCustomer(
    tenantId: TenantId,
    customerId: CustomerId,
  ): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.customerId, customerId),
        ),
      );
    return rows.map(rowToAccount);
  }

  async findByOwner(
    tenantId: TenantId,
    ownerId: OwnerId,
  ): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.tenantId, tenantId), eq(accounts.ownerId, ownerId)),
      );
    return rows.map(rowToAccount);
  }

  async findWithPositiveBalance(
    tenantId: TenantId,
    type: AccountType,
    minBalance: number,
  ): Promise<Account[]> {
    const rows = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.type, type),
          eq(accounts.status, 'ACTIVE'),
          gte(accounts.balanceMinorUnits, minBalance),
        ),
      );
    return rows.map(rowToAccount);
  }

  async updateBalance(
    accountId: AccountId,
    tenantId: TenantId,
    newBalanceMinorUnits: number,
    lastEntryId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    // Optimistic lock: the UPDATE only succeeds when the row's
    // entry_count still matches the version the caller saw. Returning
    // [] means another writer mutated the row in the meantime.
    //
    // entryCount + 1 corresponds to the new version. lastEntryAt /
    // updatedAt are set to now() in the same UPDATE so we never read
    // them back and write a stale value.
    const updated = await this.db
      .update(accounts)
      .set({
        balanceMinorUnits: newBalanceMinorUnits,
        lastEntryId,
        lastEntryAt: new Date(),
        entryCount: sql`${accounts.entryCount} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(accounts.id, accountId),
          eq(accounts.tenantId, tenantId),
          eq(accounts.entryCount, expectedVersion),
        ),
      )
      .returning({ id: accounts.id });

    return updated.length > 0;
  }
}
