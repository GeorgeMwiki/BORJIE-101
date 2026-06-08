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

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
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
import { pgTable, text, timestamp, integer, bigint, jsonb } from 'drizzle-orm/pg-core';
import { type DatabaseClient, eventOutbox } from '@borjie/database';

// Local Drizzle table declaration for the legacy payments-ledger
// `ledger_entries` table. The canonical schema was archived in
// `packages/database/.archive/migrations/0167b_payments_ledger_drizzle.sql`
// when the database package pivoted to the mining domain; the repository
// adapter still needs the shape for production deployments that retain
// the table. Declared as a module-internal const so its inferred type
// stays inside this compilation unit. Column-name parity with the
// archived schema is mandatory.
const ledgerEntries = pgTable('ledger_entries', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  accountId: text('account_id').notNull(),
  journalId: text('journal_id').notNull(),
  type: text('type').notNull(),
  direction: text('direction').notNull(),
  // C2 — overflow safety. Money minor-unit columns are BIGINT in the DB
  // (sibling-owned migration 0161 + @borjie/database schema). `mode:
  // 'number'` keeps the JS value a `number` (no BigInt refactor;
  // Number.MAX_SAFE_INTEGER ≈ 9.0e15 dwarfs any realistic TZS minor-unit
  // total). The (account_id, sequence_number) ordering columns stay
  // INTEGER — they count entries, never money.
  amountMinorUnits: bigint('amount_minor_units', { mode: 'number' }).notNull(),
  currency: text('currency').notNull(),
  balanceAfterMinorUnits: bigint('balance_after_minor_units', {
    mode: 'number',
  }).notNull(),
  sequenceNumber: integer('sequence_number').notNull(),
  effectiveDate: timestamp('effective_date', {
    withTimezone: true,
  }).notNull(),
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
  // Durability defect #3 — hash-chain tamper-evidence. `prev_hash` is
  // the prior entry's `this_hash` in this (tenant, account) chain (''
  // at genesis); `this_hash` = sha256(canonicalJson({prev, payload})).
  // FLAGGED for the database-package sibling: add columns
  //   prev_hash TEXT,  this_hash TEXT
  // to `ledger_entries`. Nullable so legacy rows remain valid.
  prevHash: text('prev_hash'),
  thisHash: text('this_hash'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdBy: text('created_by'),
});

type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

