/**
 * Ledger Service
 * Manages the immutable double-entry ledger
 */
import { v4 as uuidv4 } from 'uuid';
import {
  Money,
  LedgerEntry,
  LedgerEntryId,
  AccountId,
  TenantId,
  Account,
  AccountAggregate,
  CreateJournalEntryRequest,
  JournalEntryLine,
  validateJournalBalance,
  createJournalId,
  CurrencyCode
} from '@borjie/domain-models';
import { createId } from '../domain-extensions';
import { ILedgerRepository, AccountBalance } from '../repositories/ledger.repository';
import { IAccountRepository } from '../repositories/account.repository';
import { IEventPublisher, createEvent } from '../events/event-publisher';
import {
  LedgerEntriesCreatedEvent,
  AccountBalanceUpdatedEvent
} from '../events/payment-events';
import { ILogger } from './payment-orchestration.service';
import { omitUndefined } from '../lib/omit-undefined';
import { verifyHashChain, type HashChainVerification } from './ledger-hash-chain';

export interface LedgerServiceDeps {
  ledgerRepository: ILedgerRepository;
  accountRepository: IAccountRepository;
  eventPublisher: IEventPublisher;
  logger: ILogger;
}

/**
 * Result of posting a journal entry
 */
export interface JournalPostResult {
  journalId: string;
  entries: LedgerEntry[];
  updatedAccounts: Account[];
  /**
   * True when this result was served from a prior post via the
   * idempotency key (durability defect #2) rather than freshly written.
   * No second post occurred; balances were not touched again.
   */
  idempotentReplay?: boolean;
}

/**
 * Optional controls for a journal post.
 */
export interface PostJournalOptions {
  /**
   * Idempotency key (durability defect #2). When supplied, the post is
   * recorded under a UNIQUE (tenant_id, idempotency_key) guarantee; a
   * retry with the same key returns the ORIGINAL journal result instead
   * of double-posting.
   */
  readonly idempotencyKey?: string;
}

/**
 * Thrown internally by `postJournalEntryAttempt` when the optimistic
 * lock (CAS) on `accountRepository.updateBalancesAtomic` fails — i.e.
 * another writer mutated the row between our SELECT and our UPDATE.
 *
 * The outer `postJournalEntry` catches this sentinel and re-runs the
 * attempt against the fresh row. Never propagates beyond the retry
 * loop — exhausted retries surface as a plain `Error` so callers don't
 * need to import the CAS internals.
 */
class StaleAccountVersionError extends Error {
  constructor(
    public readonly accountId: AccountId,
    public readonly tenantId: TenantId,
  ) {
    super(
      `Ledger CAS: stale account version for ${accountId} (tenant ${tenantId})`,
    );
    this.name = 'StaleAccountVersionError';
  }
}

/**
 * H3 — idempotency replay defense (defense-in-depth). Thrown LOUD when a
 * post arrives under an idempotency key that already maps to a journal
 * whose leg amounts/accounts/directions DIFFER from this request's
 * recomputed legs. Serving the stale journal silently would let a caller
 * reuse a key for a different transaction and get back the wrong money;
 * we refuse instead. (The gateway also pins the key to the request body;
 * this is the engine backstop in case that ever regresses.)
 */
export class IdempotencyMismatchError extends Error {
  readonly code = 'LEDGER_IDEMPOTENCY_MISMATCH';
  constructor(
    public readonly idempotencyKey: string,
    public readonly journalId: string,
    public readonly tenantId: TenantId,
  ) {
    super(
      `LEDGER_IDEMPOTENCY_MISMATCH: idempotency key '${idempotencyKey}' was already used for journal ` +
        `${journalId} (tenant ${tenantId}) with different legs. Refusing to serve a stale journal for a ` +
        `mismatched request.`,
    );
    this.name = 'IdempotencyMismatchError';
  }
}

