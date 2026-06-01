/**
 * Disbursement: ledger-before-transfer + idempotency (EDGE-HARDENING #6).
 *
 * Pins the corrected ordering and the no-double-anything guarantees:
 *   - the ledger journal is posted BEFORE the B2C transfer is initiated
 *     (a spy provider records the relative order);
 *   - a retry under the SAME idempotency key neither double-posts the
 *     ledger NOR double-sends the transfer;
 *   - when the transfer FAILS after the ledger post, the disbursement is
 *     left in a retryable NEEDS_REVERSAL state (no blind re-transfer) and
 *     the ledger entry is NOT lost.
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
import {
  DisbursementService,
  isCleanDisbursementSuccess,
} from '../services/disbursement.service.js';
import { LedgerService } from '../services/ledger.service.js';
import { InMemoryLedgerRepository } from '../repositories/ledger.repository.js';
import { InMemoryAccountRepository } from '../repositories/account.repository.js';
import { InMemoryDisbursementRepository } from '../repositories/disbursement.repository.js';
import { InMemoryEventPublisher } from '../events/event-publisher.js';
import type {
  IPaymentProvider,
  TransferResult,
} from '../providers/payment-provider.interface.js';

const TENANT_ID = 'tenant-disb-1' as TenantId;
const OWNER_ID = 'owner-disb-1' as OwnerId;
const OWNER_OPERATING_ID = 'acct-owner-op-disb-1' as AccountId;
const PLATFORM_HOLDING_ID = 'acct-platform-holding-disb-1' as AccountId;
const FUNDING_ID = 'acct-funding-disb-1' as AccountId;
const CURRENCY: CurrencyCode = 'KES';

function silentLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

/**
 * Spy B2C provider — records the order of `createTransfer` calls relative
 * to ledger posts (via a shared `events` log) and can be armed to FAIL or
 * to assert idempotency-key reuse.
 */
class SpyTransferProvider implements Partial<IPaymentProvider> {
  readonly name = 'mpesa';
  readonly transferCalls: Array<{ idempotencyKey: string; originator?: string }> = [];
  private fail = false;

  constructor(private readonly events: string[]) {}

  armFailure(): void {
    this.fail = true;
  }

  async createTransfer(params: {
    amount: Money;
    destination: string;
    description?: string;
    metadata?: Record<string, string>;
    idempotencyKey: string;
  }): Promise<TransferResult> {
    this.events.push('transfer');
    this.transferCalls.push({
      idempotencyKey: params.idempotencyKey,
      originator: params.metadata?.originatorConversationId,
    });
    if (this.fail) {
      throw new Error('Daraja B2C unreachable');
    }
    return {
      transferId: `AG_${this.transferCalls.length}`,
      status: 'IN_TRANSIT',
      amount: params.amount,
    };
  }
}

interface Harness {
  service: DisbursementService;
  ledgerService: LedgerService;
  ledgerRepo: InMemoryLedgerRepository;
  accountRepo: InMemoryAccountRepository;
  disbursementRepo: InMemoryDisbursementRepository;
  provider: SpyTransferProvider;
  events: string[];
}

