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
import { pgTable, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { type DatabaseClient } from '@borjie/database';

// Local Drizzle table declaration for the legacy payments-ledger
// `accounts` table. The canonical schema was archived in
// `packages/database/.archive/migrations/0167b_payments_ledger_drizzle.sql`
// when the database package pivoted to the mining domain; the repository
// adapter still needs the shape for production deployments that retain
// the table. Declared as a module-internal const so its inferred type
// stays inside this compilation unit (avoids TS2883 portability
// diagnostics that fire on cross-module re-exports of deep drizzle-orm
// generics). Column-name parity with the archived schema is mandatory.
const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  customerId: text('customer_id'),
  ownerId: text('owner_id'),
  propertyId: text('property_id'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  currency: text('currency').notNull(),
  balanceMinorUnits: integer('balance_minor_units').notNull().default(0),
  lastEntryId: text('last_entry_id'),
  lastEntryAt: timestamp('last_entry_at', { withTimezone: true }),
  entryCount: integer('entry_count').notNull().default(0),
  description: text('description'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closedBy: text('closed_by'),
});

type AccountRow = typeof accounts.$inferSelect;
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

  /**
   * G1 — robustness 2026-05-29. Atomic multi-row CAS for journal posts.
   *
   * Runs every per-account CAS UPDATE inside a single drizzle
   * transaction. If any predicate fails (no rows affected), the whole
   * transaction is rolled back via a thrown sentinel and the caller
   * gets `{ ok: false, conflictAccountId }` so the LedgerService retry
   * wrapper can re-read + recompute against the fresh row state.
   *
   * Why a transaction is required: without it a partial CAS leaves the
   * ledger in an inconsistent state — e.g. the customer's account
   * incremented but the matching platform-clearing account did not.
   * The transaction rolls back EVERY mutation if any fails.
   */
  async updateBalancesAtomic(
    updates: ReadonlyArray<{
      readonly accountId: AccountId;
      readonly tenantId: TenantId;
      readonly newBalanceMinorUnits: number;
      readonly lastEntryId: string;
      readonly expectedVersion: number;
    }>,
  ): Promise<{ ok: true } | { ok: false; conflictAccountId: AccountId }> {
    // Sentinel used to roll back the drizzle transaction on a CAS miss
    // without surfacing the abort as a hard error. We re-throw inside
    // the transaction callback and catch it on the outside.
    class CasConflict extends Error {
      constructor(public readonly conflictAccountId: AccountId) {
        super(`CAS miss on account ${conflictAccountId}`);
      }
    }
    try {
      await (this.db as unknown as {
        transaction: (cb: (tx: unknown) => Promise<void>) => Promise<void>;
      }).transaction(async (tx) => {
        const txDb = tx as typeof this.db;
        for (const u of updates) {
          const res = await txDb
            .update(accounts)
            .set({
              balanceMinorUnits: u.newBalanceMinorUnits,
              lastEntryId: u.lastEntryId,
              lastEntryAt: new Date(),
              entryCount: sql`${accounts.entryCount} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(accounts.id, u.accountId),
                eq(accounts.tenantId, u.tenantId),
                eq(accounts.entryCount, u.expectedVersion),
              ),
            )
            .returning({ id: accounts.id });
          if (res.length === 0) {
            throw new CasConflict(u.accountId);
          }
        }
      });
      return { ok: true };
    } catch (err) {
      if (err instanceof CasConflict) {
        return { ok: false, conflictAccountId: err.conflictAccountId };
      }
      throw err;
    }
  }
}
