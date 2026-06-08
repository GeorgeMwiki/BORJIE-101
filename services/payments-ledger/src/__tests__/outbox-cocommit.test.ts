/**
 * RSS-01 — the transactional outbox PRODUCER must co-commit with the
 * ledger write.
 *
 * Before this fix, `LedgerService.postJournalEntry` published its domain
 * events through `InMemoryEventPublisher` AFTER `postJournalAtomic`
 * returned — i.e. AFTER the ledger transaction had already committed. A
 * crash in that window left the entries + balances durable but no
 * PAYMENT/ledger event ever emitted: the exact failure the outbox pattern
 * exists to kill.
 *
 * The fix serialises the events to `NewOutboxRow[]` BEFORE the atomic post
 * and hands them into `postJournalAtomic`, which writes the `event_outbox`
 * rows INSIDE the same transaction as the entries + balance CAS. Borjie's
 * repo OWNS the transaction (unlike the BN service-owns-tx port), so the
 * InMemory repo stages the rows in the SAME snapshot/rollback guard as the
 * money writes — a rollback un-stages them. In-process `notifySubscribers`
 * stays post-commit so live subscribers still fire.
 *
 * These tests pin:
 *   1. Co-commit (in-memory): a successful post stages the producer's
 *      events (LEDGER_ENTRIES_CREATED + 2× ACCOUNT_BALANCE_UPDATED), each
 *      stamped with `metadata.journalId`.
 *   2. No-loss / no-leak on crash: a fault between balances and entries
 *      rolls back the entries, the balances, AND the outbox rows together.
 *   3. Idempotent replay emits no duplicate outbox rows.
 *   4. Post-commit notify still fires for a successful post; a rolled-back
 *      post notifies nobody.
 *   5. The money math is unchanged (balances/entry counts identical to the
 *      pre-outbox behaviour for the same journal).
 *   6. Factory selection (durable vs in-memory vs fail-loud-in-prod).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Money,
  createCustomerLiabilityAccount,
  createPlatformHoldingAccount,
  type AccountId,
  type CreateJournalEntryRequest,
  type CustomerId,
  type TenantId,
} from '@borjie/domain-models';
import { LedgerService } from '../services/ledger.service';
import { InMemoryAccountRepository } from '../repositories/account.repository';
import { InMemoryLedgerRepository } from '../repositories/ledger.repository';
import {
  DurableEventPublisher,
  InMemoryEventPublisher,
  type IOutboxRepository,
  type OutboxEntry,
} from '../events/event-publisher';
import { createEventPublisher } from '../events/event-publisher-factory';
import type { LedgerEntriesCreatedEvent } from '../events/payment-events';

const TENANT = 'tnt_cocommit' as TenantId;
const CUR = 'TZS' as const;
const CUSTOMER = 'cust_cc' as CustomerId;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const HOLDING = 'acc_holding_cc' as AccountId;
const LIABILITY = 'acc_liability_cc' as AccountId;

async function seed() {
  const accountRepo = new InMemoryAccountRepository();
  await accountRepo.create(
    createPlatformHoldingAccount(HOLDING, TENANT, CUR, 'system'),
  );
  await accountRepo.create(
    createCustomerLiabilityAccount(LIABILITY, TENANT, CUSTOMER, CUR, 'system'),
  );
  return accountRepo;
}

function paymentJournal(amountMinor: number): CreateJournalEntryRequest {
  const amount = Money.fromMinorUnits(amountMinor, CUR);
  return {
    tenantId: TENANT,
    effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
    createdBy: 'system',
    lines: [
      {
        accountId: LIABILITY,
        type: 'PAYMENT',
        direction: 'CREDIT',
        amount,
        description: 'pay',
      },
      {
        accountId: HOLDING,
        type: 'PAYMENT',
        direction: 'DEBIT',
        amount,
        description: 'recv',
      },
    ],
  } as CreateJournalEntryRequest;
}

/**
 * A fake `IOutboxRepository` that records the rows handed to `addToOutbox`.
 * Used only to construct a `DurableEventPublisher` whose `serializeForTx`
 * we exercise; the co-commit itself is verified through the InMemory ledger
 * repo's `getCommittedOutboxRows()`, NOT through this fake (the durable
 * publisher's `serializeForTx` never calls `addToOutbox`).
 */