async function makeHarness(): Promise<Harness> {
  const ledgerRepo = new InMemoryLedgerRepository();
  const accountRepo = new InMemoryAccountRepository();
  const disbursementRepo = new InMemoryDisbursementRepository();
  const eventPublisher = new InMemoryEventPublisher();
  const events: string[] = [];

  const ledgerService = new LedgerService({
    ledgerRepository: ledgerRepo,
    accountRepository: accountRepo,
    eventPublisher,
    logger: silentLogger(),
  });

  // Wrap postJournalEntry so the ORDER of ledger-vs-transfer is observable.
  const realPost = ledgerService.postJournalEntry.bind(ledgerService);
  ledgerService.postJournalEntry = (async (req, opts) => {
    events.push('ledger');
    return realPost(req, opts);
  }) as typeof ledgerService.postJournalEntry;

  await accountRepo.create(
    createOwnerOperatingAccount(OWNER_OPERATING_ID, TENANT_ID, OWNER_ID, CURRENCY, 'test'),
  );
  await accountRepo.create(
    createPlatformHoldingAccount(PLATFORM_HOLDING_ID, TENANT_ID, CURRENCY, 'test'),
  );
  // A funding account to seed the platform-holding balance through the
  // REAL ledger path (no direct balance pokes). DEBIT holding / CREDIT
  // funding gives holding a positive balance to disburse from.
  await accountRepo.create(
    createPlatformHoldingAccount(FUNDING_ID, TENANT_ID, CURRENCY, 'test'),
  );
  await realPost({
    tenantId: TENANT_ID,
    effectiveDate: new Date(),
    createdBy: 'seed',
    lines: [
      {
        accountId: PLATFORM_HOLDING_ID,
        type: 'RENT_PAYMENT',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(1_000_000, CURRENCY),
        description: 'seed holding',
      },
      {
        accountId: FUNDING_ID,
        type: 'RENT_PAYMENT',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(1_000_000, CURRENCY),
        description: 'seed funding',
      },
    ],
  });
  // Drop the seed post from the order log so assertions see only the
  // disbursement's own ledger/transfer events.
  events.length = 0;

  const provider = new SpyTransferProvider(events);
  const service = new DisbursementService({
    accountRepository: accountRepo,
    disbursementRepository: disbursementRepo,
    ledgerService,
    eventPublisher,
    logger: silentLogger(),
  });
  service.registerProvider(provider as unknown as IPaymentProvider, true);

  return {
    service,
    ledgerService,
    ledgerRepo,
    accountRepo,
    disbursementRepo,
    provider,
    events,
  };
}