// Local Drizzle declaration of the `accounts` table — column-name
// parity with `drizzle-account.repository.ts`. The ledger repo touches
// it ONLY inside `postJournalAtomic`, to fold the per-account balance
// CAS into the SAME transaction as the entry inserts (durability defect
// #1: atomicity). Read-paths stay in the account repo.
const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  // C2 — overflow safety: BIGINT money column (mode 'number'). entryCount
  // below stays INTEGER (it is the optimistic-lock version, not money).
  balanceMinorUnits: bigint('balance_minor_units', { mode: 'number' })
    .notNull()
    .default(0),
  lastEntryId: text('last_entry_id'),
  lastEntryAt: timestamp('last_entry_at', { withTimezone: true }),
  entryCount: integer('entry_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Local Drizzle declaration of the `journal_idempotency` table
// (durability defect #2). FLAGGED for the database-package sibling:
// create table
//   journal_idempotency (
//     tenant_id        TEXT NOT NULL,
//     idempotency_key  TEXT NOT NULL,
//     journal_id       TEXT NOT NULL,
//     created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
//     PRIMARY KEY (tenant_id, idempotency_key)
//   );
// The composite PK supplies the UNIQUE (tenant_id, idempotency_key)
// guarantee the duplicate-detection relies on.
const journalIdempotency = pgTable('journal_idempotency', {
  tenantId: text('tenant_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  journalId: text('journal_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});
import type {
  AccountBalance,
  AtomicJournalPost,
  AtomicJournalResult,
  ILedgerRepository,
  LedgerEntryFilters,
  LedgerPaginatedResult,
} from './ledger.repository';
import {
  GENESIS_HASH,
  computeEntryHash,
} from '../services/ledger-hash-chain';
import type { ChainedLedgerEntry } from '../domain-extensions';

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

/**
 * Detect a Postgres unique-constraint violation (SQLSTATE 23505).
 * postgres-js surfaces the SQLSTATE on `error.code`. Used by
 * `postJournalAtomic` to treat a (tenant_id, idempotency_key) or
 * (account_id, sequence_number) collision as a retryable outcome
 * rather than a hard crash.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
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
    // Hash-chain tamper-evidence (durability defect #3). Null in legacy
    // rows; `verifyHashChain` tolerates undefined.
    prevHash: row.prevHash ?? undefined,
    thisHash: row.thisHash ?? undefined,
    createdAt: row.createdAt,
    createdBy: row.createdBy ?? '',
    // Audit / tenant-scoped fields the domain demands. Ledger rows
    // are immutable so `updatedAt`/`updatedBy` mirror createdAt/By.
    updatedAt: row.createdAt,
    updatedBy: row.createdBy ?? '',
  } as LedgerEntry;
}

function entryToInsert(e: ChainedLedgerEntry): typeof ledgerEntries.$inferInsert {
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
   *
   * ONE `db.transaction` performs, in order:
   *   1. (defect #2) idempotency pre-check — duplicate key ⇒ abort, no
   *      write, return `{ status: 'duplicate' }`.
   *   2. (defect #1) per-account balance CAS UPDATEs. A miss throws the
   *      `CasConflict` sentinel which rolls the WHOLE tx back ⇒ caller
   *      gets `{ status: 'stale' }` and retries off fresh rows.
   *   3. (defect #3) per (tenant, account) hash-chain: read the latest
   *      existing entry's `this_hash` INSIDE the tx, then fold each new
   *      entry's prev→this hash forward. Reading inside the tx is what
   *      makes concurrent posters serialise correctly (the CAS on the
   *      account row already serialised them).
   *   4. insert the hash-stamped entries. The `(account_id,
   *      sequence_number)` unique index rejects a colliding post; the
   *      violation rolls the tx back (balances included) ⇒ surfaced as
   *      `stale`.
   *   5. (defect #2) insert the idempotency row in the SAME tx, so the
   *      key and the journal are durable together.
   */
  async postJournalAtomic(
    post: AtomicJournalPost,
  ): Promise<AtomicJournalResult> {
    // Sentinels — thrown to roll back the tx, caught outside to map to
    // a structured result instead of a hard error.
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
        const txDb = tx as typeof this.db;

        // C1 — RLS context (CRITICAL). Bind `app.current_tenant_id`
        // TRANSACTION-LOCALLY as the FIRST statement, BEFORE any read or
        // write. FORCE RLS on `accounts` / `ledger_entries` /
        // `journal_idempotency` evaluates
        //   tenant_id = current_setting('app.current_tenant_id', true)
        // so without this bind the GUC is empty and (with FORCE RLS and no
        // BYPASSRLS role) every statement in this tx fails closed — or, on
        // a connection that inherited a stale GUC from a pooled request,
        // would silently scope to the WRONG tenant. The `true` third arg
        // of set_config scopes the binding to THIS transaction, so it
        // cannot leak across pooled connections. We mirror the legacy
        // `app.tenant_id` GUC for the 0146/0156 migration helpers that
        // still read the older name — same contract as
        // `@borjie/database`'s withTenantContext (which this package
        // cannot import: it is not on the package's `exports` map and the
        // db package is out of scope for this change).
        await txDb.execute(
          sql`SELECT set_config('app.current_tenant_id', ${post.tenantId}, true)`,
        );
        await txDb.execute(
          sql`SELECT set_config('app.tenant_id', ${post.tenantId}, true)`,
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
        // (already ordered by sequenceNumber from the service).
        const prevHashByAccount = new Map<string, string>();
        const ordered = [...post.entries].sort(
          (a, b) => a.sequenceNumber - b.sequenceNumber,
        );
        const toInsert: ChainedLedgerEntry[] = [];
        for (const entry of ordered) {
          const acctKey = `${entry.tenantId}:${entry.accountId}`;
          let prev = prevHashByAccount.get(acctKey);
          if (prev === undefined) {
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

        // 6 — RSS-01: co-commit the producer's domain events to
        // `event_outbox` in the SAME tx, so emission is at-least-once and
        // crash-safe. This is purely ADDITIVE and runs AFTER every
        // financial write (balances + entries + idempotency) — the money
        // math above is byte-for-byte untouched — but still INSIDE the
        // atomic boundary, so an outbox-insert failure rolls the WHOLE tx
        // back (money included) and a commit makes both durable together.
        // The RLS GUC `app.current_tenant_id` is already bound (C1 above),
        // so these rows land under `event_outbox`'s FORCE-RLS tenant
        // predicate with no extra plumbing. Sequence number is assigned
        // race-free inside the INSERT (correlated subquery). `id` is the
        // stable consumer-idempotency message_id; `onConflictDoNothing()`
        // on the PK makes a re-emit of the same row a no-op.
        if (post.outboxRows && post.outboxRows.length > 0) {
          const outboxValues = post.outboxRows.map((r, idx) => ({
            id: r.id,
            tenantId: r.tenantId,
            eventType: r.eventType,
            aggregateType: r.aggregateType,
            aggregateId: r.aggregateId,
            payload: r.payload,
            metadata: r.metadata,
            // Sequence number assigned race-free inside the INSERT. Drizzle
            // accepts a `SQL` expression for a column even though the
            // inferred-insert type narrows it to `number`, so widen this
            // one field via `satisfies`.
            sequenceNumber: sql<number>`(SELECT COALESCE(MAX(${eventOutbox.sequenceNumber}), 0) FROM ${eventOutbox}) + ${idx + 1}`,
          })) satisfies Array<
            Omit<typeof eventOutbox.$inferInsert, 'sequenceNumber'> & {
              sequenceNumber: SQL<number>;
            }
          >;
          await txDb.insert(eventOutbox).values(outboxValues).onConflictDoNothing();
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
      // A unique-violation on (tenant_id, idempotency_key) racing two
      // concurrent first-time posts, or on (account_id, sequence_number),
      // surfaces here. Treat as a retryable stale so the caller re-reads
      // (the retry then hits the now-present idempotency row and returns
      // the existing journal, or recomputes a fresh sequence).
      if (isUniqueViolation(err)) {
        // Best-effort: if it was the idempotency key, return the
        // existing journal directly to avoid a needless retry.
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
          conflictAccountId: post.balanceUpdates[0]?.accountId ??
            (post.entries[0]?.accountId as AccountId),
        };
      }
      throw err;
    }
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
    //
    // M3 (reviewed, intentionally NOT moved into postJournalAtomic):
    // the sequence number is an INPUT to the hash-chain payload
    // (computeEntryHash commits to sequenceNumber) and to each entry's
    // balanceAfter ordering, both of which the LedgerService computes
    // while building the immutable entries BEFORE the atomic post. Re-
    // assigning sequences inside the transaction would force the repo to
    // either rebuild/re-hash the already-constructed entries (a layering
    // violation that desyncs from the precomputed balanceUpdates) or
    // mutate append-only objects in place — both worse than the current
    // design. Atomicity is NOT at risk today: a sequence collision rolls
    // the WHOLE tx back (balances + entries + idempotency row together)
    // and surfaces as `stale`, which the bounded jittered retry resolves;
    // the per-account balance CAS already serialises concurrent posters
    // on a hot account, so this read is not the dominant contention
    // source. Left as-is by design.
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