/**
 * H3 — canonical leg signature for idempotency-replay comparison. We
 * compare the IMMUTABLE financial substance of each leg: account,
 * direction, type, amount (minor units), and currency. The signature is
 * a SORTED list (not keyed by account) so it is order-independent AND
 * correct when two legs touch the SAME account (the H2 fold case) — a
 * map keyed by account would collapse those and miss a mismatch.
 *
 * `balanceAfter` / sequenceNumber / ids are deliberately excluded: they
 * are derived per-post state, not part of the caller's request intent.
 */
function legSignature(
  legs: ReadonlyArray<{
    readonly accountId: string;
    readonly direction: string;
    readonly type: string;
    readonly amountMinorUnits: number;
    readonly currency: string;
  }>,
): string {
  return legs
    .map(
      (l) =>
        `${l.accountId}|${l.direction}|${l.type}|${l.amountMinorUnits}|${l.currency}`,
    )
    .sort()
    .join(';;');
}

/**
 * Ledger Service
 * Provides atomic, double-entry bookkeeping operations
 */
export class LedgerService {
  private ledgerRepository: ILedgerRepository;
  private accountRepository: IAccountRepository;
  private eventPublisher: IEventPublisher;
  private logger: ILogger;

  constructor(deps: LedgerServiceDeps) {
    this.ledgerRepository = deps.ledgerRepository;
    this.accountRepository = deps.accountRepository;
    this.eventPublisher = deps.eventPublisher;
    this.logger = deps.logger;

    // Durability defect #1 — atomicity wiring for the in-memory adapter.
    // The InMemory ledger repo folds balance CAS writes into the same
    // atomic unit as its entry inserts, so it needs the same account
    // store instance this service uses. The Drizzle path uses a single
    // `db.transaction` and needs no wiring (the factory leaves these
    // hooks absent). Duck-typed so neither adapter leaks its concrete
    // type into the service.
    const ledgerRepo = this.ledgerRepository as unknown as {
      attachAccountStore?: (store: unknown) => void;
    };
    const accountStore = this.accountRepository as unknown as {
      __snapshotForLedgerTx?: unknown;
    };
    if (
      typeof ledgerRepo.attachAccountStore === 'function' &&
      typeof accountStore.__snapshotForLedgerTx === 'function'
    ) {
      ledgerRepo.attachAccountStore(this.accountRepository);
    }
  }

