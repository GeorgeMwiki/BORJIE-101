/**
 * F3 — disbursement reconciliation consumer.
 *
 * Pins that a NEEDS_REVERSAL disbursement (money DEBITED, transfer failed /
 * timed out, nothing else driving it) is picked up by the sweep and driven to
 * a terminal state — or, when undeterminable, surfaced LOUD with a queryable
 * count so debited-but-undelivered money never sits silent:
 *
 *   - provider confirms NON-delivery → a COMPENSATING reversal is posted via
 *     LedgerService.post (money back to holding) and the disbursement FAILED;
 *   - the transfer never got an id → it is RE-DRIVEN under the SAME idempotency
 *     key (no double-send) and moves to IN_TRANSIT;
 *   - provider cannot answer (M-Pesa B2C is callback-only) → left NEEDS_REVERSAL
 *     and flagged, with the non-empty count returned;
 *   - the sweep is idempotent across re-runs (no double reversal).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  type AccountId,
  type OwnerId,
  type TenantId,
  type CurrencyCode,
  Money,
  createOwnerOperatingAccount,
  createPlatformHoldingAccount,
} from '@borjie/domain-models';
import { LedgerService } from '../services/ledger.service.js';
import { InMemoryLedgerRepository } from '../repositories/ledger.repository.js';
import { InMemoryAccountRepository } from '../repositories/account.repository.js';
import {
  InMemoryDisbursementRepository,
  type Disbursement,
} from '../repositories/disbursement.repository.js';
import { InMemoryEventPublisher } from '../events/event-publisher.js';
import type {
  IPaymentProvider,
  TransferResult,
} from '../providers/payment-provider.interface.js';
import {
  reconcileDisbursements,
  DisbursementReconciliationJob,
  type DisbursementReconciliationDeps,
} from '../jobs/disbursement-reconciliation.job.js';

const TENANT_ID = 'tenant-disb-rec-1' as TenantId;
const OWNER_ID = 'owner-disb-rec-1' as OwnerId;
const OWNER_OPERATING_ID = 'acct-owner-op-disb-rec-1' as AccountId;
const PLATFORM_HOLDING_ID = 'acct-platform-holding-disb-rec-1' as AccountId;
const FUNDING_ID = 'acct-funding-disb-rec-1' as AccountId;
const CURRENCY: CurrencyCode = 'KES';

function silentLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

/**
 * Stub provider for the sweep: programmable `getTransferStatus` (or a throw to
 * model M-Pesa's callback-only status) + an idempotent `createTransfer` for the
 * re-drive path.
 */
class StubProvider implements Partial<IPaymentProvider> {
  readonly name = 'mpesa';
  readonly transferCalls: string[] = [];
  constructor(
    private readonly statusFn: (id: string) => TransferResult | Error,
  ) {}

  async getTransferStatus(transferId: string): Promise<TransferResult> {
    const r = this.statusFn(transferId);
    if (r instanceof Error) throw r;
    return r;
  }

  async createTransfer(params: {
    amount: Money;
    destination: string;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  }): Promise<TransferResult> {
    this.transferCalls.push(params.idempotencyKey);
    return {
      transferId: `AG_redrive_${this.transferCalls.length}`,
      status: 'IN_TRANSIT',
      amount: params.amount,
    };
  }
}

interface Harness {
  ledgerService: LedgerService;
  ledgerRepo: InMemoryLedgerRepository;
  accountRepo: InMemoryAccountRepository;
  disbursementRepo: InMemoryDisbursementRepository;
}

