/**
 * Drizzle-backed ledger repositories for the api-gateway composition root.
 *
 * Why these live HERE (not imported from @borjie/payments-ledger-service):
 *   The package DOES ship `DrizzleAccountRepository` /
 *   `DrizzleLedgerRepository` (services/payments-ledger/src/repositories/
 *   drizzle-*.repository.ts), but its `exports` map only exposes `.` and
 *   `./arrears` — the drizzle adapters are NOT re-exported through the
 *   package barrel, and `moduleResolution: NodeNext` refuses deep
 *   subpath imports that the `exports` field does not declare. We cannot
 *   edit the package (scope: api-gateway only), so we re-declare thin
 *   adapters here against the SAME Drizzle `DatabaseClient` the gateway
 *   already owns. The `LedgerService` class itself IS imported from the
 *   package barrel — the CLAUDE.md "money goes through LedgerService.post()"
 *   rule is satisfied by the REAL service doing the balanced double-entry
 *   CAS post; these adapters only persist what it computes.
 *
 * Table parity: the `accounts` / `ledger_entries` tables were archived in
 * the mining-domain pivot (packages/database/.archive/migrations/
 * 0167b_payments_ledger_drizzle.sql). The column layout below mirrors that
 * archived schema EXACTLY (the same shapes the package's own drizzle
 * adapters declare). These adapters generate SQL against the table NAMES,
 * so they run as soon as the sibling ledger-durability / migration agent
 * restores the tables in the live database.  >>> FLAGGED SIBLING DEP <<<
 *
 * Scope of implementation:
 *   The methods on the ACTIVE `LedgerService.postJournalEntry()` path are
 *   implemented for real:
 *     - IAccountRepository: findById, updateBalancesAtomic
 *     - ILedgerRepository : getNextSequenceNumber, createEntries,
 *                           findById, findByJournalId,
 *                           postJournalAtomic, findJournalIdByIdempotencyKey
 *   `postJournalAtomic` is the single-transaction atomic post (balance
 *   CAS + entry inserts + journal_idempotency dedupe + per-account
 *   SHA-256 hash-chain) — a byte-for-byte mirror of the payments-ledger
 *   `DrizzleLedgerRepository.postJournalAtomic`. It uses the SHARED
 *   `computeEntryHash` / `GENESIS_HASH` from `@borjie/payments-ledger-service`
 *   so the chain is identical to the package's. The remaining interface
 *   members (statements, pagination, integrity scans) are NOT on the post
 *   path the settlement / payroll adapters drive; they throw a loud
 *   `LEDGER_OP_NOT_SUPPORTED` so a future caller never gets a silent wrong
 *   answer.
 *
 * Tenant isolation: every query carries an explicit `tenant_id` predicate
 * (suspenders), and the atomic post / CAS bind `app.current_tenant_id`
 * transaction-locally as their FIRST statement so FORCE RLS applies (belt).
 * The self-bind is mandatory because this service is built once at boot
 * against the singleton pool — NOT the request middleware's connection —
 * so no tenant GUC would otherwise be set. Defence in depth.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
} from 'drizzle-orm/pg-core';
import {
  Money,
  type Account,
  type AccountId,
  type AccountType,
  type AccountStatus,
  type CurrencyCode,
  type CustomerId,
  type EntryDirection,
  type LeaseId,
  type LedgerEntry,
  type LedgerEntryId,
  type LedgerEntryType,
  type OwnerId,
  type PaymentIntentId,
  type PropertyId,
  type TenantId,
  type UnitId,
} from '@borjie/domain-models';
// `DatabaseClient` is imported as a *value* factory and the type derived
// via ReturnType — importing the named `DatabaseClient` type collides
// with a drizzle-orm namespace at this consumption site (TS2709). This is
// the same workaround `composition/db-client.ts` + `middleware/database.ts`
// use.
import { createDatabaseClient } from '@borjie/database';
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
import type {
  AccountBalance,
  AccountFilters,
  AtomicJournalPost,
  AtomicJournalResult,
  ChainedLedgerEntry,
  IAccountRepository,
  ILedgerRepository,
  LedgerEntryFilters,
  LedgerPaginatedResult,
} from '@borjie/payments-ledger-service';
// The hash-chain helper is imported from the SAME package the
// `LedgerService` comes from so the chain this adapter stamps is
// byte-identical to the one the payments-ledger repositories compute
// (durability defect #3 — parity). NEVER re-implement the hash here.
import {
  computeEntryHash,
  GENESIS_HASH,
} from '@borjie/payments-ledger-service';

// ────────────────────────────────────────────────────────────────────
// Local table declarations — column-name parity with the archived
// payments-ledger drizzle schema is mandatory. Declared as module-local
// consts so their inferred drizzle types never leak across the package
// boundary (avoids TS2883 portability diagnostics).
// ────────────────────────────────────────────────────────────────────

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
  // BIGINT money column (post-migration INTEGER→BIGINT). `mode: 'number'`
  // keeps the value a JS number so the balance arithmetic in
  // `postJournalAtomic` / `updateBalancesAtomic` is unchanged; the wider
  // column removes the 32-bit INTEGER overflow ceiling (a 5e9-shilling
  // settlement no longer overflows). Realistic minor-unit magnitudes stay
  // inside Number.MAX_SAFE_INTEGER (~9e15).
  balanceMinorUnits: bigint('balance_minor_units', { mode: 'number' })
    .notNull()
    .default(0),
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

const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  accountId: text('account_id').notNull(),
  journalId: text('journal_id').notNull(),
  type: text('type').notNull(),
  direction: text('direction').notNull(),
  // BIGINT money columns (post-migration INTEGER→BIGINT). `mode: 'number'`
  // preserves the JS-number contract the hash-chain + Money round-trip
  // relies on, while lifting the 32-bit overflow ceiling on large posts.
  // `sequence_number` / `entry_count` stay INTEGER (counters, never money).
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  balanceAfterMinorUnits: bigint('balance_after_minor_units', {
    mode: 'number',
  }).notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
  effectiveDate: timestamp('effective_date', { withTimezone: true }).notNull(),
  postedAt: timestamp('posted_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  paymentIntentId: text('payment_intent_id'),
  leaseId: text('lease_id'),
  propertyId: text('property_id'),
  unitId: text('unit_id'),
  invoiceId: text('invoice_id'),
  description: text('description'),
  metadata: jsonb('metadata').notNull().default({}),
  // Durability defect #3 — hash-chain tamper-evidence. Column parity
  // with the payments-ledger drizzle-ledger-entry.repository.ts decl:
  // `prev_hash` is the prior entry's `this_hash` in this (tenant,
  // account) chain ('' at genesis); `this_hash` =
  // sha256(canonicalJson({prev, payload})). Nullable so legacy rows
  // remain valid. The sibling database package ships these columns on
  // `ledger_entries` (migrations 0160-0162).
  prevHash: text('prev_hash'),
  thisHash: text('this_hash'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
});

// Local Drizzle declaration of the `journal_idempotency` table
// (durability defect #2). Column layout is byte-for-byte parity with
// the payments-ledger `drizzle-ledger-entry.repository.ts` decl: the
// composite PRIMARY KEY (tenant_id, idempotency_key) supplies the
// UNIQUE guarantee the duplicate-detection relies on. The sibling
// database package ships this table (migration 0162). The gateway's
// live-money `postJournalAtomic` writes the dedupe row in the SAME
// transaction as the balance CAS + entry inserts, so a duplicate key
// returns the prior journal instead of double-posting.
const journalIdempotency = pgTable(
  'journal_idempotency',
  {
    tenantId: text('tenant_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    journalId: text('journal_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.idempotencyKey] }),
  }),
);

type AccountRow = typeof accounts.$inferSelect;
type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

/**
 * Thrown by ledger-repository methods that are NOT part of the active
 * `LedgerService.postJournalEntry()` path. Fails loud — money code never
 * silently returns a wrong answer.
 */