describe('EDGE-HARDENING #6 — disbursement ledger-before-transfer', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it('posts the ledger journal BEFORE initiating the transfer', async () => {
    const result = await h.service.processDisbursement({
      tenantId: TENANT_ID,
      ownerId: OWNER_ID,
      amount: Money.fromMinorUnits(50_000, CURRENCY),
      destination: '254712345678',
      idempotencyKey: 'disb-order-1',
    });
    expect(result.status).not.toBe('FAILED');
    // The ledger event MUST precede the transfer event.
    expect(h.events).toEqual(['ledger', 'transfer']);
    // Exactly one transfer was sent.
    expect(h.provider.transferCalls).toHaveLength(1);
    // The transfer carries a disbursement-id-derived idempotency anchor.
    expect(h.provider.transferCalls[0].idempotencyKey).toMatch(
      /^disbursement-transfer:/,
    );
    expect(h.provider.transferCalls[0].originator).toMatch(/^disb-/);
  });

  it('a retry under the SAME idempotency key neither double-posts nor double-transfers', async () => {
    const first = await h.service.processDisbursement({
      tenantId: TENANT_ID,
      ownerId: OWNER_ID,
      amount: Money.fromMinorUnits(40_000, CURRENCY),
      destination: '254712345678',
      idempotencyKey: 'disb-idem-1',
    });

    const ledgerEventsAfterFirst = h.events.filter((e) => e === 'ledger').length;
    const transfersAfterFirst = h.provider.transferCalls.length;

    // Retry with the SAME idempotency key — must return the existing
    // disbursement and do NOTHING else.
    const second = await h.service.processDisbursement({
      tenantId: TENANT_ID,
      ownerId: OWNER_ID,
      amount: Money.fromMinorUnits(40_000, CURRENCY),
      destination: '254712345678',
      idempotencyKey: 'disb-idem-1',
    });

    expect(second.disbursementId).toBe(first.disbursementId);
    // No second ledger post, no second transfer.
    expect(h.events.filter((e) => e === 'ledger').length).toBe(ledgerEventsAfterFirst);
    expect(h.provider.transferCalls.length).toBe(transfersAfterFirst);
    expect(transfersAfterFirst).toBe(1);

    // The owner-operating account moved exactly ONCE (one disbursement leg).
    const op = await h.accountRepo.findById(OWNER_OPERATING_ID, TENANT_ID);
    expect(op?.entryCount).toBe(1);
  });

  it('a transfer failure AFTER the ledger post leaves NEEDS_REVERSAL with the ledger intact (no blind re-transfer)', async () => {
    h.provider.armFailure();
    const result = await h.service.processDisbursement({
      tenantId: TENANT_ID,
      ownerId: OWNER_ID,
      amount: Money.fromMinorUnits(30_000, CURRENCY),
      destination: '254712345678',
      idempotencyKey: 'disb-fail-1',
    });

    // F4 — the result status is NEEDS_REVERSAL, NOT a masked FAILED. Money WAS
    // debited (the ledger posted), so this is in-flight-needs-attention, not a
    // clean retry-safe failure. (The persisted row is NEEDS_REVERSAL too.)
    expect(result.status).toBe('NEEDS_REVERSAL');
    // The ledger DID post (money was debited) — ordering held.
    expect(h.events).toEqual(['ledger', 'transfer']);
    // The owner-operating account got its disbursement leg (ledger intact).
    const op = await h.accountRepo.findById(OWNER_OPERATING_ID, TENANT_ID);
    expect(op?.entryCount).toBe(1);

    // The disbursement is parked RETRYABLE in NEEDS_REVERSAL — NOT silently
    // lost, NOT blindly re-sent.
    const stored = await h.disbursementRepo.findById(result.disbursementId, TENANT_ID);
    expect(stored?.status).toBe('NEEDS_REVERSAL');
    expect(stored?.failureReason).toContain('Daraja B2C unreachable');
    expect(stored?.ledgerEntryId).toBeTruthy();

    // It surfaces to the reconciliation job's pending sweep.
    const pending = await h.disbursementRepo.findPending(TENANT_ID);
    expect(pending.map((p) => p.id)).toContain(result.disbursementId);

    // Re-driving under the SAME key does NOT post a second ledger entry and
    // returns the existing (NEEDS_REVERSAL) record — no double-transfer.
    const transfersBefore = h.provider.transferCalls.length;
    const retry = await h.service.processDisbursement({
      tenantId: TENANT_ID,
      ownerId: OWNER_ID,
      amount: Money.fromMinorUnits(30_000, CURRENCY),
      destination: '254712345678',
      idempotencyKey: 'disb-fail-1',
    });
    expect(retry.disbursementId).toBe(result.disbursementId);
    // F4 — the idempotent replay also surfaces NEEDS_REVERSAL (not masked).
    expect(retry.status).toBe('NEEDS_REVERSAL');
    expect(h.provider.transferCalls.length).toBe(transfersBefore);
    const opAfter = await h.accountRepo.findById(OWNER_OPERATING_ID, TENANT_ID);
    expect(opAfter?.entryCount).toBe(1); // still exactly one ledger leg
  });
});

// ───────────────────────────────────────────────────────────────────────
// F4 — result status distinguishes NEEDS_REVERSAL from a clean FAILED
// ───────────────────────────────────────────────────────────────────────

describe('F4 — NEEDS_REVERSAL is not a clean success / not a clean FAILED', () => {
  it('NEEDS_REVERSAL is NOT counted as a clean disbursement success', () => {
    // Money WAS debited — it must never tally as succeeded in batch accounting.
    expect(isCleanDisbursementSuccess('NEEDS_REVERSAL')).toBe(false);
    // A clean FAILED (no money moved) is also not a success, but it is a
    // DISTINCT status from NEEDS_REVERSAL — the masking F4 removes.
    expect(isCleanDisbursementSuccess('FAILED')).toBe(false);
    expect(isCleanDisbursementSuccess('CANCELLED')).toBe(false);
  });

  it('genuinely in-flight / delivered states count as clean success', () => {
    expect(isCleanDisbursementSuccess('PAID')).toBe(true);
    expect(isCleanDisbursementSuccess('IN_TRANSIT')).toBe(true);
    expect(isCleanDisbursementSuccess('PENDING')).toBe(true);
  });
});