function makeFakeOutbox(): IOutboxRepository & { rows: OutboxEntry[] } {
  const rows: OutboxEntry[] = [];
  return {
    rows,
    async addToOutbox(entries: OutboxEntry[]) {
      rows.push(...entries);
    },
    async getUnpublished(limit: number) {
      return rows.filter((r) => !r.publishedAt).slice(0, limit);
    },
    async markPublished(id: string) {
      const r = rows.find((x) => x.id === id);
      if (r) r.publishedAt = new Date();
    },
    async recordFailure(id: string, error: string) {
      const r = rows.find((x) => x.id === id);
      if (r) {
        r.retryCount += 1;
        r.lastError = error;
      }
    },
    async cleanup() {
      return 0;
    },
  };
}

describe('LedgerService outbox co-commit (RSS-01)', () => {
  let accountRepo: InMemoryAccountRepository;
  let ledgerRepo: InMemoryLedgerRepository;

  beforeEach(async () => {
    accountRepo = await seed();
    ledgerRepo = new InMemoryLedgerRepository();
  });

  function buildService(
    publisher: DurableEventPublisher | InMemoryEventPublisher,
  ): LedgerService {
    return new LedgerService({
      ledgerRepository: ledgerRepo,
      accountRepository: accountRepo,
      eventPublisher: publisher,
      logger: silentLogger,
    });
  }

  it('stages the producer events INSIDE the ledger atomic unit (co-commit)', async () => {
    const publisher = new DurableEventPublisher(makeFakeOutbox());
    const service = buildService(publisher);

    await service.postJournalEntry(paymentJournal(12_000));

    const committed = ledgerRepo.getCommittedOutboxRows();
    const types = committed.map((r) => r.eventType).sort();
    // 2 accounts touched → 2 ACCOUNT_BALANCE_UPDATED + 1 LEDGER_ENTRIES_CREATED.
    expect(committed.length).toBe(3);
    expect(types).toContain('LEDGER_ENTRIES_CREATED');
    expect(types.filter((t) => t === 'ACCOUNT_BALANCE_UPDATED')).toHaveLength(
      2,
    );
    // Every money-path row carries metadata.journalId for correlation.
    for (const row of committed) {
      expect(row.metadata).toMatchObject({ journalId: expect.any(String) });
      expect(row.tenantId).toBe(String(TENANT));
    }
  });

  it('rolls the outbox rows back WITH the money write on a crash (no half-write)', async () => {
    const publisher = new DurableEventPublisher(makeFakeOutbox());
    const service = buildService(publisher);

    // Land one good post so there is prior state to protect.
    await service.postJournalEntry(paymentJournal(5_000));
    const rowsAfterGood = ledgerRepo.getCommittedOutboxRows().length;
    const holdingBefore = await accountRepo.findById(HOLDING, TENANT);
    const liabilityBefore = await accountRepo.findById(LIABILITY, TENANT);

    // Inject a crash AFTER balances move but BEFORE entries land.
    ledgerRepo.setFaultBetweenBalanceAndEntries(() => {
      throw new Error('simulated crash between balance and entries');
    });

    await expect(service.postJournalEntry(paymentJournal(9_000))).rejects.toThrow(
      /simulated crash between balance and entries/,
    );

    ledgerRepo.setFaultBetweenBalanceAndEntries(null);

    // Outbox rows: NONE added by the failed post (rolled back together).
    expect(ledgerRepo.getCommittedOutboxRows()).toHaveLength(rowsAfterGood);
    // Money: balances + entry counts unchanged by the failed post.
    const holdingAfter = await accountRepo.findById(HOLDING, TENANT);
    const liabilityAfter = await accountRepo.findById(LIABILITY, TENANT);
    expect(holdingAfter?.balanceMinorUnits).toBe(
      holdingBefore?.balanceMinorUnits,
    );
    expect(holdingAfter?.entryCount).toBe(holdingBefore?.entryCount);
    expect(liabilityAfter?.balanceMinorUnits).toBe(
      liabilityBefore?.balanceMinorUnits,
    );
    expect(liabilityAfter?.entryCount).toBe(liabilityBefore?.entryCount);
    // And no ledger entries leaked for the failed journal.
    const allEntries = await ledgerRepo.findByAccount(HOLDING, TENANT, 1, 1000);
    expect(allEntries.entries).toHaveLength(1); // only the good post
  });

  it('emits NO duplicate outbox rows on an idempotent replay', async () => {
    const publisher = new DurableEventPublisher(makeFakeOutbox());
    const service = buildService(publisher);

    const first = await service.postJournalEntry(paymentJournal(7_000), {
      idempotencyKey: 'k-dup-1',
    });
    const afterFirst = ledgerRepo.getCommittedOutboxRows().length;
    expect(afterFirst).toBe(3);

    const replay = await service.postJournalEntry(paymentJournal(7_000), {
      idempotencyKey: 'k-dup-1',
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.journalId).toBe(first.journalId);
    // The replay re-posted nothing → outbox row count unchanged.
    expect(ledgerRepo.getCommittedOutboxRows()).toHaveLength(afterFirst);
  });

  it('notifies in-process subscribers AFTER commit; a rolled-back post notifies nobody', async () => {
    const publisher = new DurableEventPublisher(makeFakeOutbox());
    const seen: string[] = [];
    publisher.subscribe<LedgerEntriesCreatedEvent>(
      'LEDGER_ENTRIES_CREATED',
      async (e) => {
        seen.push(e.eventType);
      },
    );
    const service = buildService(publisher);

    await service.postJournalEntry(paymentJournal(5_000));
    expect(seen).toContain('LEDGER_ENTRIES_CREATED');

    // A rolled-back post must NOT notify.
    seen.length = 0;
    ledgerRepo.setFaultBetweenBalanceAndEntries(() => {
      throw new Error('boom');
    });
    await expect(
      service.postJournalEntry(paymentJournal(3_000)),
    ).rejects.toThrow(/boom/);
    ledgerRepo.setFaultBetweenBalanceAndEntries(null);
    expect(seen).toHaveLength(0);
  });

  it('money math is unchanged by the dual-write (balances + sum(entries))', async () => {
    const publisher = new DurableEventPublisher(makeFakeOutbox());
    const service = buildService(publisher);

    await service.postJournalEntry(paymentJournal(10_000));
    await service.postJournalEntry(paymentJournal(2_500));

    const holding = await accountRepo.findById(HOLDING, TENANT);
    const liability = await accountRepo.findById(LIABILITY, TENANT);
    // Holding is DEBITed both posts → +12_500; liability CREDITed → -12_500.
    expect(holding?.balanceMinorUnits).toBe(12_500);
    expect(liability?.balanceMinorUnits).toBe(-12_500);
    expect(holding?.entryCount).toBe(2);
    expect(liability?.entryCount).toBe(2);

    // Stored balance equals sum(entries) for each account.
    const holdingCalc = await ledgerRepo.calculateAccountBalance(
      HOLDING,
      TENANT,
    );
    expect(holdingCalc?.balance).toBe(holding?.balanceMinorUnits);
  });
});

describe('createEventPublisher factory (RSS-01)', () => {
  it('throws when no DB in production (fail-loud — in-memory drops events)', () => {
    expect(() =>
      createEventPublisher({
        db: null,
        isProduction: true,
        logger: { warn: () => undefined, info: () => undefined },
      }),
    ).toThrow(/Cannot start payments-ledger/);
  });

  it('returns the in-memory publisher in dev/test when no DB', () => {
    const publisher = createEventPublisher({
      db: null,
      isProduction: false,
      logger: { warn: () => undefined, info: () => undefined },
    });
    expect(publisher).toBeInstanceOf(InMemoryEventPublisher);
  });

  it('returns a durable publisher when a DB client is present', () => {
    // A minimal stand-in for DatabaseClient — the factory only stores it.
    const fakeDb = {} as never;
    const publisher = createEventPublisher({
      db: fakeDb,
      isProduction: true,
      logger: { warn: () => undefined, info: () => undefined },
    });
    expect(publisher).toBeInstanceOf(DurableEventPublisher);
  });
});

describe('InMemoryEventPublisher co-commit surface (RSS-01)', () => {
  it('serializeForTx produces rows and notifySubscribers fires handlers', async () => {
    const accountRepo = await seed();
    const ledgerRepo = new InMemoryLedgerRepository();
    const publisher = new InMemoryEventPublisher();
    const seen: string[] = [];
    publisher.subscribe<LedgerEntriesCreatedEvent>(
      'LEDGER_ENTRIES_CREATED',
      async (e) => {
        seen.push(e.eventType);
      },
    );
    const service = new LedgerService({
      ledgerRepository: ledgerRepo,
      accountRepository: accountRepo,
      eventPublisher: publisher,
      logger: silentLogger,
    });

    await service.postJournalEntry(paymentJournal(4_000));

    // The in-memory publisher staged rows through the SAME LedgerService
    // code path (serializeForTx → co-commit → notifySubscribers).
    expect(ledgerRepo.getCommittedOutboxRows().length).toBe(3);
    expect(seen).toContain('LEDGER_ENTRIES_CREATED');
  });
});
