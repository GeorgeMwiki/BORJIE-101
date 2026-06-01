/**
 * Legacy Express webhook routes → hardened modules (composition/legacy-webhooks).
 *
 * These pin the behaviour the legacy `server.ts` routes used to GET WRONG:
 *
 *   STK (`/webhooks/mpesa/stk`):
 *     - a GENUINE processing failure NO LONGER acks `{ResultCode:0}` — it
 *       returns a NON-success ResultCode + a non-2xx HTTP status (the old
 *       catch swallowed everything into Accepted, masking real failures);
 *     - a DUPLICATE (durable dedupe hit) acks success (already processed);
 *     - a correctly-classified customer failure (insufficient funds) acks
 *       (terminal, not a processing failure) and posts NO ledger credit;
 *     - a clean success acks and posts exactly one credit;
 *     - dedupe is DURABLE (survives a simulated restart — fresh handler
 *       deps, same store).
 *
 *   B2C result (`/webhooks/mpesa/b2c/result`):
 *     - ResultCode 0 transitions a NEEDS_REVERSAL disbursement → PAID;
 *     - a confirmed non-delivery (non-zero terminal code) posts a
 *       COMPENSATING reversal via LedgerService.post (money back to holding)
 *       and marks the disbursement FAILED;
 *     - both are idempotent via the DURABLE store (a redelivery is dropped).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  type AccountId,
  type CustomerId,
  type OwnerId,
  type TenantId,
  type CurrencyCode,
  Money,
  createCustomerLiabilityAccount,
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
import { InMemoryWebhookDedupeStore } from '../providers/webhook-dedupe-store.js';
import {
  MockMpesaClient,
  initiateStkPush,
} from '../providers/mpesa/index.js';
import type {
  MpesaTenantContext,
  MpesaTenantResolver,
} from '../providers/mpesa/webhook-handler.js';
import {
  processLegacyStkWebhook,
  parseB2cResult,
  processB2cResult,
  type ProcessB2cResultDeps,
} from '../composition/legacy-webhooks.js';

const TENANT_ID = 'tenant-legacy-wh-1' as TenantId;
const CUSTOMER_ID = 'cust-legacy-wh-1' as CustomerId;
const OWNER_ID = 'owner-legacy-wh-1' as OwnerId;
const CUSTOMER_ACCOUNT_ID = 'acct-cust-legacy-wh-1' as AccountId;
const CLEARING_ACCOUNT_ID = 'acct-clearing-legacy-wh-1' as AccountId;
const OWNER_OPERATING_ID = 'acct-owner-op-legacy-wh-1' as AccountId;
const FUNDING_ID = 'acct-funding-legacy-wh-1' as AccountId;
const CURRENCY: CurrencyCode = 'KES';

function silentLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
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
    createCustomerLiabilityAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, CUSTOMER_ID, CURRENCY, 'test'),
  );
  await accountRepo.create(
    createPlatformHoldingAccount(CLEARING_ACCOUNT_ID, TENANT_ID, CURRENCY, 'test'),
  );
  await accountRepo.create(
    createOwnerOperatingAccount(OWNER_OPERATING_ID, TENANT_ID, OWNER_ID, CURRENCY, 'test'),
  );
  await accountRepo.create(
    createPlatformHoldingAccount(FUNDING_ID, TENANT_ID, CURRENCY, 'test'),
  );

  return { ledgerService, ledgerRepo, accountRepo, disbursementRepo };
}

/** Build the STK handler deps with a deterministic tenant resolver. */
function stkDeps(
  ledgerService: LedgerService,
  dedupeStore: InMemoryWebhookDedupeStore,
  resolveTenantContext: MpesaTenantResolver,
  onPaymentFailed?: (f: { failureReason: string; resultCode: number }) => void,
) {
  return {
    handlerDeps: {
      ledgerService,
      resolveTenantContext,
      dedupeStore,
      skipSignatureCheck: true,
      onPaymentFailed: onPaymentFailed
        ? async (f: { failureReason: string; resultCode: number }) => onPaymentFailed(f)
        : undefined,
    },
    logger: silentLogger(),
  };
}