async function makeHarness(): Promise<Harness> {
  const ledgerRepo = new InMemoryLedgerRepository();
  const accountRepo = new InMemoryAccountRepository();
  ledgerRepo.attachAccountStore(accountRepo);
  const disbursementRepo = new InMemoryDisbursementRepository();
  const ledgerService = new LedgerService({
    ledgerRepository: ledgerRepo,
    accountRepository: accountRepo,
    eventPublisher: new InMemoryEventPublisher(),
    logger: silentLogger(),
  });

  await accountRepo.create(
    createOwnerOperatingAccount(OWNER_OPERATING_ID, TENANT_ID, OWNER_ID, CURRENCY, 'test'),
  );
  await accountRepo.create(
    createPlatformHoldingAccount(PLATFORM_HOLDING_ID, TENANT_ID, CURRENCY, 'test'),
  );
  await accountRepo.create(
    createPlatformHoldingAccount(FUNDING_ID, TENANT_ID, CURRENCY, 'test'),
  );
  return { ledgerService, ledgerRepo, accountRepo, disbursementRepo };
}

/** Seed positive platform-holding balance through the REAL ledger path. */
async function seedHolding(h: Harness, minor: number): Promise<void> {
  await h.ledgerService.postJournalEntry({
    tenantId: TENANT_ID,
    effectiveDate: new Date(),
    createdBy: 'seed',
    lines: [
      {
        accountId: PLATFORM_HOLDING_ID,
        type: 'RENT_PAYMENT',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(minor, CURRENCY),
        description: 'seed holding',
      },
      {
        accountId: FUNDING_ID,
        type: 'RENT_PAYMENT',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(minor, CURRENCY),
        description: 'seed funding',
      },
    ],
  });
}

async function seedNeedsReversal(
  h: Harness,
  args: { id: string; transferId?: string; amountMinor: number },
): Promise<Disbursement> {
  const now = new Date();
  const disbursement: Disbursement = {
    id: args.id,
    tenantId: TENANT_ID,
    ownerId: OWNER_ID,
    amountMinorUnits: args.amountMinor,
    currency: CURRENCY,
    status: 'NEEDS_REVERSAL',
    destination: '254712345678',
    destinationType: 'PHONE',
    provider: 'mpesa',
    transferId: args.transferId,
    idempotencyKey: `idem-${args.id}`,
    ledgerEntryId: `jnl-${args.id}`,
    createdAt: now,
    updatedAt: now,
    createdBy: 'test',
  };
  await h.disbursementRepo.create(disbursement);
  return disbursement;
}

function depsWith(
  h: Harness,
  provider: IPaymentProvider | null,
): DisbursementReconciliationDeps {
  return {
    disbursementRepository: h.disbursementRepo,
    ledgerService: h.ledgerService,
    resolveReversalAccounts: async () => ({
      platformHoldingAccountId: PLATFORM_HOLDING_ID,
      ownerOperatingAccountId: OWNER_OPERATING_ID,
    }),
    getProvider: provider ? () => provider : undefined,
    logger: silentLogger(),
  };
}

