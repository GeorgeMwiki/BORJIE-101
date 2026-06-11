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
import {
  GENESIS_HASH,
  computeEntryHash,
} from '../services/ledger-hash-chain';
import type { ChainedLedgerEntry } from '../domain-extensions';
import type { NewOutboxRow } from '../events/outbox-row';

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

/**
 * A single per-account balance write applied as part of an atomic
 * journal post. `expectedVersion` is the optimistic-lock version the
 * caller read (the account's `entryCount`); the write only lands when
 * the row still carries that version, otherwise the whole post rolls
 * back. Mirrors `IAccountRepository.updateBalancesAtomic`'s update
 * shape so the two stay in lockstep.
 */
export interface AtomicBalanceUpdate {
  readonly accountId: AccountId;
  readonly tenantId: TenantId;
  readonly newBalanceMinorUnits: number;
  readonly lastEntryId: string;
  readonly expectedVersion: number;
}

/**
 * Input to `postJournalAtomic` — the entries to insert, the balance
 * writes to apply, and an optional idempotency key. All three commit
 * inside ONE database transaction (durability defect #1: atomicity).
 */
export interface AtomicJournalPost {
  readonly tenantId: TenantId;
  readonly journalId: string;
  readonly entries: LedgerEntry[];
  readonly balanceUpdates: ReadonlyArray<AtomicBalanceUpdate>;
  /**
   * Optional idempotency key (durability defect #2). When present it is
   * persisted with a UNIQUE (tenant_id, idempotency_key) guarantee; a
   * duplicate aborts the post so the service can return the prior
   * journal instead of double-posting.
   */
  readonly idempotencyKey?: string;
  /**
   * RSS-01 — the producer's domain events, ALREADY serialised into the
   * minimal `NewOutboxRow` shape by `LedgerService` (via
   * `IEventPublisher.serializeForTx`). When present, these rows are
   * inserted into `event_outbox` INSIDE the same transaction as the
   * ledger entries + balance CAS, so event emission is at-least-once and
   * crash-safe: a failure rolls the outbox rows back WITH the money
   * write, and a commit makes both durable together. The money math is
   * untouched — this is a purely additive insert after all financial
   * writes, still inside the atomic boundary. Optional → existing callers
   * and tests are unaffected.
   */
  readonly outboxRows?: ReadonlyArray<NewOutboxRow>;
}

/**
 * Outcome of `postJournalAtomic`.
 *   - `committed`  — the single transaction landed; `entries` are the
 *                    persisted rows (with hash-chain fields populated).
 *   - `stale`      — an optimistic-lock (CAS) miss on `conflictAccountId`;
 *                    the whole transaction rolled back, nothing was
 *                    written. The caller re-reads + retries.
 *   - `duplicate`  — the idempotency key already exists for this tenant;
 *                    nothing was written. The caller returns the
 *                    pre-existing journal under `existingJournalId`.
 */
export type AtomicJournalResult =
  | { readonly status: 'committed'; readonly entries: LedgerEntry[] }
  | { readonly status: 'stale'; readonly conflictAccountId: AccountId }
  | { readonly status: 'duplicate'; readonly existingJournalId: string };

export interface ILedgerRepository {
  /**
   * Create ledger entries (batch insert for journal)
   * MUST be atomic - all entries created or none
   */
  createEntries(entries: LedgerEntry[]): Promise<LedgerEntry[]>;

  /**
   * Durability defects #1/#2/#3 — post a journal ATOMICALLY.
   *
   * Applies the per-account balance CAS updates AND inserts the ledger
   * entries (with their hash-chain `prevHash`/`thisHash`) inside ONE
   * database transaction. Either everything commits or everything rolls
   * back — there is no window where balances/entry_count move without
   * matching entries (the bug this method exists to kill).
   *
   * Sequence-number collisions (the documented unique-constraint race
   * on `(account_id, sequence_number)`) roll back the WHOLE transaction,
   * surfacing as a `stale` result so the caller retries off fresh rows.
   *
   * When `idempotencyKey` is supplied and already exists for the tenant,
   * NOTHING is written and `{ status: 'duplicate', existingJournalId }`
   * is returned.
   *
   * The hash-chain `prevHash` for each account's first entry in this
   * post is read INSIDE the transaction (the latest existing entry's
   * `thisHash`), so concurrent posters serialise correctly under the
   * same CAS that guards the balance.
   */
  postJournalAtomic(post: AtomicJournalPost): Promise<AtomicJournalResult>;