const okContext: MpesaTenantContext = {
  tenantId: TENANT_ID,
  customerAccountId: CUSTOMER_ACCOUNT_ID,
  cashClearingAccountId: CLEARING_ACCOUNT_ID,
  currency: CURRENCY,
};

async function makeSuccessCallback(amount: number): Promise<string> {
  const client = new MockMpesaClient();
  await initiateStkPush(
    {
      amount,
      currency: 'KES',
      phoneNumber: '+254712345678',
      accountReference: 'BORJIE',
      transactionDesc: 'Rent',
      callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
      businessShortCode: '174379',
    },
    { client },
  );
  const [callback] = client.drainCallbacks();
  return JSON.stringify(callback.payload);
}

async function makeFailureCallback(resultCode: number, desc: string): Promise<string> {
  const client = new MockMpesaClient({
    scenarios: { '254700000000': { forceResultCode: resultCode, forceResultDesc: desc } },
  });
  await initiateStkPush(
    {
      amount: 900,
      currency: 'KES',
      phoneNumber: '+254700000000',
      accountReference: 'BORJIE',
      transactionDesc: 'Rent',
      callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
      businessShortCode: '174379',
    },
    { client },
  );
  const [callback] = client.drainCallbacks();
  return JSON.stringify(callback.payload);
}

// ───────────────────────────────────────────────────────────────────────
// STK — failure path is NEVER masked as ResultCode:0
// ───────────────────────────────────────────────────────────────────────

