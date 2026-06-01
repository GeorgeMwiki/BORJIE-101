/**
 * Ledger durability tests — money-audit closure.
 *
 * Pins the three durability defects fixed in the double-entry ledger:
 *
 *   #1 ATOMICITY  — a forced failure BETWEEN the balance writes and the
 *      entry inserts rolls BOTH back. There is never an orphan balance
 *      (entry_count/balance bumped with no matching entries), and the
 *      stored balance always equals sum(entries).
 *
 *   #2 IDEMPOTENCY — a retried post under the same idempotency key
 *      returns the ORIGINAL journal and posts nothing a second time.
 *
 *   #3 HASH-CHAIN — every entry links prevHash→thisHash per account; a
 *      post-hoc tamper (even with the single edited row re-hashed) is
 *      detectable by `verifyHashChainForAccount`.
 */

import { describe, it, expect } from 'vitest';
import {
  type AccountId,
  type CustomerId,
  type TenantId,
  createCustomerLiabilityAccount,
  Money,
  type CreateJournalEntryRequest,
} from '@borjie/domain-models';
import { LedgerService, IdempotencyMismatchError } from '../services/ledger.service';
import {
  InMemoryLedgerRepository,
  type ILedgerRepository,
} from '../repositories/ledger.repository';
import { InMemoryAccountRepository } from '../repositories/account.repository';
import { InMemoryEventPublisher } from '../events/event-publisher';
import {
  computeEntryHash,
  verifyHashChain,
  GENESIS_HASH,
} from '../services/ledger-hash-chain';

const TENANT = 'tenant-dur-1' as TenantId;
const CUSTOMER = 'cust-dur-1' as CustomerId;
const ACCOUNT_A = 'acct-dur-A' as AccountId;
const ACCOUNT_B = 'acct-dur-B' as AccountId;

function silentLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function buildService() {
  const accountRepo = new InMemoryAccountRepository();
  const ledgerRepo = new InMemoryLedgerRepository();
  const eventPublisher = new InMemoryEventPublisher();
  // The LedgerService constructor duck-types the in-memory wiring
  // (attachAccountStore), so we exercise the same path production does.
  const ledger = new LedgerService({
    ledgerRepository: ledgerRepo,
    accountRepository: accountRepo,
    eventPublisher,
    logger: silentLogger(),
  });
  await accountRepo.create(
    createCustomerLiabilityAccount(ACCOUNT_A, TENANT, CUSTOMER, 'KES', 'dur'),
  );
  await accountRepo.create(
    createCustomerLiabilityAccount(ACCOUNT_B, TENANT, CUSTOMER, 'KES', 'dur'),
  );
  return { ledger, accountRepo, ledgerRepo };
}

function debitCreditRequest(
  amountMinor: number,
): CreateJournalEntryRequest {
  return {
    tenantId: TENANT,
    effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
    createdBy: 'dur-test',
    lines: [
      {
        accountId: ACCOUNT_A,
        type: 'PAYMENT',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(amountMinor, 'KES'),
        description: 'dur debit',
      },
      {
        accountId: ACCOUNT_B,
        type: 'PAYMENT',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(amountMinor, 'KES'),
        description: 'dur credit',
      },
    ],
  } as CreateJournalEntryRequest;
}

// ────────────────────────────────────────────────────────────────────
// Defect #1 — atomicity: failure between balance + entries rolls back both
// ────────────────────────────────────────────────────────────────────

