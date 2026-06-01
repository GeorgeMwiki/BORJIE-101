/**
 * Ledger CAS tests — G1 robustness-audit closure (2026-05-29).
 *
 * Closes audit gap G1 from `Docs/AUDIT/ROBUSTNESS_AUDIT_2026-05-29.md`:
 * the ledger previously read account → calc balance → update with no
 * compare-and-set, so two concurrent journal posts on the same account
 * could clobber each other.
 *
 * `LedgerService.postJournalEntry` now drives
 * `IAccountRepository.updateBalancesAtomic` (multi-row CAS inside a DB
 * transaction) and retries on stale-version. These tests pin the
 * contract:
 *
 *   1. Sequential posts on one account preserve the running balance.
 *   2. Concurrent posts on one account preserve the running balance
 *      (the retry catches the stale-version race).
 *   3. Concurrent posts on disjoint accounts proceed without
 *      interference.
 *   4. A repo permanently refusing CAS surfaces as a hard error after
 *      MAX_ATTEMPTS retries (no infinite loop).
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
import { LedgerService } from '../services/ledger.service';
import {
  InMemoryLedgerRepository,
  type ILedgerRepository,
} from '../repositories/ledger.repository';
import {
  InMemoryAccountRepository,
  type IAccountRepository,
} from '../repositories/account.repository';
import { InMemoryEventPublisher } from '../events/event-publisher';

const TENANT = 'tenant-cas-1' as TenantId;
const CUSTOMER = 'cust-cas-1' as CustomerId;
const ACCOUNT_A = 'acct-cas-A' as AccountId;
const ACCOUNT_B = 'acct-cas-B' as AccountId;
const ACCOUNT_C = 'acct-cas-C' as AccountId;

function silentLogger() {
  return {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

async function buildService(
  accountRepo: IAccountRepository = new InMemoryAccountRepository(),
  ledgerRepoOverride?: ILedgerRepository,
) {
  const ledgerRepo = new InMemoryLedgerRepository();
  // Durability defect #1 — the ledger repo folds balance CAS writes into
  // the same atomic unit as entry inserts, so it needs the account store
  // (the factory wires this in production). When `accountRepo` exposes
  // the LedgerTxAccountStore hooks, attach it.
  if (
    typeof (accountRepo as unknown as { __snapshotForLedgerTx?: unknown })
      .__snapshotForLedgerTx === 'function'
  ) {
    ledgerRepo.attachAccountStore(
      accountRepo as unknown as Parameters<
        typeof ledgerRepo.attachAccountStore
      >[0],
    );
  }
  const eventPublisher = new InMemoryEventPublisher();
  const ledger = new LedgerService({
    ledgerRepository: ledgerRepoOverride ?? ledgerRepo,
    accountRepository: accountRepo,
    eventPublisher,
    logger: silentLogger(),
  });
  await accountRepo.create(
    createCustomerLiabilityAccount(ACCOUNT_A, TENANT, CUSTOMER, 'KES', 'cas-test'),
  );
  await accountRepo.create(
    createCustomerLiabilityAccount(ACCOUNT_B, TENANT, CUSTOMER, 'KES', 'cas-test'),
  );
  await accountRepo.create(
    createCustomerLiabilityAccount(ACCOUNT_C, TENANT, CUSTOMER, 'KES', 'cas-test'),
  );
  return { ledger, accountRepo, ledgerRepo };
}

function debitCreditRequest(
  debitAccount: AccountId,
  creditAccount: AccountId,
  amountMinor: number,
): CreateJournalEntryRequest {
  return {
    tenantId: TENANT,
    effectiveDate: new Date(),
    createdBy: 'cas-test',
    lines: [
      {
        accountId: debitAccount,
        type: 'PAYMENT',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(amountMinor, 'KES'),
        description: 'cas-test debit',
      },
      {
        accountId: creditAccount,
        type: 'PAYMENT',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(amountMinor, 'KES'),
        description: 'cas-test credit',
      },
    ],
  } as CreateJournalEntryRequest;
}

describe('ledger CAS — sequential', () => {
  it('preserves the running balance across N sequential debit/credit posts', async () => {
    const { ledger, accountRepo } = await buildService();
    for (let i = 0; i < 5; i += 1) {
      await ledger.postJournalEntry(debitCreditRequest(ACCOUNT_A, ACCOUNT_B, 100));
    }
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    const b = await accountRepo.findById(ACCOUNT_B, TENANT);
    expect(a?.balanceMinorUnits).toBe(500);
    expect(b?.balanceMinorUnits).toBe(-500);
    expect(a?.entryCount).toBe(5);
    expect(b?.entryCount).toBe(5);
  });
});

describe('ledger CAS — concurrent on same account', () => {
  it('preserves balance and version across 10 concurrent posts on one account', async () => {
    const { ledger, accountRepo } = await buildService();
    const promises: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i += 1) {
      promises.push(
        ledger.postJournalEntry(debitCreditRequest(ACCOUNT_A, ACCOUNT_B, 50)),
      );
    }
    await Promise.all(promises);
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    const b = await accountRepo.findById(ACCOUNT_B, TENANT);
    // Each post adds 50 minor to A's balance (DEBIT) and subtracts 50
    // from B (CREDIT). CAS retry guarantees no posts are lost; the
    // final balance must be exactly 10 * 50 = 500.
    expect(a?.balanceMinorUnits).toBe(500);
    expect(b?.balanceMinorUnits).toBe(-500);
    expect(a?.entryCount).toBe(10);
    expect(b?.entryCount).toBe(10);
  });

  it('preserves balance across 3 concurrent posts on a different pair', async () => {
    const { ledger, accountRepo } = await buildService();
    await Promise.all([
      ledger.postJournalEntry(debitCreditRequest(ACCOUNT_B, ACCOUNT_C, 25)),
      ledger.postJournalEntry(debitCreditRequest(ACCOUNT_B, ACCOUNT_C, 25)),
      ledger.postJournalEntry(debitCreditRequest(ACCOUNT_B, ACCOUNT_C, 25)),
    ]);
    const b = await accountRepo.findById(ACCOUNT_B, TENANT);
    const c = await accountRepo.findById(ACCOUNT_C, TENANT);
    expect(b?.balanceMinorUnits).toBe(75);
    expect(c?.balanceMinorUnits).toBe(-75);
  });
});

describe('ledger CAS — disjoint accounts', () => {
  it('concurrent posts on disjoint debit accounts both land', async () => {
    const { ledger, accountRepo } = await buildService();
    await Promise.all([
      ledger.postJournalEntry(debitCreditRequest(ACCOUNT_A, ACCOUNT_B, 200)),
      ledger.postJournalEntry(debitCreditRequest(ACCOUNT_C, ACCOUNT_B, 300)),
    ]);
    const a = await accountRepo.findById(ACCOUNT_A, TENANT);
    const c = await accountRepo.findById(ACCOUNT_C, TENANT);
    const b = await accountRepo.findById(ACCOUNT_B, TENANT);
    expect(a?.balanceMinorUnits).toBe(200);
    expect(c?.balanceMinorUnits).toBe(300);
    expect(b?.balanceMinorUnits).toBe(-500);
  });
});

describe('ledger CAS — exhausted retries', () => {
  it('throws a clear error after MAX_ATTEMPTS when CAS keeps failing', async () => {
    // Ledger repo whose atomic post ALWAYS reports a stale CAS —
    // simulates a pathological neighbour that constantly bumps
    // `entry_count` before our transaction commits. After the bounded
    // retry the service surfaces a normal Error so callers know the
    // contract failed. We cap the retry count via env so the test runs
    // in <50 ms.
    process.env.LEDGER_CAS_MAX_ATTEMPTS = '3';
    const accountRepo = new InMemoryAccountRepository();
    const base = new InMemoryLedgerRepository();
    const blockingLedger: ILedgerRepository = Object.assign(
      Object.create(InMemoryLedgerRepository.prototype),
      base,
      {
        postJournalAtomic: async (post: {
          balanceUpdates: ReadonlyArray<{ accountId: AccountId }>;
        }) => ({
          status: 'stale' as const,
          conflictAccountId: post.balanceUpdates[0]!.accountId,
        }),
        findJournalIdByIdempotencyKey: async () => null,
      },
    );
    const { ledger } = await buildService(accountRepo, blockingLedger);
    await expect(
      ledger.postJournalEntry(debitCreditRequest(ACCOUNT_A, ACCOUNT_B, 100)),
    ).rejects.toThrow(/Ledger CAS failed after 3 attempts/);
    delete process.env.LEDGER_CAS_MAX_ATTEMPTS;
  });
});