describe('legacy STK route — fail-loud (no ResultCode:0-on-failure)', () => {
  let h: Harness;
  let store: InMemoryWebhookDedupeStore;
  beforeEach(async () => {
    h = await makeHarness();
    store = new InMemoryWebhookDedupeStore();
  });

  it('a malformed (rejected) callback returns NON-success — not Accepted', async () => {
    const resp = await processLegacyStkWebhook(
      'not-json-at-all',
      {},
      stkDeps(h.ledgerService, store, async () => okContext),
    );
    // The old route returned { ResultCode: 0, ResultDesc: 'Accepted' }; the
    // hardened path surfaces the failure instead.
    expect(resp.body.ResultCode).not.toBe(0);
    expect(resp.httpStatus).toBeGreaterThanOrEqual(400);
    expect(resp.loud).toBe(true);
  });

  it('a processing THROW (e.g. ledger/resolver) returns NON-success — not Accepted', async () => {
    const raw = await makeSuccessCallback(1000);
    const resp = await processLegacyStkWebhook(
      raw,
      {},
      stkDeps(h.ledgerService, store, async () => {
        throw new Error('resolver exploded');
      }),
    );
    expect(resp.body.ResultCode).not.toBe(0);
    expect(resp.httpStatus).toBe(500);
    expect(resp.loud).toBe(true);
  });

  it('a duplicate (durable dedupe hit) ACKS success — already processed', async () => {
    const raw = await makeSuccessCallback(1000);
    const first = await processLegacyStkWebhook(
      raw,
      {},
      stkDeps(h.ledgerService, store, async () => okContext),
    );
    // Same store, fresh deps — models a redelivery across a restart.
    const second = await processLegacyStkWebhook(
      raw,
      {},
      stkDeps(h.ledgerService, store, async () => okContext),
    );
    expect(first.body.ResultCode).toBe(0); // posted → ack
    expect(second.body.ResultCode).toBe(0); // duplicate → ack
    expect(second.loud).toBe(false);
    // Exactly one credit landed (durable dedupe blocked the second post).
    expect(
      (await h.ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
  });

  it('a classified customer failure (insufficient funds) ACKS but posts NO credit', async () => {
    const raw = await makeFailureCallback(1, 'Insufficient balance');
    const failures: Array<{ failureReason: string; resultCode: number }> = [];
    const resp = await processLegacyStkWebhook(
      raw,
      {},
      stkDeps(h.ledgerService, store, async () => okContext, (f) => failures.push(f)),
    );
    // A terminal customer failure is correctly classified — ack so Safaricom
    // stops retrying, but it is NOT a processing failure on our side.
    expect(resp.body.ResultCode).toBe(0);
    expect(failures).toHaveLength(1);
    expect(failures[0].failureReason).toBe('insufficient-balance');
    // NO ledger credit.
    expect(
      (await h.ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
  });

  it('a clean success ACKS and posts exactly one credit', async () => {
    const raw = await makeSuccessCallback(1000);
    const resp = await processLegacyStkWebhook(
      raw,
      {},
      stkDeps(h.ledgerService, store, async () => okContext),
    );
    expect(resp.body.ResultCode).toBe(0);
    expect(resp.loud).toBe(false);
    const balance = await h.ledgerService.getAccountBalance(CUSTOMER_ACCOUNT_ID, TENANT_ID);
    expect(balance?.amountMinorUnits).toBe(-1000 * 100);
  });
});

// ───────────────────────────────────────────────────────────────────────
// B2C result — NEEDS_REVERSAL → PAID, or compensating reversal
// ───────────────────────────────────────────────────────────────────────

const B2C_CONVERSATION_ID = 'AG_20260601_b2c_conv_1';

/** Seed a NEEDS_REVERSAL disbursement whose transferId == the B2C ConversationID. */
async function seedNeedsReversalDisbursement(
  repo: InMemoryDisbursementRepository,
  amountMinor: number,
): Promise<Disbursement> {
  const now = new Date();
  const disbursement: Disbursement = {
    id: 'disb-legacy-wh-1',
    tenantId: TENANT_ID,
    ownerId: OWNER_ID,
    amountMinorUnits: amountMinor,
    currency: CURRENCY,
    status: 'NEEDS_REVERSAL',
    destination: '254712345678',
    destinationType: 'PHONE',
    provider: 'mpesa',
    transferId: B2C_CONVERSATION_ID,
    idempotencyKey: 'disb-legacy-wh-idem-1',
    ledgerEntryId: 'jnl-prior-disbursement',
    createdAt: now,
    updatedAt: now,
    createdBy: 'test',
  };
  await repo.create(disbursement);
  return disbursement;
}

function b2cDeps(h: Harness, store: InMemoryWebhookDedupeStore): ProcessB2cResultDeps {
  return {
    ledgerService: h.ledgerService,
    disbursementRepository: h.disbursementRepo,
    dedupeStore: store,
    resolveReversalAccounts: async () => ({
      platformHoldingAccountId: CLEARING_ACCOUNT_ID,
      ownerOperatingAccountId: OWNER_OPERATING_ID,
    }),
    logger: silentLogger(),
  };
}

/** Seed positive platform-holding balance through the REAL ledger path. */
async function seedHolding(h: Harness, minor: number): Promise<void> {
  await h.ledgerService.postJournalEntry({
    tenantId: TENANT_ID,
    effectiveDate: new Date(),
    createdBy: 'seed',
    lines: [
      {
        accountId: CLEARING_ACCOUNT_ID,
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

describe('legacy B2C result route — finalize disbursement', () => {
  let h: Harness;
  let store: InMemoryWebhookDedupeStore;
  beforeEach(async () => {
    h = await makeHarness();
    store = new InMemoryWebhookDedupeStore();
  });

  it('ResultCode 0 transitions NEEDS_REVERSAL → PAID', async () => {
    await seedNeedsReversalDisbursement(h.disbursementRepo, 30_000);
    const envelope = parseB2cResult({
      Result: {
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        ConversationID: B2C_CONVERSATION_ID,
        OriginatorConversationID: 'disb-disb-legacy-wh-1',
        TransactionID: 'QGH7XYZ123',
      },
    });
    expect(envelope).not.toBeNull();

    const outcome = await processB2cResult(envelope!, b2cDeps(h, store));
    expect(outcome.status).toBe('paid');

    const stored = await h.disbursementRepo.findById('disb-legacy-wh-1', TENANT_ID);
    expect(stored?.status).toBe('PAID');
    expect(stored?.completedAt).toBeTruthy();
    // No reversal posted on the happy path.
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
  });

  it('a confirmed non-delivery posts a compensating reversal and marks FAILED', async () => {
    await seedHolding(h, 1_000_000);
    await seedNeedsReversalDisbursement(h.disbursementRepo, 30_000);

    const envelope = parseB2cResult({
      Result: {
        ResultCode: 2001,
        ResultDesc: 'The initiator information is invalid.',
        ConversationID: B2C_CONVERSATION_ID,
        OriginatorConversationID: 'disb-disb-legacy-wh-1',
        TransactionID: 'QGH7FAIL999',
      },
    });
    const outcome = await processB2cResult(envelope!, b2cDeps(h, store));

    expect(outcome.status).toBe('reversed');
    if (outcome.status === 'reversed') {
      expect(outcome.journalId).toBeTruthy();
    }
    const stored = await h.disbursementRepo.findById('disb-legacy-wh-1', TENANT_ID);
    expect(stored?.status).toBe('FAILED');
    expect(stored?.failureReason).toContain('b2c-non-delivery');

    // The compensating reversal posted: DR holding / CR owner-operating.
    // Owner-operating got exactly ONE reversing entry…
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
    // …and the money returned to holding (seed 1,000,000 + reversal 30,000).
    const holding = await h.accountRepo.findById(CLEARING_ACCOUNT_ID, TENANT_ID);
    expect(holding?.balanceMinorUnits).toBe(1_000_000 + 30_000);
  });

  it('a redelivered B2C result is a safe no-op (idempotent — already-terminal primary guard)', async () => {
    await seedNeedsReversalDisbursement(h.disbursementRepo, 30_000);
    const body = {
      Result: {
        ResultCode: 0,
        ResultDesc: 'ok',
        ConversationID: B2C_CONVERSATION_ID,
        OriginatorConversationID: 'disb-disb-legacy-wh-1',
        TransactionID: 'QGH7DUP000',
      },
    };
    const first = await processB2cResult(parseB2cResult(body)!, b2cDeps(h, store));
    // Same store, fresh deps — models a Safaricom redelivery / second replica.
    const second = await processB2cResult(parseB2cResult(body)!, b2cDeps(h, store));

    expect(first.status).toBe('paid');
    // F2 — the claim is recorded AFTER the side effect, so the PRIMARY
    // idempotency on a redelivery is the already-terminal guard (the row is
    // now PAID), which makes the redelivery a safe no-op even if the dedupe
    // claim were lost. Either way no double-action occurs.
    expect(second.status).toBe('already-final');
    if (second.status === 'already-final') {
      expect(second.disbursementStatus).toBe('PAID');
    }
    // The disbursement settled exactly once (still PAID, no reversal posted).
    const stored = await h.disbursementRepo.findById('disb-legacy-wh-1', TENANT_ID);
    expect(stored?.status).toBe('PAID');
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
  });

  it('a result matching no disbursement is a no-match (manual reconciliation)', async () => {
    const outcome = await processB2cResult(
      parseB2cResult({
        Result: {
          ResultCode: 0,
          ResultDesc: 'ok',
          ConversationID: 'AG_unknown_conversation',
          TransactionID: 'QGH7NONE000',
        },
      })!,
      b2cDeps(h, store),
    );
    expect(outcome.status).toBe('no-match');
  });

  it('a body with no Result envelope parses to null (ack-and-skip)', () => {
    expect(parseB2cResult({})).toBeNull();
    expect(parseB2cResult({ Result: {} })).toBeNull();
    expect(parseB2cResult(null)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
// F1 — a B2C result for tenant A CANNOT resolve/reverse tenant B's disbursement
// ───────────────────────────────────────────────────────────────────────

const TENANT_B = 'tenant-legacy-wh-B' as TenantId;
const OWNER_B = 'owner-legacy-wh-B' as OwnerId;
/** A transfer/Conversation id that BOTH tenants could legitimately carry. */
const SHARED_CONVERSATION_ID = 'AG_shared_conversation_xyz';

/** Seed an in-flight disbursement for an arbitrary tenant/owner/id. */
async function seedDisbursementFor(
  repo: InMemoryDisbursementRepository,
  args: {
    id: string;
    tenantId: TenantId;
    ownerId: OwnerId;
    transferId: string;
    amountMinor: number;
  },
): Promise<Disbursement> {
  const now = new Date();
  const disbursement: Disbursement = {
    id: args.id,
    tenantId: args.tenantId,
    ownerId: args.ownerId,
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
  await repo.create(disbursement);
  return disbursement;
}

describe('F1 — B2C result cannot resolve/reverse another tenant', () => {
  let h: Harness;
  let store: InMemoryWebhookDedupeStore;
  beforeEach(async () => {
    h = await makeHarness();
    store = new InMemoryWebhookDedupeStore();
  });

  it("tenant A's result whose originator id does not exist does NOT resolve tenant B's same-transferId disbursement", async () => {
    // Tenant B owns a NEEDS_REVERSAL disbursement with a transferId that the
    // inbound (attacker/misrouted) result ALSO carries as its ConversationID.
    await seedHolding(h, 1_000_000); // tenant-A holding (unused — must stay put)
    await seedDisbursementFor(h.disbursementRepo, {
      id: 'disb-tenantB-1',
      tenantId: TENANT_B,
      ownerId: OWNER_B,
      transferId: SHARED_CONVERSATION_ID,
      amountMinor: 30_000,
    });

    // The result's originator points at a disbursement id that DOES NOT EXIST
    // (tenant A's claimed id). The ONLY way the old code could have acted was
    // by matching tenant B's row via the shared ConversationID with no tenant
    // predicate — exactly the cross-tenant write F1 closes.
    const envelope = parseB2cResult({
      Result: {
        ResultCode: 2001, // non-delivery → would attempt a REVERSAL
        ResultDesc: 'The initiator information is invalid.',
        ConversationID: SHARED_CONVERSATION_ID,
        OriginatorConversationID: 'disb-disb-tenantA-ghost',
        TransactionID: 'QGH7XTENANT',
      },
    });

    const outcome = await processB2cResult(envelope!, b2cDeps(h, store));

    // No disbursement resolved → no-match. Tenant B's row is UNTOUCHED.
    expect(outcome.status).toBe('no-match');
    const tenantB = await h.disbursementRepo.findById('disb-tenantB-1', TENANT_B);
    expect(tenantB?.status).toBe('NEEDS_REVERSAL');
    // No reversal posted into ANY ledger account.
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
  });

  it("a result whose ConversationID belongs to tenant B but whose originator id is tenant A's is REFUSED (mismatch)", async () => {
    // Tenant A owns disbursement A; tenant B owns disbursement B with a
    // DIFFERENT transferId. The result correctly resolves tenant A by its
    // globally-unique id, but its ConversationID is tenant B's transferId — a
    // mis-correlated envelope. The transferId cross-check refuses to act.
    await seedNeedsReversalDisbursement(h.disbursementRepo, 30_000); // disb-legacy-wh-1 (tenant A), transferId B2C_CONVERSATION_ID
    await seedDisbursementFor(h.disbursementRepo, {
      id: 'disb-tenantB-2',
      tenantId: TENANT_B,
      ownerId: OWNER_B,
      transferId: SHARED_CONVERSATION_ID,
      amountMinor: 30_000,
    });

    const envelope = parseB2cResult({
      Result: {
        ResultCode: 0,
        ResultDesc: 'ok',
        ConversationID: SHARED_CONVERSATION_ID, // tenant B's transferId
        OriginatorConversationID: 'disb-disb-legacy-wh-1', // tenant A's id
        TransactionID: 'QGH7XMIS',
      },
    });

    const outcome = await processB2cResult(envelope!, b2cDeps(h, store));

    // Mismatch (resolved row's transferId != envelope ConversationID) → refuse.
    expect(outcome.status).toBe('no-match');
    // Neither disbursement transitioned.
    expect((await h.disbursementRepo.findById('disb-legacy-wh-1', TENANT_ID))?.status).toBe(
      'NEEDS_REVERSAL',
    );
    expect((await h.disbursementRepo.findById('disb-tenantB-2', TENANT_B))?.status).toBe(
      'NEEDS_REVERSAL',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────
// F2 — a failed reversal is RETRIED on redelivery, not permanently suppressed
// ───────────────────────────────────────────────────────────────────────

describe('F2 — failed reversal is retried on redelivery (claim-after-commit)', () => {
  let h: Harness;
  let store: InMemoryWebhookDedupeStore;
  beforeEach(async () => {
    h = await makeHarness();
    store = new InMemoryWebhookDedupeStore();
  });

  it('a reversal that throws (unresolved accounts) does NOT commit the claim; the redelivery posts the reversal', async () => {
    await seedHolding(h, 1_000_000);
    await seedNeedsReversalDisbursement(h.disbursementRepo, 30_000);

    // The reversal-account resolver FAILS on the first delivery (accounts not
    // yet resolvable) and SUCCEEDS on the redelivery.
    let resolveCalls = 0;
    const flakyDeps: ProcessB2cResultDeps = {
      ledgerService: h.ledgerService,
      disbursementRepository: h.disbursementRepo,
      dedupeStore: store,
      resolveReversalAccounts: async () => {
        resolveCalls += 1;
        if (resolveCalls === 1) {
          return { platformHoldingAccountId: null, ownerOperatingAccountId: null };
        }
        return {
          platformHoldingAccountId: CLEARING_ACCOUNT_ID,
          ownerOperatingAccountId: OWNER_OPERATING_ID,
        };
      },
      logger: silentLogger(),
    };

    const body = {
      Result: {
        ResultCode: 2001, // confirmed non-delivery → reversal path
        ResultDesc: 'The initiator information is invalid.',
        ConversationID: B2C_CONVERSATION_ID,
        OriginatorConversationID: 'disb-disb-legacy-wh-1',
        TransactionID: 'QGH7FRETRY',
      },
    };

    // Delivery 1 — finalizeReversal throws (no accounts). The disbursement
    // stays NEEDS_REVERSAL and — critically — the dedupe claim is NOT committed.
    await expect(
      processB2cResult(parseB2cResult(body)!, flakyDeps),
    ).rejects.toThrow(/reversal account/i);
    const afterFirst = await h.disbursementRepo.findById('disb-legacy-wh-1', TENANT_ID);
    expect(afterFirst?.status).toBe('NEEDS_REVERSAL'); // still owed back
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0); // no reversal yet

    // Delivery 2 (Safaricom redelivery) — the claim was NOT suppressed, so the
    // reversal is RE-ATTEMPTED and now succeeds. Owner stays whole.
    const second = await processB2cResult(parseB2cResult(body)!, flakyDeps);
    expect(second.status).toBe('reversed');
    const afterSecond = await h.disbursementRepo.findById('disb-legacy-wh-1', TENANT_ID);
    expect(afterSecond?.status).toBe('FAILED');
    // Exactly ONE compensating reversal landed; money returned to holding.
    expect(
      (await h.ledgerRepo.findByAccount(OWNER_OPERATING_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
    const holding = await h.accountRepo.findById(CLEARING_ACCOUNT_ID, TENANT_ID);
    expect(holding?.balanceMinorUnits).toBe(1_000_000 + 30_000);
  });
});