describe('ledger durability #1 — single transaction (atomicity)', () => {
  it('a fault BETWEEN balance writes and entry inserts rolls back BOTH (no orphan balance)', async () => {
    const { ledger, accountRepo, ledgerRepo } = await buildService();

    // Land one good post so there is non-zero prior state to protect.
    await ledger.postJournalEntry(debitCreditRequest(100));
    const aBefore = await accountRepo.findById(ACCOUNT_A, TENANT);
    const bBefore = await accountRepo.findById(ACCOUNT_B, TENANT);
    expect(aBefore?.balanceMinorUnits).toBe(100);
    expect(aBefore?.entryCount).toBe(1);

    // Inject a crash AFTER balances move but BEFORE entries land.
    ledgerRepo.setFaultBetweenBalanceAndEntries(() => {
      throw new Error('simulated crash between balance and entries');
    });

    await expect(ledger.postJournalEntry(debitCreditRequest(250))).rejects.toThrow(
      /simulated crash between balance and entries/,
    );

    // Clear the fault so we can read consistent state.
    ledgerRepo.setFaultBetweenBalanceAndEntries(null);

    const aAfter = await accountRepo.findById(ACCOUNT_A, TENANT);
    const bAfter = await accountRepo.findById(ACCOUNT_B, TENANT);

    // Balance + entry_count must be EXACTLY what they were before the
    // failed post — the balance write was rolled back with the entries.
    expect(aAfter?.balanceMinorUnits).toBe(100);
    expect(bAfter?.balanceMinorUnits).toBe(-100);
    expect(aAfter?.entryCount).toBe(1);
    expect(bAfter?.entryCount).toBe(1);

    // The invariant that the bug violated: stored balance == sum(entries).
    const calcA = await ledgerRepo.calculateAccountBalance(ACCOUNT_A, TENANT);
    expect(calcA?.balance).toBe(aAfter?.balanceMinorUnits);

    // No orphan entries were written for the failed journal.
    const aEntries = await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    expect(aEntries.total).toBe(1);
  });

  it('after a rolled-back post, a subsequent good post still succeeds and stays balanced', async () => {
    const { ledger, accountRepo, ledgerRepo } = await buildService();
    ledgerRepo.setFaultBetweenBalanceAndEntries(() => {
      throw new Error('boom');
    });
    await expect(ledger.postJournalEntry(debitCreditRequest(500))).rejects.toThrow();
    ledgerRepo.setFaultBetweenBalanceAndEntries(null);

    await ledger.postJournalEntry(debitCreditRequest(300));
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    const b = await accountRepo.findById(ACCOUNT_B, TENANT);
    expect(a?.balanceMinorUnits).toBe(300);
    expect(b?.balanceMinorUnits).toBe(-300);
    expect(a?.entryCount).toBe(1);
    const calc = await ledgerRepo.calculateAccountBalance(ACCOUNT_A, TENANT);
    expect(calc?.balance).toBe(300);
  });
});

// ────────────────────────────────────────────────────────────────────
// Defect #2 — idempotency: duplicate key returns the existing journal
// ────────────────────────────────────────────────────────────────────