export class LedgerOperationNotSupportedError extends Error {
  constructor(operation: string) {
    super(
      `LEDGER_OP_NOT_SUPPORTED: ${operation} is not implemented by the ` +
        `api-gateway ledger adapter (post-path only — read/statement/` +
        `integrity paths are not driven by the settlement / payroll ` +
        `adapters).`,
    );
    this.name = 'LedgerOperationNotSupportedError';
  }
}

// ────────────────────────────────────────────────────────────────────
// Enum translation (domain ↔ DB) — mirrors the package adapter.
// Domain: ACTIVE | FROZEN | CLOSED. DB enum: ACTIVE | SUSPENDED | CLOSED.
// ────────────────────────────────────────────────────────────────────

function statusFromDb(status: string): AccountStatus {
  if (status === 'SUSPENDED') return 'FROZEN';
  return status as AccountStatus;
}

function safeMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'object') return value as Record<string, unknown>;
  return undefined;
}

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

function rowToLedgerEntry(row: LedgerEntryRow): LedgerEntry {
  if (!row.currency) {
    throw new Error(
      `ledger_entries.currency invariant violated: row id=${String(
        row.id,
      )} has empty currency`,
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
    // Hash-chain tamper-evidence (durability defect #3). Null in legacy
    // rows; surfaced on the domain entry for verification.
    prevHash: row.prevHash ?? undefined,
    thisHash: row.thisHash ?? undefined,
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? '',
    updatedAt: row.createdAt,
    updatedBy: row.createdBy ?? '',
  } as LedgerEntry;
}

// Accepts a `ChainedLedgerEntry` (a `LedgerEntry` widened with the
// optional `prevHash`/`thisHash`). `createEntries` passes plain
// `LedgerEntry` values — structurally valid, the hash fields default to
// null; `postJournalAtomic` passes hash-stamped entries. Mirrors the
// payments-ledger `drizzle-ledger-entry.repository.ts` `entryToInsert`.
function entryToInsert(
  e: ChainedLedgerEntry,
): typeof ledgerEntries.$inferInsert {
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
    prevHash: e.prevHash ?? null,
    thisHash: e.thisHash ?? null,
    createdBy: e.createdBy ?? null,
  };
}