  /**
   * Idempotency lookup (durability defect #2). Returns the journalId a
   * prior post recorded under `(tenantId, idempotencyKey)`, or null if
   * the key was never used. Used to return the existing journal result
   * on a retried post.
   */
  findJournalIdByIdempotencyKey(
    tenantId: TenantId,
    idempotencyKey: string,
  ): Promise<string | null>;

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
 * Thrown by the InMemory `postJournalAtomic` when two entries would
 * collide on `(account_id, sequence_number)` — the in-memory model of
 * the production unique-index violation. Surfaced as a `stale` result
 * so the caller retries, and rolls the whole transaction back.
 */
class SequenceCollisionError extends Error {
  constructor(
    public readonly accountId: AccountId,
    public readonly sequenceNumber: number,
  ) {
    super(
      `Ledger sequence collision on account ${accountId} seq ${sequenceNumber}`,
    );
    this.name = 'SequenceCollisionError';
  }
}

/**
 * Minimal transactional account-store surface the InMemory ledger repo
 * needs to apply balance CAS writes inside the same atomic unit as its
 * entry inserts. `InMemoryAccountRepository` implements this. The
 * double-underscore methods are internal coordination hooks, NOT part
 * of the public `IAccountRepository` contract.
 */
export interface LedgerTxAccountStore {
  __snapshotForLedgerTx(): unknown;
  __restoreForLedgerTx(snapshot: unknown): void;
  __applyBalanceWritesForLedgerTx(
    updates: ReadonlyArray<AtomicBalanceUpdate>,
  ): { ok: true } | { ok: false; conflictAccountId: AccountId };
}

/**
 * In-memory implementation for testing.
 *
 * `postJournalAtomic` coordinates with an injected account store so the
 * balance writes and the entry inserts commit (or roll back) together,
 * modelling the single DB transaction the Drizzle adapter runs in
 * production. JavaScript is single-threaded, so the validate-then-apply
 * sequence has no interleaving-await window; on any failure we restore
 * a snapshot of BOTH stores (no orphan balance).
 */
export class InMemoryLedgerRepository implements ILedgerRepository {
  private entries: Map<string, LedgerEntry> = new Map();
  private sequenceCounters: Map<string, number> = new Map();
  /** Persisted idempotency keys → journalId (durability defect #2). */
  private idempotencyKeys: Map<string, string> = new Map();
  /**
   * RSS-01 — outbox rows committed alongside ledger entries. Staged INSIDE
   * the same snapshot/rollback guard as the entries + balances + idempotency
   * key, so a fault (CAS miss, sequence collision, injected fault) rolls the
   * outbox rows back too — proving co-commit in the in-memory model exactly
   * as `event_outbox` co-commits in the Drizzle transaction. Test-readable
   * via `getCommittedOutboxRows`.
   */
  private committedOutboxRows: NewOutboxRow[] = [];
  /**
   * Optional fault injected BETWEEN the balance writes and the entry
   * inserts — exercises the rollback-of-both invariant in tests. When
   * set and it throws, `postJournalAtomic` must restore the account
   * snapshot so no orphan balance survives. Test-only.
   */
  private faultBetweenBalanceAndEntries: (() => void) | null = null;

  /** Test hook: inject a fault between balance writes and entry inserts. */
  setFaultBetweenBalanceAndEntries(fault: (() => void) | null): void {
    this.faultBetweenBalanceAndEntries = fault;
  }

  /**
   * RSS-01 test hook — the outbox rows committed alongside ledger entries.
   * Returns a defensive copy. Used by the co-commit tests to assert that a
   * successful post staged the producer's events AND that a rolled-back
   * post left zero rows (proving outbox and money roll back together).
   */
  getCommittedOutboxRows(): NewOutboxRow[] {
    return [...this.committedOutboxRows];
  }

  private idempotencyMapKey(tenantId: TenantId, key: string): string {
    return `${tenantId}::${key}`;
  }

  async findJournalIdByIdempotencyKey(
    tenantId: TenantId,
    idempotencyKey: string,
  ): Promise<string | null> {
    return (
      this.idempotencyKeys.get(this.idempotencyMapKey(tenantId, idempotencyKey)) ??
      null
    );
  }