describe('ledger durability #2 — idempotency', () => {
  it('a retried post with the same idempotency key returns the existing journal (no double-post)', async () => {
    const { ledger, accountRepo, ledgerRepo } = await buildService();
    const key = 'idem-key-abc';

    const first = await ledger.postJournalEntry(debitCreditRequest(400), {
      idempotencyKey: key,
    });
    expect(first.idempotentReplay).toBeUndefined();

    const aAfterFirst = await accountRepo.findById(ACCOUNT_A, TENANT);
    expect(aAfterFirst?.balanceMinorUnits).toBe(400);
    expect(aAfterFirst?.entryCount).toBe(1);

    // Retry with the SAME key — must return the original journal and
    // post nothing a second time.
    const second = await ledger.postJournalEntry(debitCreditRequest(400), {
      idempotencyKey: key,
    });
    expect(second.idempotentReplay).toBe(true);
    expect(second.journalId).toBe(first.journalId);
    expect(second.entries.map((e) => e.id).sort()).toEqual(
      first.entries.map((e) => e.id).sort(),
    );

    // Balance + entry_count UNCHANGED — no second post happened.
    const aAfterSecond = await accountRepo.findById(ACCOUNT_A, TENANT);
    expect(aAfterSecond?.balanceMinorUnits).toBe(400);
    expect(aAfterSecond?.entryCount).toBe(1);
    const total = (await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100))
      .total;
    expect(total).toBe(1);
  });

  it('distinct idempotency keys post independently', async () => {
    const { ledger, accountRepo } = await buildService();
    await ledger.postJournalEntry(debitCreditRequest(100), {
      idempotencyKey: 'k1',
    });
    await ledger.postJournalEntry(debitCreditRequest(100), {
      idempotencyKey: 'k2',
    });
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    expect(a?.balanceMinorUnits).toBe(200);
    expect(a?.entryCount).toBe(2);
  });

  it('a post WITHOUT an idempotency key is never deduplicated', async () => {
    const { ledger, accountRepo } = await buildService();
    await ledger.postJournalEntry(debitCreditRequest(100));
    await ledger.postJournalEntry(debitCreditRequest(100));
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    expect(a?.balanceMinorUnits).toBe(200);
    expect(a?.entryCount).toBe(2);
  });

  it('a concurrent first-time race on one key still posts exactly once', async () => {
    const { ledger, accountRepo, ledgerRepo } = await buildService();
    const key = 'race-key';
    await Promise.all([
      ledger.postJournalEntry(debitCreditRequest(100), { idempotencyKey: key }),
      ledger.postJournalEntry(debitCreditRequest(100), { idempotencyKey: key }),
    ]);
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    // Exactly one post lands; the other is served as an idempotent replay.
    expect(a?.balanceMinorUnits).toBe(100);
    expect(a?.entryCount).toBe(1);
    expect((await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100)).total).toBe(
      1,
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// H3 — idempotency replay defense: a key reused for DIFFERENT legs fails
// ────────────────────────────────────────────────────────────────────
//
// The fast-path returned the prior journal for ANY matching key with no
// check that the replayed request matched. A caller reusing one key for a
// different transaction would silently get back the wrong money. The
// engine backstop now recomputes the legs and throws
// LEDGER_IDEMPOTENCY_MISMATCH on divergence.

describe('ledger durability H3 — idempotency replay mismatch', () => {
  it('reusing an idempotency key with a DIFFERENT amount throws LEDGER_IDEMPOTENCY_MISMATCH (no stale journal served)', async () => {
    const { ledger, accountRepo, ledgerRepo } = await buildService();
    const key = 'h3-key';

    await ledger.postJournalEntry(debitCreditRequest(400), {
      idempotencyKey: key,
    });

    // Same key, DIFFERENT amount — must throw loud, not serve the 400.
    await expect(
      ledger.postJournalEntry(debitCreditRequest(999), { idempotencyKey: key }),
    ).rejects.toThrow(IdempotencyMismatchError);

    // The original journal is untouched; nothing was double-posted.
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    expect(a?.balanceMinorUnits).toBe(400);
    expect(a?.entryCount).toBe(1);
    expect((await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100)).total).toBe(
      1,
    );
  });

  it('reusing an idempotency key with DIFFERENT accounts throws LEDGER_IDEMPOTENCY_MISMATCH', async () => {
    const { ledger } = await buildService();
    const key = 'h3-key-acct';

    // First post: A debit / B credit.
    await ledger.postJournalEntry(debitCreditRequest(100), {
      idempotencyKey: key,
    });

    // Replay with the legs swapped (B debit / A credit) — same amounts,
    // different account/direction mapping → mismatch.
    const swapped = {
      tenantId: TENANT,
      effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
      createdBy: 'h3-test',
      lines: [
        {
          accountId: ACCOUNT_B,
          type: 'PAYMENT',
          direction: 'DEBIT',
          amount: Money.fromMinorUnits(100, 'KES'),
          description: 'swapped debit',
        },
        {
          accountId: ACCOUNT_A,
          type: 'PAYMENT',
          direction: 'CREDIT',
          amount: Money.fromMinorUnits(100, 'KES'),
          description: 'swapped credit',
        },
      ],
    } as unknown as CreateJournalEntryRequest;

    await expect(
      ledger.postJournalEntry(swapped, { idempotencyKey: key }),
    ).rejects.toThrow(/LEDGER_IDEMPOTENCY_MISMATCH/);
  });

  it('replaying the IDENTICAL request under the same key still returns the original journal (no false positive)', async () => {
    const { ledger } = await buildService();
    const key = 'h3-key-identical';
    const first = await ledger.postJournalEntry(debitCreditRequest(250), {
      idempotencyKey: key,
    });
    // Byte-identical legs → the mismatch guard must NOT fire; the replay
    // is served as before.
    const replay = await ledger.postJournalEntry(debitCreditRequest(250), {
      idempotencyKey: key,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.journalId).toBe(first.journalId);
  });
});

// ────────────────────────────────────────────────────────────────────
// Defect #3 — hash-chain: links + tamper detection
// ────────────────────────────────────────────────────────────────────

describe('ledger durability #3 — hash-chain tamper evidence', () => {
  it('each entry links prevHash → thisHash per account, genesis first', async () => {
    const { ledger, ledgerRepo } = await buildService();
    await ledger.postJournalEntry(debitCreditRequest(100));
    await ledger.postJournalEntry(debitCreditRequest(200));
    await ledger.postJournalEntry(debitCreditRequest(300));

    const page = await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    const ordered = [...page.entries].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    ) as Array<(typeof page.entries)[number] & { prevHash?: string; thisHash?: string }>;

    expect(ordered).toHaveLength(3);
    // First entry chains from genesis.
    expect(ordered[0]!.prevHash).toBe(GENESIS_HASH);
    // Each entry's prevHash equals the prior entry's thisHash.
    expect(ordered[1]!.prevHash).toBe(ordered[0]!.thisHash);
    expect(ordered[2]!.prevHash).toBe(ordered[1]!.thisHash);
    // Hashes are non-empty sha256 hex (64 chars).
    for (const e of ordered) {
      expect(e.thisHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('an intact chain verifies; a tampered amount is detectable', async () => {
    const { ledger } = await buildService();
    await ledger.postJournalEntry(debitCreditRequest(100));
    await ledger.postJournalEntry(debitCreditRequest(200));

    // Intact chain verifies through the service path.
    const ok = await ledger.verifyHashChainForAccount(ACCOUNT_A, TENANT);
    expect(ok.ok).toBe(true);

    // Snapshot the persisted chain (the repo returns copies, so this
    // models the rows a regulator/cron would pull and recompute).
    const repo = (
      ledger as unknown as { ledgerRepository: ILedgerRepository }
    ).ledgerRepository;
    const page = await repo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    const ordered = [...page.entries].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    );

    // Tamper: forge the first entry's amount but KEEP its stored
    // thisHash — an attacker who edits the row but cannot recompute the
    // chain. `verifyHashChain` (the exact logic the service runs) must
    // reject: the recomputed hash diverges from the stored one.
    const target = {
      ...ordered[0]!,
      amount: Money.fromMinorUnits(999_999, 'KES'),
    } as (typeof ordered)[number];
    const tamperedChain = [target, ...ordered.slice(1)];

    const tampered = verifyHashChain(tamperedChain);
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.reason).toBe('this_hash_mismatch');
      expect(tampered.badEntryId).toBe(String(target.id));
    }
  });

  it('re-hashing the single tampered row still breaks the NEXT entry prevHash link', async () => {
    const { ledger } = await buildService();
    await ledger.postJournalEntry(debitCreditRequest(100));
    await ledger.postJournalEntry(debitCreditRequest(200));

    const repo = (
      ledger as unknown as { ledgerRepository: ILedgerRepository }
    ).ledgerRepository;
    const page = await repo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    const ordered = [...page.entries].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    ) as Array<
      (typeof page.entries)[number] & { prevHash?: string; thisHash?: string }
    >;

    // Attacker forges the first entry's amount AND recomputes that row's
    // OWN thisHash so the row is internally consistent.
    const forged = {
      ...ordered[0]!,
      amount: Money.fromMinorUnits(777, 'KES'),
    };
    forged.thisHash = computeEntryHash(forged.prevHash ?? GENESIS_HASH, forged);
    const tamperedChain = [forged, ...ordered.slice(1)];

    // The first row now self-verifies, but the SECOND row's prevHash no
    // longer matches the first's NEW thisHash — the chain is still broken.
    const result = verifyHashChain(tamperedChain);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('prev_hash_mismatch');
      expect(result.badEntryId).toBe(String(ordered[1]!.id));
    }
  });

  it('verifyHashChain is order-sensitive and deterministic (pure helper)', async () => {
    const { ledger } = await buildService();
    await ledger.postJournalEntry(debitCreditRequest(100));
    await ledger.postJournalEntry(debitCreditRequest(200));
    const repo = (
      ledger as unknown as { ledgerRepository: ILedgerRepository }
    ).ledgerRepository;
    const page = await repo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    const ordered = [...page.entries].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    );
    expect(verifyHashChain(ordered).ok).toBe(true);
    // Reversed order breaks the prev-hash linkage.
    expect(verifyHashChain([...ordered].reverse()).ok).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// H2 — same-account fold: two lines on ONE account in a single journal
// ────────────────────────────────────────────────────────────────────
//
// The bug: `accountUpdates` was a Map keyed by accountId and the per-line
// loop did `.set(line.accountId, …)`, so when TWO lines hit the SAME
// account (a DR and a CR — exactly what voidEntry / postCorrectionEntry
// emit, both targeting originalEntry.accountId) the second `.set`
// OVERWROTE the first → only one leg's balance survived → one CAS → the
// stored balance no longer equalled sum(entries). The fold runs the
// balance forward through every line on the account, allocates a DISTINCT
// sequence per line, and emits exactly ONE CAS from the composed final
// balance.

describe('ledger durability H2 — same-account journal fold', () => {
  function sameAccountBalancedRequest(
    debitMinor: number,
    creditMinor: number,
  ): CreateJournalEntryRequest {
    // BOTH lines target ACCOUNT_A. The journal is balanced only when the
    // two amounts are equal (debits == credits across the journal), which
    // is the canonical reversal/correction shape on one account.
    return {
      tenantId: TENANT,
      effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
      createdBy: 'h2-test',
      lines: [
        {
          accountId: ACCOUNT_A,
          type: 'PAYMENT',
          direction: 'DEBIT',
          amount: Money.fromMinorUnits(debitMinor, 'KES'),
          description: 'h2 same-account debit leg',
        },
        {
          accountId: ACCOUNT_A,
          type: 'CORRECTION',
          direction: 'CREDIT',
          amount: Money.fromMinorUnits(creditMinor, 'KES'),
          description: 'h2 same-account credit leg',
        },
      ],
    } as unknown as CreateJournalEntryRequest;
  }

  it('a 2-line SAME-account balanced journal posts: stored balance == sum(entries), entry_count/version correct', async () => {
    const { ledger, accountRepo, ledgerRepo } = await buildService();

    // DEBIT 500 + CREDIT 500 on ACCOUNT_A → net balance change 0, but TWO
    // entries, one version bump.
    const result = await ledger.postJournalEntry(
      sameAccountBalancedRequest(500, 500),
    );

    // BOTH legs persisted as distinct entries (the overwrite bug would
    // have lost one).
    const aEntries = await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    expect(aEntries.total).toBe(2);
    expect(result.entries).toHaveLength(2);

    // Distinct sequence numbers (a shared MAX+1 would collide).
    const seqs = aEntries.entries.map((e) => e.sequenceNumber).sort();
    expect(seqs).toEqual([1, 2]);

    // The core invariant: stored balance == sum(entries).
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    const calc = await ledgerRepo.calculateAccountBalance(ACCOUNT_A, TENANT);
    expect(a?.balanceMinorUnits).toBe(0); // +500 (DR) - 500 (CR)
    expect(calc?.balance).toBe(a?.balanceMinorUnits);

    // Exactly ONE version bump for the account despite two lines on it.
    expect(a?.entryCount).toBe(1);

    // Exactly ONE updated-account snapshot returned (folded), carrying the
    // composed balance.
    const aSnapshots = result.updatedAccounts.filter((u) => u.id === ACCOUNT_A);
    expect(aSnapshots).toHaveLength(1);
    expect(aSnapshots[0]!.balanceMinorUnits).toBe(0);
    expect(aSnapshots[0]!.entryCount).toBe(1);
  });

  it('the per-account running balance is correct entry-by-entry (balanceAfter folds forward)', async () => {
    const { ledger, ledgerRepo } = await buildService();
    await ledger.postJournalEntry(sameAccountBalancedRequest(500, 500));

    const aEntries = await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    const ordered = [...aEntries.entries].sort(
      (a, b) => a.sequenceNumber - b.sequenceNumber,
    );
    // Entry 1 is the DEBIT 500 → balanceAfter 500.
    expect(ordered[0]!.direction).toBe('DEBIT');
    expect(ordered[0]!.balanceAfter.amountMinorUnits).toBe(500);
    // Entry 2 is the CREDIT 500 applied to the running 500 → balanceAfter 0.
    expect(ordered[1]!.direction).toBe('CREDIT');
    expect(ordered[1]!.balanceAfter.amountMinorUnits).toBe(0);
  });

  it('the per-account hash-chain stays intact across the folded same-account legs', async () => {
    const { ledger } = await buildService();
    await ledger.postJournalEntry(sameAccountBalancedRequest(500, 500));
    // The chain (entry1 → entry2 on ACCOUNT_A) must verify — the fold
    // preserves per-account ordering, so prevHash→thisHash links hold.
    const verification = await ledger.verifyHashChainForAccount(
      ACCOUNT_A,
      TENANT,
    );
    expect(verification.ok).toBe(true);
    if (verification.ok) {
      expect(verification.scanned).toBe(2);
    }
  });

  it('a 3-line journal with TWO lines on one account (NON-zero net) keeps stored balance == sum(entries)', async () => {
    // The strongest fold test: ACCOUNT_A is touched by TWO lines whose net
    // is NON-zero, with a third line on ACCOUNT_B balancing the journal.
    //   A: DEBIT 700, CREDIT 200  → net +500
    //   B: CREDIT 500             → net -500
    //   debits = 700, credits = 200 + 500 = 700 ⇒ balanced.
    // The overwrite bug would have kept only A's LAST line (CREDIT 200) in
    // the CAS → stored balance -200 while sum(entries) on A = +500.
    const { ledger, accountRepo, ledgerRepo } = await buildService();

    const request = {
      tenantId: TENANT,
      effectiveDate: new Date('2026-06-01T00:00:00.000Z'),
      createdBy: 'h2-test',
      lines: [
        {
          accountId: ACCOUNT_A,
          type: 'PAYMENT',
          direction: 'DEBIT',
          amount: Money.fromMinorUnits(700, 'KES'),
          description: 'h2 A debit',
        },
        {
          accountId: ACCOUNT_A,
          type: 'CORRECTION',
          direction: 'CREDIT',
          amount: Money.fromMinorUnits(200, 'KES'),
          description: 'h2 A credit',
        },
        {
          accountId: ACCOUNT_B,
          type: 'PAYMENT',
          direction: 'CREDIT',
          amount: Money.fromMinorUnits(500, 'KES'),
          description: 'h2 B credit',
        },
      ],
    } as unknown as CreateJournalEntryRequest;

    await ledger.postJournalEntry(request);

    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    const b = await accountRepo.findById(ACCOUNT_B, TENANT);
    const calcA = await ledgerRepo.calculateAccountBalance(ACCOUNT_A, TENANT);
    const calcB = await ledgerRepo.calculateAccountBalance(ACCOUNT_B, TENANT);

    // The invariant the bug broke — for BOTH accounts.
    expect(a?.balanceMinorUnits).toBe(500); // +700 - 200
    expect(calcA?.balance).toBe(a?.balanceMinorUnits);
    expect(b?.balanceMinorUnits).toBe(-500);
    expect(calcB?.balance).toBe(b?.balanceMinorUnits);

    // One version bump per touched account.
    expect(a?.entryCount).toBe(1);
    expect(b?.entryCount).toBe(1);

    // A has TWO entries with distinct sequence numbers; B has ONE.
    const aEntries = await ledgerRepo.findByAccount(ACCOUNT_A, TENANT, 1, 100);
    expect(aEntries.total).toBe(2);
    expect(aEntries.entries.map((e) => e.sequenceNumber).sort()).toEqual([1, 2]);
    expect((await ledgerRepo.findByAccount(ACCOUNT_B, TENANT, 1, 100)).total).toBe(
      1,
    );

    // A's hash-chain across the two folded legs verifies.
    const chain = await ledger.verifyHashChainForAccount(ACCOUNT_A, TENANT);
    expect(chain.ok).toBe(true);
  });
});