  /**
   * Post a journal entry (atomic double-entry operation).
   *
   * Durability guarantees:
   *   - #1 ATOMICITY: balance writes AND entry inserts commit inside ONE
   *     transaction via `ledgerRepository.postJournalAtomic`. There is no
   *     window where balances/entry_count move without matching entries.
   *   - #2 IDEMPOTENCY: when `options.idempotencyKey` is supplied, a
   *     retried post returns the ORIGINAL journal (no second post).
   *   - #3 HASH-CHAIN: each entry is hash-chained inside the transaction.
   *   - BALANCE: rejected unless debits == credits (integer minor units).
   */
  async postJournalEntry(
    request: CreateJournalEntryRequest,
    options: PostJournalOptions = {},
  ): Promise<JournalPostResult> {
    // Validate that the journal is balanced (hard rule — real money).
    if (!validateJournalBalance(request.lines)) {
      throw new Error('Journal entry is not balanced: debits must equal credits');
    }
    if (request.lines.length === 0) {
      throw new Error('Journal entry must have at least one line');
    }

    // Durability defect #2 — fast-path idempotency check. A prior post
    // under this key returns its journal without touching balances.
    if (options.idempotencyKey !== undefined) {
      const existingJournalId =
        await this.ledgerRepository.findJournalIdByIdempotencyKey(
          request.tenantId,
          options.idempotencyKey,
        );
      if (existingJournalId !== null) {
        // H3 — pass the request so a mismatched replay throws LOUD.
        return this.loadExistingJournalResult(
          existingJournalId,
          request.tenantId,
          request,
          options.idempotencyKey,
        );
      }
    }

    // Retry the whole post on stale-version (optimistic lock failure) or
    // sequence collision. Two concurrent posts on the same account would
    // otherwise clobber each other; `postJournalAtomic` refuses the
    // stale CAS inside its single transaction and we re-read + recompute.
    //
    // Bounded retry — `LEDGER_CAS_MAX_ATTEMPTS` (default 16) handles
    // realistic contention. Each attempt sleeps with jitter to break
    // lockstep retries. Hitting the ceiling surfaces a hard error.
    const MAX_ATTEMPTS = Number(process.env.LEDGER_CAS_MAX_ATTEMPTS ?? '16') || 16;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.postJournalEntryAttempt(request, options);
      } catch (err) {
        if (err instanceof StaleAccountVersionError) {
          lastError = err;
          this.logger.warn('ledger: optimistic lock failure, retrying journal post', {
            accountId: err.accountId,
            tenantId: err.tenantId,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
          });
          // Tiny jittered yield so concurrent retries don't lockstep
          // and starve each other. Base 0.5ms × attempt; capped at 8ms.
          const backoffMs = Math.min(8, 0.5 * attempt) + Math.random();
          await new Promise<void>((resolve) =>
            setTimeout(resolve, backoffMs),
          );
          continue;
        }
        throw err;
      }
    }
    throw new Error(
      `Ledger CAS failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? 'unknown contention'}`,
    );
  }

  /**
   * Reconstruct a `JournalPostResult` for a previously-posted journal —
   * used to serve an idempotent replay (durability defect #2) without
   * re-posting. Returns the persisted entries and the CURRENT account
   * snapshots for the touched accounts.
   *
   * H3 — when `replayedRequest` is supplied, the persisted journal's legs
   * are compared to that request's recomputed legs BEFORE serving; a
   * divergence throws `IdempotencyMismatchError` (LOUD) instead of
   * returning a stale journal for a mismatched request. The
   * `idempotencyKey` is threaded only for the error message.
   */
  private async loadExistingJournalResult(
    journalId: string,
    tenantId: TenantId,
    replayedRequest?: CreateJournalEntryRequest,
    idempotencyKey?: string,
  ): Promise<JournalPostResult> {
    const entries = await this.ledgerRepository.findByJournalId(
      journalId,
      tenantId,
    );

    // H3 — defense-in-depth replay check. Reuse of one idempotency key
    // for a DIFFERENT transaction must fail loud, not silently return the
    // first journal. Compare order-independent leg signatures.
    if (replayedRequest !== undefined) {
      const existingSig = legSignature(
        entries.map((e) => ({
          accountId: String(e.accountId),
          direction: e.direction,
          type: e.type,
          amountMinorUnits: e.amount.amountMinorUnits,
          currency: e.amount.currency,
        })),
      );
      const incomingSig = legSignature(
        replayedRequest.lines.map((l) => ({
          accountId: String(l.accountId),
          direction: l.direction,
          type: l.type,
          amountMinorUnits: l.amount.amountMinorUnits,
          currency: l.amount.currency,
        })),
      );
      if (existingSig !== incomingSig) {
        this.logger.error(
          'ledger: idempotency-key REPLAY MISMATCH — refusing to serve stale journal',
          {
            tenantId,
            journalId,
            idempotencyKey,
          },
        );
        throw new IdempotencyMismatchError(
          idempotencyKey ?? '(unknown)',
          journalId,
          tenantId,
        );
      }
    }

    const accountIds = Array.from(new Set(entries.map((e) => e.accountId)));
    const updatedAccounts: Account[] = [];
    for (const accountId of accountIds) {
      const account = await this.accountRepository.findById(accountId, tenantId);
      if (account) {
        updatedAccounts.push(account);
      }
    }
    this.logger.info('Journal entry idempotent replay (no re-post)', {
      journalId,
      tenantId,
      entryCount: entries.length,
    });
    return {
      journalId,
      entries,
      updatedAccounts,
      idempotentReplay: true,
    };
  }

  private async postJournalEntryAttempt(
    request: CreateJournalEntryRequest,
    options: PostJournalOptions,
  ): Promise<JournalPostResult> {
    const journalId = createJournalId();
    const now = new Date();
    const entries: LedgerEntry[] = [];

    // H2 — same-account fold. A journal may have MORE THAN ONE line on the
    // same account (e.g. postCorrectionEntry / voidEntry both target
    // originalEntry.accountId). We must:
    //   (a) run that account's balance FORWARD through each of its lines
    //       (each entry's balanceAfter reflects the running balance, not a
    //       stale snapshot), AND
    //   (b) allocate a DISTINCT sequence number per line on that account
    //       (one shared MAX+1 would collide on (account_id,
    //       sequence_number)), AND
    //   (c) emit exactly ONE balance CAS per account from the COMPOSED
    //       final balance + the LAST entry's id.
    // The old code keyed an `accountUpdates` Map by accountId and did
    // `.set()` per line, so a second line on the same account OVERWROTE
    // the first → one CAS survived with one leg's balance → stored balance
    // != sum(entries). This per-account running state fixes that.
    interface AccountRunState {
      readonly account: Account;
      readonly currency: CurrencyCode;
      runningBalance: Money;
      nextSequence: number;
      lastEntryId: LedgerEntryId;
    }
    const runState: Map<AccountId, AccountRunState> = new Map();

    // Process each line in order — validate, advance the account's running
    // balance + sequence, build the entry (WITHOUT hash fields;
    // `postJournalAtomic` stamps the hash-chain inside the transaction so
    // prevHash reflects committed state). Lines on the same account are
    // processed in request order, preserving the per-account chain order.
    for (const line of request.lines) {
      let state = runState.get(line.accountId);
      if (state === undefined) {
        const account = await this.accountRepository.findById(
          line.accountId,
          request.tenantId,
        );
        if (!account) {
          throw new Error(`Account ${line.accountId} not found`);
        }

        const accountAggregate = new AccountAggregate(account);
        if (!accountAggregate.canTransact()) {
          throw new Error(`Account ${line.accountId} is not active`);
        }

        // Seed the per-account running state from the current row: the
        // first sequence number is MAX+1; subsequent lines on this account
        // increment from there within this post.
        const sequenceNumber = await this.ledgerRepository.getNextSequenceNumber(
          line.accountId,
          request.tenantId,
        );
        state = {
          account,
          currency: account.currency,
          runningBalance: Money.fromMinorUnits(
            account.balanceMinorUnits,
            account.currency,
          ),
          nextSequence: sequenceNumber,
          lastEntryId: (account.lastEntryId ?? '') as LedgerEntryId,
        };
        runState.set(line.accountId, state);
      }

      // Currency check (against the account's currency).
      if (line.amount.currency !== state.currency) {
        throw new Error(
          `Currency mismatch: account ${line.accountId} is ${state.currency}, ` +
          `but entry is ${line.amount.currency}`
        );
      }

      // Advance the running balance through THIS line.
      const newBalance =
        line.direction === 'DEBIT'
          ? state.runningBalance.add(line.amount)
          : state.runningBalance.subtract(line.amount);

      const sequenceNumber = state.nextSequence;
      const entryId = createId<LedgerEntryId>(`le_${uuidv4()}`);
      const entry: LedgerEntry = omitUndefined({
        id: entryId,
        tenantId: request.tenantId,
        accountId: line.accountId,
        journalId,
        type: line.type,
        direction: line.direction,
        amount: line.amount,
        balanceAfter: newBalance,
        sequenceNumber,
        effectiveDate: request.effectiveDate,
        postedAt: now,
        paymentIntentId: request.paymentIntentId,
        leaseId: line.leaseId,
        propertyId: line.propertyId,
        unitId: line.unitId,
        description: line.description,
        metadata: line.metadata,
        createdAt: now,
        createdBy: request.createdBy,
        updatedAt: now,
        updatedBy: request.createdBy
      }) as LedgerEntry;

      entries.push(entry);

      // Fold: advance the account's running state for any later line on it.
      state.runningBalance = newBalance;
      state.nextSequence = sequenceNumber + 1;
      state.lastEntryId = entryId;
    }

    // Durability defect #1 — ATOMICITY (the core fix). Hand the balance
    // CAS writes AND the entry inserts to `postJournalAtomic`, which
    // commits them inside ONE transaction. Previously these were two
    // separate transactions (`updateBalancesAtomic` then `createEntries`)
    // — a crash between them left entry_count/balance bumped with NO
    // matching entries, a permanent balance != sum(entries). Now either
    // both land or neither does.
    //
    // `entry_count` doubles as the optimistic-lock version (`expectedVersion`):
    // every successful balance mutation bumps it by 1, so a stale post
    // rolls the whole transaction back ⇒ `stale` ⇒ retry off fresh rows.
    // The documented (account_id, sequence_number) unique-constraint
    // collision likewise rolls BOTH back.
    //
    // H2 — exactly ONE CAS per account, carrying that account's COMPOSED
    // final running balance (after ALL its lines folded) and its LAST
    // entry id. `expectedVersion` is the account's entryCount read once at
    // seed time; the CAS bumps it by 1 regardless of how many lines this
    // post wrote to the account, matching the per-account row-version
    // contract (one journal post ⇒ one version bump per touched account).
    const balanceUpdates = Array.from(runState.entries()).map(
      ([accountId, state]) => ({
        accountId,
        tenantId: request.tenantId,
        newBalanceMinorUnits: state.runningBalance.amountMinorUnits,
        lastEntryId: state.lastEntryId,
        expectedVersion: state.account.entryCount ?? 0,
      }),
    );

    const atomic = await this.ledgerRepository.postJournalAtomic(
      omitUndefined({
        tenantId: request.tenantId,
        journalId,
        entries,
        balanceUpdates,
        idempotencyKey: options.idempotencyKey,
      }) as Parameters<typeof this.ledgerRepository.postJournalAtomic>[0],
    );

    // Durability defect #2 — a concurrent first-time post under the same
    // idempotency key won the race; serve its journal instead of ours.
    // H3 — pass the request so a mismatched concurrent replay throws LOUD
    // rather than silently serving the winner's (different) journal.
    if (atomic.status === 'duplicate') {
      return this.loadExistingJournalResult(
        atomic.existingJournalId,
        request.tenantId,
        request,
        options.idempotencyKey,
      );
    }

    // Stale CAS / sequence collision — nothing was written. Bubble up so
    // the retry wrapper re-reads + recomputes against the fresh rows.
    if (atomic.status === 'stale') {
      throw new StaleAccountVersionError(
        atomic.conflictAccountId,
        request.tenantId,
      );
    }

    const savedEntries = atomic.entries;

    // Reflect the successful CAS onto the in-memory aggregates so the
    // publisher and the returned `updatedAccounts` carry the new
    // balance and version. We never re-read the DB row — the atomic
    // commit guaranteed the write landed.
    //
    // H2 — iterate `runState` (one entry per TOUCHED account), so an
    // account written by two lines in this journal still produces exactly
    // ONE updated-account snapshot and ONE event carrying its COMPOSED
    // final balance. `previousBalance` is the seed (pre-post) balance.
    const updatedAccounts: Account[] = [];
    for (const [accountId, state] of runState) {
      const accountAggregate = new AccountAggregate(state.account);
      accountAggregate.updateBalance(state.runningBalance, state.lastEntryId);
      const updatedAccount = accountAggregate.toData();
      updatedAccounts.push(updatedAccount);

      // Publish balance update event
      await this.eventPublisher.publish(
        createEvent<AccountBalanceUpdatedEvent>(
          'ACCOUNT_BALANCE_UPDATED',
          'Account',
          accountId,
          request.tenantId,
          {
            previousBalance: Money.fromMinorUnits(
              state.account.balanceMinorUnits,
              state.currency
            ).toData(),
            newBalance: state.runningBalance.toData(),
            lastEntryId: state.lastEntryId
          }
        )
      );
    }

    // Publish journal entries created event
    await this.eventPublisher.publish(
      createEvent<LedgerEntriesCreatedEvent>(
        'LEDGER_ENTRIES_CREATED',
        'Ledger',
        journalId,
        request.tenantId,
        omitUndefined({
          journalId,
          entries: savedEntries.map(e => ({
            entryId: e.id,
            accountId: e.accountId,
            type: e.type,
            direction: e.direction,
            amount: e.amount.toData()
          })),
          paymentIntentId: request.paymentIntentId
        }) as LedgerEntriesCreatedEvent['payload']
      )
    );

    this.logger.info('Journal entry posted', {
      journalId,
      tenantId: request.tenantId,
      entryCount: savedEntries.length
    });

    return {
      journalId,
      entries: savedEntries,
      updatedAccounts
    };
  }

  /**
   * Get account balance
   */
  async getAccountBalance(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<Money | null> {
    const account = await this.accountRepository.findById(accountId, tenantId);
    if (!account) {
      return null;
    }
    return Money.fromMinorUnits(account.balanceMinorUnits, account.currency);
  }

  /**
   * Get account balance at a specific date (calculated from entries)
   */
  async getAccountBalanceAsOf(
    accountId: AccountId,
    tenantId: TenantId,
    asOfDate: Date
  ): Promise<AccountBalance | null> {
    return this.ledgerRepository.calculateAccountBalance(accountId, tenantId, asOfDate);
  }

  /**
   * Get ledger entries for an account
   */
  async getAccountEntries(
    accountId: AccountId,
    tenantId: TenantId,
    page?: number,
    pageSize?: number
  ) {
    return this.ledgerRepository.findByAccount(accountId, tenantId, page, pageSize);
  }

  /**
   * Get entries by journal ID
   */
  async getJournalEntries(journalId: string, tenantId: TenantId): Promise<LedgerEntry[]> {
    return this.ledgerRepository.findByJournalId(journalId, tenantId);
  }

  /**
   * Verify ledger integrity for an account
   */
  async verifyAccountIntegrity(
    accountId: AccountId,
    tenantId: TenantId
  ): Promise<{ valid: boolean; calculatedBalance: Money | null; storedBalance: Money | null; discrepancy: Money | null }> {
    // Get stored balance
    const account = await this.accountRepository.findById(accountId, tenantId);
    if (!account) {
      return { valid: false, calculatedBalance: null, storedBalance: null, discrepancy: null };
    }
    const storedBalance = Money.fromMinorUnits(account.balanceMinorUnits, account.currency);

    // Calculate balance from entries
    const calculatedResult = await this.ledgerRepository.calculateAccountBalance(accountId, tenantId);
    if (!calculatedResult) {
      // No entries - balance should be zero
      const valid = storedBalance.isZero();
      return {
        valid,
        calculatedBalance: Money.zero(account.currency),
        storedBalance,
        discrepancy: valid ? null : storedBalance
      };
    }

    const calculatedBalance = Money.fromMinorUnits(calculatedResult.balance, account.currency);
    const valid = calculatedBalance.equals(storedBalance);

    return {
      valid,
      calculatedBalance,
      storedBalance,
      discrepancy: valid ? null : storedBalance.subtract(calculatedBalance)
    };
  }

  /**
   * Verify sequence integrity (no gaps or duplicates)
   */
  async verifySequenceIntegrity(
    accountId: AccountId,
    tenantId: TenantId
  ) {
    return this.ledgerRepository.verifyIntegrity(accountId, tenantId);
  }

  /**
   * Verify the per-account hash-chain (durability defect #3 —
   * tamper-evidence). Pulls every entry for the account in ascending
   * sequence order and recomputes the chain. Returns the first broken
   * entry (with expected vs actual hash) or `{ ok: true }` when intact.
   *
   * Any post-hoc mutation of a posted entry's financial substance
   * (amount, direction, balanceAfter, sequence, dates, linkage) breaks
   * the recomputed `thisHash`, and re-stamping that entry breaks the
   * NEXT entry's `prevHash` — so a tamper is detectable even if the
   * attacker recomputes the single row they edited.
   */
  async verifyHashChainForAccount(
    accountId: AccountId,
    tenantId: TenantId,
  ): Promise<HashChainVerification> {
    // Pull all entries in ascending sequence (persistence order). This
    // is a verification path, not a hot read.
    const result = await this.ledgerRepository.findByAccount(
      accountId,
      tenantId,
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const ordered = [...result.entries].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    );
    const verification = verifyHashChain(ordered);
    if (!verification.ok) {
      this.logger.warn('ledger: hash-chain verification FAILED', {
        accountId,
        tenantId,
        badEntryId: verification.badEntryId,
        reason: verification.reason,
      });
    }
    return verification;
  }

  /**
   * Get entries for statement generation
   */
  async getEntriesForStatement(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<LedgerEntry[]> {
    return this.ledgerRepository.findForStatement(accountId, tenantId, fromDate, toDate);
  }

  /**
   * Get totals by entry type for a period
   */
  async getTotalsByType(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ) {
    return this.ledgerRepository.getTotalsByType(accountId, tenantId, fromDate, toDate);
  }

  /**
   * Get account statement for a period
   * Returns a structured statement with opening/closing balances and all entries
   */
  async getStatement(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<{
    accountId: AccountId;
    periodStart: Date;
    periodEnd: Date;
    openingBalance: Money;
    closingBalance: Money;
    totalDebits: Money;
    totalCredits: Money;
    entries: LedgerEntry[];
    currency: CurrencyCode;
  }> {
    // Get account for currency
    const account = await this.accountRepository.findById(accountId, tenantId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Calculate opening balance (balance as of instant before period start).
    // Use UTC arithmetic — getDate/setHours depend on the server's local
    // timezone and silently shift the boundary when not at UTC. The
    // "1 ms before fromDate" instant is timezone-invariant.
    const openingBalanceDate = new Date(fromDate.getTime() - 1);

    const openingBalanceResult = await this.ledgerRepository.calculateAccountBalance(
      accountId,
      tenantId,
      openingBalanceDate
    );
    const openingBalance = openingBalanceResult
      ? Money.fromMinorUnits(openingBalanceResult.balance, account.currency)
      : Money.zero(account.currency);

    // Get entries for the period
    const entries = await this.ledgerRepository.findForStatement(
      accountId,
      tenantId,
      fromDate,
      toDate
    );

    // Calculate totals
    let totalDebitsMinor = 0;
    let totalCreditsMinor = 0;

    for (const entry of entries) {
      if (entry.direction === 'DEBIT') {
        totalDebitsMinor += entry.amount.amountMinorUnits;
      } else {
        totalCreditsMinor += entry.amount.amountMinorUnits;
      }
    }

    // Calculate closing balance
    const closingBalance = openingBalance
      .add(Money.fromMinorUnits(totalDebitsMinor, account.currency))
      .subtract(Money.fromMinorUnits(totalCreditsMinor, account.currency));

    return {
      accountId,
      periodStart: fromDate,
      periodEnd: toDate,
      openingBalance,
      closingBalance,
      totalDebits: Money.fromMinorUnits(totalDebitsMinor, account.currency),
      totalCredits: Money.fromMinorUnits(totalCreditsMinor, account.currency),
      entries,
      currency: account.currency,
    };
  }

  /**
   * Post a correction entry (immutable - reverses original and creates new entry)
   * This maintains the immutability principle by never modifying existing entries
   */
  async postCorrectionEntry(
    originalEntryId: LedgerEntryId,
    tenantId: TenantId,
    correctionReason: string,
    correctedAmount: Money,
    createdBy: string
  ): Promise<JournalPostResult> {
    // Get original entry
    const originalEntry = await this.ledgerRepository.findById(originalEntryId, tenantId);
    if (!originalEntry) {
      throw new Error(`Original entry ${originalEntryId} not found`);
    }

    // Validate currencies match
    if (correctedAmount.currency !== originalEntry.amount.currency) {
      throw new Error(
        `Currency mismatch: original is ${originalEntry.amount.currency}, correction is ${correctedAmount.currency}`
      );
    }

    const now = new Date();
    const journalId = createJournalId();

    // Create reversal entry (opposite direction of original)
    const reversalDirection = originalEntry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';

    // Create correcting entry (same direction as original with corrected amount)
    const correctionEntries: CreateJournalEntryRequest = omitUndefined({
      tenantId,
      effectiveDate: now,
      lines: [
        // Reversal of original
        omitUndefined({
          accountId: originalEntry.accountId,
          // CORRECTION isn't in @borjie/domain-models' narrower
          // LedgerEntryType union (only the canonical trial-balance
          // categories are there). The local LedgerEntryType (./types.ts)
          // extends it with CORRECTION for void/correction semantics —
          // cast through the narrower union to bridge until the domain
          // type is widened upstream.
          type: 'CORRECTION' as unknown as JournalEntryLine['type'],
          direction: reversalDirection,
          amount: originalEntry.amount,
          description: `Reversal: ${correctionReason}`,
          leaseId: originalEntry.leaseId,
          propertyId: originalEntry.propertyId,
          unitId: originalEntry.unitId,
          metadata: { originalEntryId, correctionType: 'REVERSAL' },
        }) as JournalEntryLine,
        // New corrected entry
        omitUndefined({
          accountId: originalEntry.accountId,
          type: originalEntry.type,
          direction: originalEntry.direction,
          amount: correctedAmount,
          description: `Correction: ${correctionReason}`,
          leaseId: originalEntry.leaseId,
          propertyId: originalEntry.propertyId,
          unitId: originalEntry.unitId,
          metadata: { originalEntryId, correctionType: 'CORRECTED' },
        }) as JournalEntryLine,
      ],
      paymentIntentId: originalEntry.paymentIntentId,
      createdBy,
    }) as CreateJournalEntryRequest;

    this.logger.info('Posting correction entry', {
      originalEntryId,
      tenantId,
      originalAmount: originalEntry.amount.toString(),
      correctedAmount: correctedAmount.toString(),
      reason: correctionReason,
    });

    return this.postJournalEntry(correctionEntries);
  }

  /**
   * Void an entry by posting a full reversal
   * This maintains immutability - the original entry remains, a reversal is added
   */
  async voidEntry(
    entryId: LedgerEntryId,
    tenantId: TenantId,
    voidReason: string,
    createdBy: string
  ): Promise<JournalPostResult> {
    const entry = await this.ledgerRepository.findById(entryId, tenantId);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found`);
    }

    const reversalDirection = entry.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';

    const voidRequest: CreateJournalEntryRequest = {
      tenantId,
      effectiveDate: new Date(),
      lines: [
        omitUndefined({
          accountId: entry.accountId,
          // CORRECTION isn't in @borjie/domain-models' narrower
          // LedgerEntryType union (only the canonical trial-balance
          // categories are there). The local LedgerEntryType (./types.ts)
          // extends it with CORRECTION for void/correction semantics —
          // cast through the narrower union to bridge until the domain
          // type is widened upstream.
          type: 'CORRECTION' as unknown as JournalEntryLine['type'],
          direction: reversalDirection,
          amount: entry.amount,
          description: `Void: ${voidReason}`,
          leaseId: entry.leaseId,
          propertyId: entry.propertyId,
          unitId: entry.unitId,
          metadata: { voidedEntryId: entryId, voidReason },
        }) as JournalEntryLine,
      ],
      createdBy,
    };

    this.logger.info('Voiding ledger entry', {
      entryId,
      tenantId,
      amount: entry.amount.toString(),
      reason: voidReason,
    });

    return this.postJournalEntry(voidRequest);
  }

  /**
   * Get running balance history for an account
   */
  async getBalanceHistory(
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ): Promise<Array<{ date: Date; balance: Money; entryId: LedgerEntryId }>> {
    const entries = await this.ledgerRepository.findForStatement(
      accountId,
      tenantId,
      fromDate,
      toDate
    );

    return entries.map(entry => ({
      date: entry.effectiveDate,
      balance: entry.balanceAfter,
      entryId: entry.id,
    }));
  }
}