  async postJournalAtomic(
    post: AtomicJournalPost,
  ): Promise<AtomicJournalResult> {
    // Durability defect #2 — idempotency: a duplicate key short-circuits
    // BEFORE any write. UNIQUE (tenant_id, idempotency_key) in prod.
    if (post.idempotencyKey !== undefined) {
      const existing = await this.findJournalIdByIdempotencyKey(
        post.tenantId,
        post.idempotencyKey,
      );
      if (existing !== null) {
        return { status: 'duplicate', existingJournalId: existing };
      }
    }

    if (this.accountStore === null) {
      throw new Error(
        'InMemoryLedgerRepository.postJournalAtomic: account store not attached. ' +
          'Call attachAccountStore(accountRepo) (the factory does this).',
      );
    }

    // Durability defect #1 — atomicity: snapshot BOTH stores so any
    // failure (CAS miss, sequence collision, injected fault) rolls back
    // the balance writes AND the entry inserts together.
    const accountSnapshot = this.accountStore.__snapshotForLedgerTx();
    const entriesSnapshot = new Map(this.entries);
    const sequenceSnapshot = new Map(this.sequenceCounters);
    const idempotencySnapshot = new Map(this.idempotencyKeys);
    // RSS-01 — snapshot the outbox rows in the SAME guard so a rollback
    // un-stages any rows added this post (co-commit / co-rollback).
    const outboxSnapshot = [...this.committedOutboxRows];

    try {
      // 1. Apply per-account CAS balance writes (validate-all then
      //    mutate-all — no orphan if any predicate fails).
      const cas = this.accountStore.__applyBalanceWritesForLedgerTx(
        post.balanceUpdates,
      );
      if (!cas.ok) {
        return { status: 'stale', conflictAccountId: cas.conflictAccountId };
      }

      // 2. Fault injection point — models a crash AFTER balances move
      //    but BEFORE entries land. Must roll back balances.
      if (this.faultBetweenBalanceAndEntries) {
        this.faultBetweenBalanceAndEntries();
      }

      // 3. Hash-chain (durability defect #3) + insert + sequence-collision
      //    guard (models the (account_id, sequence_number) unique index).
      //    prevHash seeds from the latest existing entry's thisHash per
      //    account, then folds forward over this post's entries.
      const created: LedgerEntry[] = [];
      const prevHashByAccount = new Map<string, string>();
      const ordered = [...post.entries].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber,
      );
      for (const entry of ordered) {
        const acctKey = `${entry.tenantId}:${entry.accountId}`;
        for (const existing of this.entries.values()) {
          if (
            existing.tenantId === entry.tenantId &&
            existing.accountId === entry.accountId &&
            existing.sequenceNumber === entry.sequenceNumber
          ) {
            throw new SequenceCollisionError(
              entry.accountId,
              entry.sequenceNumber,
            );
          }
        }

        let prev = prevHashByAccount.get(acctKey);
        if (prev === undefined) {
          prev = this.latestThisHashForAccount(
            entry.tenantId,
            entry.accountId,
          );
        }
        const thisHash = computeEntryHash(prev, entry);
        prevHashByAccount.set(acctKey, thisHash);
        const chained: ChainedLedgerEntry = {
          ...entry,
          prevHash: prev,
          thisHash,
        };

        this.entries.set(chained.id, { ...chained });
        created.push({ ...chained });
        const current = this.sequenceCounters.get(acctKey) || 0;
        if (entry.sequenceNumber > current) {
          this.sequenceCounters.set(acctKey, entry.sequenceNumber);
        }
      }

      // 4. Persist the idempotency key in the same atomic unit.
      if (post.idempotencyKey !== undefined) {
        this.idempotencyKeys.set(
          this.idempotencyMapKey(post.tenantId, post.idempotencyKey),
          post.journalId,
        );
      }

      // 5. RSS-01 — co-commit the producer's outbox rows in the SAME
      //    atomic unit. They were staged after all financial writes; if
      //    anything above had thrown we'd never reach here, and if a fault
      //    is injected the catch below restores `outboxSnapshot` — so the
      //    outbox rows roll back WITH the money write (no half-write).
      if (post.outboxRows && post.outboxRows.length > 0) {
        this.committedOutboxRows.push(...post.outboxRows);
      }

      return { status: 'committed', entries: created };
    } catch (err) {
      // Roll back EVERYTHING — balance writes included. This is the
      // invariant the separate-transactions bug violated.
      this.accountStore.__restoreForLedgerTx(accountSnapshot);
      this.entries = entriesSnapshot;
      this.sequenceCounters = sequenceSnapshot;
      this.idempotencyKeys = idempotencySnapshot;
      // RSS-01 — un-stage any outbox rows added this post (co-rollback).
      this.committedOutboxRows = outboxSnapshot;
      if (err instanceof SequenceCollisionError) {
        // A collision behaves like a stale-version race: caller retries.
        return { status: 'stale', conflictAccountId: err.accountId };
      }
      throw err;
    }
  }

  /**
   * Attached account store used by `postJournalAtomic` to apply balance
   * CAS writes inside the same atomic unit as the entry inserts. Set by
   * the factory (and tests) via `attachAccountStore`.
   */
  private accountStore: LedgerTxAccountStore | null = null;

  attachAccountStore(store: LedgerTxAccountStore): void {
    this.accountStore = store;
  }

  /**
   * The `thisHash` of the highest-sequence entry for an account, or
   * GENESIS_HASH if the account has no entries yet. Seeds the per-account
   * hash chain when a journal post touches an account for the first time
   * within that post.
   */
  private latestThisHashForAccount(
    tenantId: TenantId,
    accountId: AccountId,
  ): string {
    let latest: ChainedLedgerEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.tenantId === tenantId && entry.accountId === accountId) {
        const candidate = entry as ChainedLedgerEntry;
        if (latest === null || candidate.sequenceNumber > latest.sequenceNumber) {
          latest = candidate;
        }
      }
    }
    return latest?.thisHash ?? GENESIS_HASH;
  }

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

    const first = entries[0];
    return first ? { ...first } : null;
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
    if (!lastEntry) {
      return null;
    }

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
      const current = entries[i];
      if (!current) continue;
      const seq = current.sequenceNumber;

      if (seen.has(seq)) {
        duplicates.push(seq);
      }
      seen.add(seq);

      if (i > 0) {
        const previous = entries[i - 1];
        if (previous) {
          const prevSeq = previous.sequenceNumber;
          if (seq !== prevSeq + 1) {
            for (let g = prevSeq + 1; g < seq; g++) {
              gaps.push(g);
            }
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