/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505).
 * postgres-js surfaces the SQLSTATE on `error.code`. `postJournalAtomic`
 * treats a (tenant_id, idempotency_key) or (account_id, sequence_number)
 * collision as a retryable outcome rather than a hard crash. Mirrors the
 * payments-ledger drizzle adapter's `isUniqueViolation`.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

// ────────────────────────────────────────────────────────────────────
// Account repository
// ────────────────────────────────────────────────────────────────────

export class GatewayDrizzleAccountRepository implements IAccountRepository {
  constructor(private readonly db: DatabaseClient) {}

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

  async updateBalancesAtomic(
    updates: ReadonlyArray<{
      readonly accountId: AccountId;
      readonly tenantId: TenantId;
      readonly newBalanceMinorUnits: number;
      readonly lastEntryId: string;
      readonly expectedVersion: number;
    }>,
  ): Promise<{ ok: true } | { ok: false; conflictAccountId: AccountId }> {
    // Multi-row optimistic CAS inside ONE transaction. A predicate miss
    // (entry_count != expectedVersion) rolls the WHOLE transaction back
    // via a thrown sentinel so no partial post lands. Mirrors the
    // package's own DrizzleAccountRepository.updateBalancesAtomic.
    class CasConflict extends Error {
      constructor(public readonly conflictAccountId: AccountId) {
        super(`CAS miss on account ${conflictAccountId}`);
      }
    }
    // Tenant for the GUC bind. A balanced journal's balance updates are
    // single-tenant; assert that invariant so a malformed cross-tenant
    // batch fails loud instead of binding the wrong tenant.
    const bindTenantId = updates[0]?.tenantId;
    if (bindTenantId === undefined) {
      return { ok: true };
    }
    if (updates.some((u) => u.tenantId !== bindTenantId)) {
      throw new Error(
        'updateBalancesAtomic: all balance updates must share one tenant_id ' +
          '(refusing to bind RLS context for a cross-tenant batch)',
      );
    }
    try {
      await (
        this.db as unknown as {
          transaction: (cb: (tx: unknown) => Promise<void>) => Promise<void>;
        }
      ).transaction(async (tx) => {
        const txDb = tx as DatabaseClient;
        // Bind the tenant GUC TRANSACTION-LOCALLY as the FIRST statement —
        // see postJournalAtomic for the full rationale (boot-pool ≠
        // request-pool ⇒ RLS fail-closed without this). `true` scopes it
        // to this tx so it never leaks across the pooled connection.
        await txDb.execute(
          sql`SELECT set_config('app.current_tenant_id', ${bindTenantId}, true)`,
        );
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

  // ---- not on the post path — fail loud -----------------------------
  async create(): Promise<Account> {
    throw new LedgerOperationNotSupportedError('IAccountRepository.create');
  }
  async update(): Promise<Account> {
    throw new LedgerOperationNotSupportedError('IAccountRepository.update');
  }
  async find(_filters: AccountFilters): Promise<Account[]> {
    throw new LedgerOperationNotSupportedError('IAccountRepository.find');
  }
  async findByCustomerAndType(): Promise<Account | null> {
    throw new LedgerOperationNotSupportedError(
      'IAccountRepository.findByCustomerAndType',
    );
  }
  async findByOwnerAndType(): Promise<Account | null> {
    throw new LedgerOperationNotSupportedError(
      'IAccountRepository.findByOwnerAndType',
    );
  }
  async findPlatformAccounts(): Promise<Account | null> {
    throw new LedgerOperationNotSupportedError(
      'IAccountRepository.findPlatformAccounts',
    );
  }
  async findByCustomer(): Promise<Account[]> {
    throw new LedgerOperationNotSupportedError(
      'IAccountRepository.findByCustomer',
    );
  }
  async findByOwner(): Promise<Account[]> {
    throw new LedgerOperationNotSupportedError(
      'IAccountRepository.findByOwner',
    );
  }
  async findWithPositiveBalance(): Promise<Account[]> {
    throw new LedgerOperationNotSupportedError(
      'IAccountRepository.findWithPositiveBalance',
    );
  }
  async updateBalance(): Promise<boolean> {
    throw new LedgerOperationNotSupportedError(
      'IAccountRepository.updateBalance (use updateBalancesAtomic)',
    );
  }
}

// ────────────────────────────────────────────────────────────────────
// Ledger repository
// ────────────────────────────────────────────────────────────────────

export class GatewayDrizzleLedgerRepository implements ILedgerRepository {
  constructor(private readonly db: DatabaseClient) {}

  async createEntries(entries: LedgerEntry[]): Promise<LedgerEntry[]> {
    if (entries.length === 0) return [];
    const inserted = await this.db
      .insert(ledgerEntries)
      .values(entries.map(entryToInsert))
      .returning();
    if (inserted.length !== entries.length) {
      throw new Error(
        `GatewayDrizzleLedgerRepository.createEntries: expected ${entries.length} rows, got ${inserted.length}`,
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

  async getNextSequenceNumber(
    accountId: AccountId,
    tenantId: TenantId,
  ): Promise<number> {
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

  /**
   * Idempotency lookup (durability defect #2). Returns the journalId a
   * prior post recorded under (tenant_id, idempotency_key), or null. The
   * `LedgerService.postJournalEntry()` fast-path calls this before any
   * write so a retried settlement / payroll post returns the original
   * journal instead of double-posting. Mirrors the payments-ledger
   * drizzle adapter's `findJournalIdByIdempotencyKey`.
   */
  async findJournalIdByIdempotencyKey(
    tenantId: TenantId,
    idempotencyKey: string,
  ): Promise<string | null> {
    const rows = await this.db
      .select({ journalId: journalIdempotency.journalId })
      .from(journalIdempotency)
      .where(
        and(
          eq(journalIdempotency.tenantId, tenantId),
          eq(journalIdempotency.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return rows[0]?.journalId ?? null;
  }

  /**
   * Durability defects #1/#2/#3 — the single-transaction journal post.
   * Byte-for-byte mirror of the payments-ledger
   * `DrizzleLedgerRepository.postJournalAtomic` so the gateway's LIVE
   * money path commits exactly like the package's own service.
   *
   * ONE `db.transaction` performs, in order:
   *   1. (defect #2) idempotency pre-check — duplicate key ⇒ abort, no
   *      write, return `{ status: 'duplicate', existingJournalId }`.
   *   2. (defect #1) per-account balance CAS UPDATEs (entry_count is the
   *      optimistic version). A miss throws `CasConflict` which rolls the
   *      WHOLE tx back ⇒ `{ status: 'stale' }` and the service retries
   *      off fresh rows.
   *   3. (defect #3) per (tenant, account) hash-chain: read the latest
   *      existing entry's `this_hash` INSIDE the tx, then fold each new
   *      entry's prev→this hash forward via the SHARED `computeEntryHash`.
   *   4. insert the hash-stamped entries. The `(account_id,
   *      sequence_number)` unique index rejects a colliding post; the
   *      violation rolls the tx back (balances included) ⇒ `stale`.
   *   5. (defect #2) insert the idempotency row in the SAME tx so the key
   *      and the journal are durable together.
   *
   * Either everything commits or everything rolls back — there is no
   * window where balances/entry_count move without matching entries.
   */
  async postJournalAtomic(
    post: AtomicJournalPost,
  ): Promise<AtomicJournalResult> {
    // Sentinels — thrown to roll back the tx, caught outside to map to a
    // structured result instead of a hard error.
    class CasConflict extends Error {
      constructor(public readonly conflictAccountId: AccountId) {
        super(`CAS miss on account ${conflictAccountId}`);
      }
    }
    class DuplicateIdempotencyKey extends Error {
      constructor(public readonly existingJournalId: string) {
        super('duplicate idempotency key');
      }
    }

    try {
      const committed = await (
        this.db as unknown as {
          transaction: <T>(cb: (tx: unknown) => Promise<T>) => Promise<T>;
        }
      ).transaction(async (tx) => {
        const txDb = tx as DatabaseClient;

        // 0 — bind the tenant GUC TRANSACTION-LOCALLY as the FIRST
        // statement. The production LedgerService is built once at boot
        // against the getDb() singleton pool — a DIFFERENT connection from
        // the request middleware that normally binds `app.current_tenant_id`
        // — so without this the atomic post runs with NO tenant bound and
        // FORCE RLS is fail-closed (or silently inert under Supabase
        // BYPASSRLS). The `true` third arg scopes set_config to THIS
        // transaction so it cannot leak across pooled connections, and it
        // is sourced from `post.tenantId` so the post is self-sufficient.
        await txDb.execute(
          sql`SELECT set_config('app.current_tenant_id', ${post.tenantId}, true)`,
        );

        // 1 — idempotency pre-check inside the tx.
        if (post.idempotencyKey !== undefined) {
          const existing = await txDb
            .select({ journalId: journalIdempotency.journalId })
            .from(journalIdempotency)
            .where(
              and(
                eq(journalIdempotency.tenantId, post.tenantId),
                eq(
                  journalIdempotency.idempotencyKey,
                  post.idempotencyKey,
                ),
              ),
            )
            .limit(1);
          if (existing[0]) {
            throw new DuplicateIdempotencyKey(existing[0].journalId);
          }
        }

        // 2 — per-account balance CAS in the same tx.
        for (const u of post.balanceUpdates) {
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

        // 3 — hash-chain: seed each account's prev-hash from the latest
        // existing entry, then fold forward over this post's entries
        // (ordered by sequenceNumber). Reading inside the tx is what
        // makes concurrent posters serialise correctly (the CAS on the
        // account row already serialised them).
        const prevHashByAccount = new Map<string, string>();
        const ordered = [...post.entries].sort(
          (a, b) => a.sequenceNumber - b.sequenceNumber,
        );
        const toInsert: ChainedLedgerEntry[] = [];
        for (const entry of ordered) {
          const acctKey = `${entry.tenantId}:${entry.accountId}`;
          const cached = prevHashByAccount.get(acctKey);
          let prev: string;
          if (cached !== undefined) {
            prev = cached;
          } else {
            const lastRow = await txDb
              .select({ thisHash: ledgerEntries.thisHash })
              .from(ledgerEntries)
              .where(
                and(
                  eq(ledgerEntries.accountId, entry.accountId),
                  eq(ledgerEntries.tenantId, entry.tenantId),
                ),
              )
              .orderBy(desc(ledgerEntries.sequenceNumber))
              .limit(1);
            prev = lastRow[0]?.thisHash ?? GENESIS_HASH;
          }
          const thisHash = computeEntryHash(prev, entry);
          prevHashByAccount.set(acctKey, thisHash);
          toInsert.push({ ...entry, prevHash: prev, thisHash });
        }

        // 4 — insert the hash-stamped entries (unique index on
        // (account_id, sequence_number) guards the sequence race; a
        // violation aborts the whole tx).
        const inserted = await txDb
          .insert(ledgerEntries)
          .values(toInsert.map(entryToInsert))
          .returning();
        if (inserted.length !== toInsert.length) {
          throw new Error(
            `postJournalAtomic: expected ${toInsert.length} rows, got ${inserted.length}`,
          );
        }

        // 5 — persist the idempotency key in the SAME tx.
        if (post.idempotencyKey !== undefined) {
          await txDb.insert(journalIdempotency).values({
            tenantId: post.tenantId,
            idempotencyKey: post.idempotencyKey,
            journalId: post.journalId,
          });
        }

        return inserted.map(rowToLedgerEntry);
      });

      return { status: 'committed', entries: committed };
    } catch (err) {
      if (err instanceof CasConflict) {
        return { status: 'stale', conflictAccountId: err.conflictAccountId };
      }
      if (err instanceof DuplicateIdempotencyKey) {
        return {
          status: 'duplicate',
          existingJournalId: err.existingJournalId,
        };
      }
      // A unique-violation racing two concurrent first-time posts on
      // (tenant_id, idempotency_key) — or on (account_id,
      // sequence_number) — surfaces here. If the idempotency row now
      // exists, return the existing journal directly; otherwise treat as
      // a retryable stale so the caller re-reads and recomputes.
      if (isUniqueViolation(err)) {
        if (post.idempotencyKey !== undefined) {
          const existing = await this.findJournalIdByIdempotencyKey(
            post.tenantId,
            post.idempotencyKey,
          );
          if (existing !== null) {
            return { status: 'duplicate', existingJournalId: existing };
          }
        }
        return {
          status: 'stale',
          conflictAccountId:
            post.balanceUpdates[0]?.accountId ??
            (post.entries[0]?.accountId as AccountId),
        };
      }
      throw err;
    }
  }

  // ---- not on the post path — fail loud -----------------------------
  async findByAccount(): Promise<LedgerPaginatedResult> {
    throw new LedgerOperationNotSupportedError(
      'ILedgerRepository.findByAccount',
    );
  }
  async find(_filters: LedgerEntryFilters): Promise<LedgerPaginatedResult> {
    throw new LedgerOperationNotSupportedError('ILedgerRepository.find');
  }
  async findLatestByAccount(): Promise<LedgerEntry | null> {
    throw new LedgerOperationNotSupportedError(
      'ILedgerRepository.findLatestByAccount',
    );
  }
  async calculateAccountBalance(): Promise<AccountBalance | null> {
    throw new LedgerOperationNotSupportedError(
      'ILedgerRepository.calculateAccountBalance',
    );
  }
  async findForStatement(): Promise<LedgerEntry[]> {
    throw new LedgerOperationNotSupportedError(
      'ILedgerRepository.findForStatement',
    );
  }
  async getTotalsByType(): Promise<
    Map<LedgerEntryType, { debits: number; credits: number }>
  > {
    throw new LedgerOperationNotSupportedError(
      'ILedgerRepository.getTotalsByType',
    );
  }
  async verifyIntegrity(): Promise<{
    valid: boolean;
    gaps: number[];
    duplicates: number[];
  }> {
    throw new LedgerOperationNotSupportedError(
      'ILedgerRepository.verifyIntegrity',
    );
  }
}

export { accounts as ledgerAccountsTable, ledgerEntries as ledgerEntriesTable };