describe('F3 — disbursement reconciliation sweep', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('picks up a NEEDS_REVERSAL whose transfer the provider confirms FAILED and posts the compensating reversal', async () => {
    await seedHolding(h, 1_000_000);
    await seedNeedsReversal(h, { id: 'disb-rec-fail', transferId: 'AG_failed_1', amountMinor: 30_000 });

    const provider = new StubProvider(() => ({
      transferId: 'AG_failed_1',
      status: 'FAILED',
      amount: Money.fromMinorUnits(30_000, CURRENCY),
      failureReason: 'b2c-rejected',
    })) as unknown as IPaymentProvider;

    const result = await reconcileDisbursements(TENANT_ID, depsWith(h, provider));

    expect(result.needsReversalCount).toBe(1);
    expect(result.reversed).toBe(1);
    // Disbursement is now terminally FAILED (the compensating entry posted).
    const stored = await h.disbursementRepo.findById('disb-rec-fail', TENANT_ID);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.failureReason).toContain('b2c-non-delivery');
    // Exactly ONE reversing entry on owner-operating; money back to holding.
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
    const holding = await h.accountRepo.findById(PLATFORM_HOLDING_ID, TENANT_ID);
    expect(holding?.balanceMinorUnits).toBe(1_000_000 + 30_000);
  });

  it('re-drives a NEEDS_REVERSAL that never got a transferId, under the SAME idempotency key', async () => {
    await seedNeedsReversal(h, { id: 'disb-rec-redrive', amountMinor: 25_000 }); // no transferId

    const provider = new StubProvider(() => new Error('should not be queried'));
    const stub = provider as unknown as IPaymentProvider;

    const result = await reconcileDisbursements(TENANT_ID, depsWith(h, stub));

    expect(result.redriven).toBe(1);
    // Re-drive used the disbursement-id-derived key (provider never double-sends).
    expect(provider.transferCalls).toEqual(['disbursement-transfer:disb-rec-redrive']);
    const stored = await h.disbursementRepo.findById('disb-rec-redrive', TENANT_ID);
    expect(stored?.status).toBe('IN_TRANSIT');
    expect(stored?.transferId).toBe('AG_redrive_1');
    // No reversal posted on the re-drive path.
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
  });

  it('leaves NEEDS_REVERSAL + surfaces a non-empty count when delivery is undeterminable (M-Pesa callback-only)', async () => {
    await seedNeedsReversal(h, { id: 'disb-rec-unknown', transferId: 'AG_unknown_1', amountMinor: 10_000 });

    // M-Pesa B2C getTransferStatus throws ("tracked via callbacks") → cannot
    // determine; must NOT guess.
    const provider = new StubProvider(
      () => new Error('M-PESA transfer status must be tracked via callbacks'),
    ) as unknown as IPaymentProvider;

    const result = await reconcileDisbursements(TENANT_ID, depsWith(h, provider));

    // The MINIMUM guarantee: the count is surfaced (queryable) and the row is
    // left NEEDS_REVERSAL (not masked, not lost).
    expect(result.needsReversalCount).toBe(1);
    expect(result.leftNeedsReversal).toBe(1);
    expect(result.reversed).toBe(0);
    const stored = await h.disbursementRepo.findById('disb-rec-unknown', TENANT_ID);
    expect(stored?.status).toBe('NEEDS_REVERSAL');
  });

  it('surfaces a non-empty NEEDS_REVERSAL count even with NO provider wired (surface-only mode)', async () => {
    await seedNeedsReversal(h, { id: 'disb-rec-surface', transferId: 'AG_x', amountMinor: 5_000 });

    const result = await reconcileDisbursements(TENANT_ID, depsWith(h, null));

    expect(result.needsReversalCount).toBe(1);
    expect(result.leftNeedsReversal).toBe(1);
    // Untouched — left for a human / the next B2C result.
    expect((await h.disbursementRepo.findById('disb-rec-surface', TENANT_ID))?.status).toBe(
      'NEEDS_REVERSAL',
    );
  });

  it('is idempotent across re-runs — the reversal is posted exactly once', async () => {
    await seedHolding(h, 1_000_000);
    await seedNeedsReversal(h, { id: 'disb-rec-idem', transferId: 'AG_failed_2', amountMinor: 30_000 });
    const provider = new StubProvider(() => ({
      transferId: 'AG_failed_2',
      status: 'FAILED',
      amount: Money.fromMinorUnits(30_000, CURRENCY),
    })) as unknown as IPaymentProvider;

    const first = await reconcileDisbursements(TENANT_ID, depsWith(h, provider));
    // Second pass: the row is already FAILED, so it is no longer NEEDS_REVERSAL
    // and is not swept again (no second reversal).
    const second = await reconcileDisbursements(TENANT_ID, depsWith(h, provider));

    expect(first.reversed).toBe(1);
    expect(second.needsReversalCount).toBe(0);
    expect(second.reversed).toBe(0);
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
  });

  it('the job wrapper isolates tenants — one tenant sweep result per id', async () => {
    await seedNeedsReversal(h, { id: 'disb-rec-job', transferId: 'AG_j', amountMinor: 1_000 });
    const job = new DisbursementReconciliationJob(depsWith(h, null));
    const results = await job.run([TENANT_ID]);
    expect(results).toHaveLength(1);
    expect(results[0].tenantId).toBe(TENANT_ID);
    expect(results[0].needsReversalCount).toBe(1);
  });
});
