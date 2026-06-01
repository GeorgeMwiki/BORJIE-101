/**
 * Durable webhook idempotency + M-Pesa failure classification
 * (EDGE-HARDENING #3 + #5) — end-to-end against in-memory ledger.
 *
 * The cross-restart scenario is modelled by REPLACING the per-handler
 * `Set` with a DURABLE {@link WebhookDedupeStore} that PERSISTS across two
 * separately-constructed handler invocations (a "restart"). A redelivered
 * Stripe/M-Pesa event with the same id must process EXACTLY ONCE — the
 * second delivery is dropped as a duplicate AND, even if it slipped past,
 * the ledger idempotency key keyed on the event id blocks a double-credit.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  type AccountId,
  type CustomerId,
  type TenantId,
  createCustomerLiabilityAccount,
} from '@borjie/domain-models';
import { LedgerService } from '../services/ledger.service.js';
import { InMemoryLedgerRepository } from '../repositories/ledger.repository.js';
import { InMemoryAccountRepository } from '../repositories/account.repository.js';
import { InMemoryEventPublisher } from '../events/event-publisher.js';
import {
  MockMpesaClient,
  initiateStkPush,
  handleMpesaWebhook,
  type MpesaTenantContext,
  type MpesaWebhookHandlerDeps,
} from '../providers/mpesa/index.js';
import {
  MockStripeClient,
  createCheckoutSession,
  handleStripeWebhook,
  type StripeTenantContext,
  type StripeWebhookHandlerDeps,
} from '../providers/stripe/index.js';
import { InMemoryWebhookDedupeStore } from '../providers/webhook-dedupe-store.js';

const TENANT_ID = 'tenant-dur-wh-1' as TenantId;
const CUSTOMER_ID = 'cust-dur-wh-1' as CustomerId;
const CUSTOMER_ACCOUNT_ID = 'acct-cust-dur-wh-1' as AccountId;
const CLEARING_ACCOUNT_ID = 'acct-clearing-dur-wh-1' as AccountId;

function silentLogger() {
  return { info: () => undefined, warn: () => undefined, error: () => undefined };
}

async function makeLedger(currency: 'KES' | 'USD') {
  const ledgerRepo = new InMemoryLedgerRepository();
  const accountRepo = new InMemoryAccountRepository();
  const ledgerService = new LedgerService({
    ledgerRepository: ledgerRepo,
    accountRepository: accountRepo,
    eventPublisher: new InMemoryEventPublisher(),
    logger: silentLogger(),
  });
  await accountRepo.create(
    createCustomerLiabilityAccount(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
      CUSTOMER_ID,
      currency,
      'test',
    ),
  );
  await accountRepo.create(
    createCustomerLiabilityAccount(
      CLEARING_ACCOUNT_ID,
      TENANT_ID,
      'platform-clearing' as CustomerId,
      currency,
      'test',
    ),
  );
  return { ledgerService, ledgerRepo, accountRepo };
}

// ────────────────────────────────────────────────────────────────────
// #3 — durable dedupe survives a "restart" (M-Pesa)
// ────────────────────────────────────────────────────────────────────

describe('EDGE-HARDENING #3 — durable M-Pesa dedupe across a restart', () => {
  it('a redelivered STK callback (same id) posts ONE journal across a simulated restart', async () => {
    const { ledgerService, accountRepo, ledgerRepo } = await makeLedger('KES');
    const tenantContext: MpesaTenantContext = {
      tenantId: TENANT_ID,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      cashClearingAccountId: CLEARING_ACCOUNT_ID,
      currency: 'KES',
    };

    const client = new MockMpesaClient();
    await initiateStkPush(
      {
        amount: 2000,
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
    const raw = JSON.stringify(callback.payload);

    // The durable store PERSISTS across the two deliveries. Each delivery
    // builds its OWN deps (no shared Set) — modelling two pods / a restart.
    const dedupeStore = new InMemoryWebhookDedupeStore();
    const depsFor = (): MpesaWebhookHandlerDeps => ({
      ledgerService,
      resolveTenantContext: async () => tenantContext,
      dedupeStore,
      skipSignatureCheck: true,
    });

    const first = await handleMpesaWebhook(raw, {}, depsFor());
    // "Restart": fresh deps, but the durable store remembers the claim.
    const second = await handleMpesaWebhook(raw, {}, depsFor());

    expect(first.status).toBe('posted');
    expect(second.status).toBe('duplicate');

    // Exactly ONE credit landed.
    const balance = await ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance?.amountMinorUnits).toBe(-2000 * 100);
    expect(
      (await ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
    expect(
      (await ledgerRepo.findByAccount(CLEARING_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
    // Sanity: stored balance == sum(entries) for the clearing account too.
    const clearing = await accountRepo.findById(CLEARING_ACCOUNT_ID, TENANT_ID);
    expect(clearing?.balanceMinorUnits).toBe(2000 * 100);
  });

  it('even if the durable claim is LOST, the ledger key blocks a double-credit', async () => {
    // Models a crash strictly between (claim committed) and (ledger posted)
    // followed by a redelivery that bypasses the claim: a FRESH store every
    // delivery. The webhook claim never reports a duplicate, but the ledger
    // idempotency key keyed on the CheckoutRequestID is the post-once
    // backstop, so still ONE credit.
    const { ledgerService, ledgerRepo } = await makeLedger('KES');
    const tenantContext: MpesaTenantContext = {
      tenantId: TENANT_ID,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      cashClearingAccountId: CLEARING_ACCOUNT_ID,
      currency: 'KES',
    };
    const client = new MockMpesaClient();
    await initiateStkPush(
      {
        amount: 1500,
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
    const raw = JSON.stringify(callback.payload);

    const depsLostStore = (): MpesaWebhookHandlerDeps => ({
      ledgerService,
      resolveTenantContext: async () => tenantContext,
      // FRESH store each time → the claim is "lost".
      dedupeStore: new InMemoryWebhookDedupeStore(),
      skipSignatureCheck: true,
    });

    const first = await handleMpesaWebhook(raw, {}, depsLostStore());
    const second = await handleMpesaWebhook(raw, {}, depsLostStore());

    expect(first.status).toBe('posted');
    // The claim was lost so the handler PROCESSED again, but the ledger
    // served an idempotent replay → still posted (same journal), no double.
    expect(second.status).toBe('posted');
    if (first.status === 'posted' && second.status === 'posted') {
      expect(second.journalId).toBe(first.journalId);
    }
    const balance = await ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance?.amountMinorUnits).toBe(-1500 * 100);
    expect(
      (await ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// #3 — durable dedupe survives a "restart" (Stripe)
// ────────────────────────────────────────────────────────────────────

describe('EDGE-HARDENING #3 — durable Stripe dedupe across a restart', () => {
  it('a redelivered checkout.session.completed posts ONE journal across a simulated restart', async () => {
    const { ledgerService, ledgerRepo } = await makeLedger('USD');
    const tenantContext: StripeTenantContext = {
      tenantId: TENANT_ID,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      cashClearingAccountId: CLEARING_ACCOUNT_ID,
      currency: 'USD',
    };
    const client = new MockStripeClient();
    await createCheckoutSession(
      {
        amountMinor: 7_500,
        currency: 'USD',
        successUrl: 'https://borjie.test/success',
        cancelUrl: 'https://borjie.test/cancel',
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
      },
      { client },
    );
    const [webhook] = client.drainWebhooks();
    const raw = JSON.stringify(webhook.payload);

    const dedupeStore = new InMemoryWebhookDedupeStore();
    const depsFor = (): StripeWebhookHandlerDeps => ({
      client,
      ledgerService,
      resolveTenantContext: async () => tenantContext,
      dedupeStore,
    });

    const first = await handleStripeWebhook(raw, 'sig', depsFor());
    const second = await handleStripeWebhook(raw, 'sig', depsFor());

    expect(first.status).toBe('posted');
    expect(second).toEqual({ status: 'duplicate' });

    const balance = await ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance?.amountMinorUnits).toBe(-7_500);
    expect(
      (await ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// #5 — M-Pesa ResultCode failure classification
// ────────────────────────────────────────────────────────────────────

describe('EDGE-HARDENING #5 — M-Pesa ResultCode failure classification', () => {
  let ledgerService: LedgerService;
  let ledgerRepo: InMemoryLedgerRepository;
  let tenantContext: MpesaTenantContext;

  beforeEach(async () => {
    const made = await makeLedger('KES');
    ledgerService = made.ledgerService;
    ledgerRepo = made.ledgerRepo;
    tenantContext = {
      tenantId: TENANT_ID,
      customerAccountId: CUSTOMER_ACCOUNT_ID,
      cashClearingAccountId: CLEARING_ACCOUNT_ID,
      currency: 'KES',
    };
  });

  it('a non-zero ResultCode marks the payment FAILED, posts NO credit, and calls the failure sink', async () => {
    const failures: Array<{ resultCode: number; failureReason: string }> = [];
    const client = new MockMpesaClient({
      scenarios: {
        '254700000000': { forceResultCode: 1, forceResultDesc: 'Insufficient balance' },
      },
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

    const result = await handleMpesaWebhook(JSON.stringify(callback.payload), {}, {
      ledgerService,
      resolveTenantContext: async () => tenantContext,
      dedupeStore: new InMemoryWebhookDedupeStore(),
      skipSignatureCheck: true,
      onPaymentFailed: async (f) => {
        failures.push({ resultCode: f.resultCode, failureReason: f.failureReason });
      },
    });

    expect(result.status).toBe('failed-payment');
    if (result.status === 'failed-payment') {
      expect(result.resultCode).toBe(1);
      expect(result.failureReason).toBe('insufficient-balance');
    }
    // The failure sink fired with the code-derived reason.
    expect(failures).toEqual([{ resultCode: 1, failureReason: 'insufficient-balance' }]);
    // NO ledger credit — both accounts have zero entries.
    expect(
      (await ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
    const balance = await ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance?.amountMinorUnits ?? 0).toBe(0);
  });

  it('a success ResultCode whose AMOUNT does not reconcile is treated as FAILED (mis-credit guard)', async () => {
    const failures: string[] = [];
    const client = new MockMpesaClient(); // success, amount = 1000
    await initiateStkPush(
      {
        amount: 1000,
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

    // Resolver pins a DIFFERENT expected amount (minor units) → mismatch.
    const result = await handleMpesaWebhook(JSON.stringify(callback.payload), {}, {
      ledgerService,
      resolveTenantContext: async () => ({
        ...tenantContext,
        expectedAmountMinorUnits: 5000 * 100, // expected 5000, got 1000
      }),
      dedupeStore: new InMemoryWebhookDedupeStore(),
      skipSignatureCheck: true,
      onPaymentFailed: async (f) => failures.push(f.failureReason),
    });

    expect(result.status).toBe('failed-payment');
    if (result.status === 'failed-payment') {
      expect(result.failureReason).toMatch(/^amount-mismatch:/);
    }
    expect(failures[0]).toMatch(/^amount-mismatch:/);
    // NO credit despite ResultCode 0.
    expect(
      (await ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
  });

  it('F5 — a transient failure-sink throw does NOT commit the dedupe claim; the redelivery still marks the intent FAILED', async () => {
    // Build a FAILED STK callback (non-zero ResultCode → the onPaymentFailed
    // sink path). The sink THROWS on the first delivery (a transient outage),
    // then succeeds on the redelivery.
    const client = new MockMpesaClient({
      scenarios: {
        '254700000000': { forceResultCode: 1, forceResultDesc: 'Insufficient balance' },
      },
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
    const raw = JSON.stringify(callback.payload);

    // The DURABLE store persists across both deliveries (models a redelivery
    // after a restart / on another replica). If the claim were recorded BEFORE
    // the sink (the old order), the first delivery's sink throw would still
    // leave the claim committed → the redelivery would be dropped as a
    // duplicate and the intent would be stranded PENDING.
    const dedupeStore = new InMemoryWebhookDedupeStore();
    let sinkCalls = 0;
    let markedFailed = false;
    const depsFor = (failFirst: boolean): MpesaWebhookHandlerDeps => ({
      ledgerService,
      resolveTenantContext: async () => tenantContext,
      dedupeStore,
      skipSignatureCheck: true,
      onPaymentFailed: async () => {
        sinkCalls += 1;
        if (failFirst && sinkCalls === 1) {
          // Transient sink outage on the first delivery.
          throw new Error('intent store unavailable (transient)');
        }
        markedFailed = true;
      },
    });

    // Delivery 1 — the sink throws; the handler must PROPAGATE (not swallow),
    // and crucially must NOT have committed the dedupe claim first.
    await expect(handleMpesaWebhook(raw, {}, depsFor(true))).rejects.toThrow(
      /transient/,
    );
    expect(markedFailed).toBe(false);

    // Delivery 2 (Safaricom redelivery) — the sink now succeeds. Because the
    // claim was NOT committed on delivery 1, the redelivery is processed and
    // the intent is marked FAILED (the terminal-state write is NOT swallowed).
    const second = await handleMpesaWebhook(raw, {}, depsFor(false));
    expect(second.status).toBe('failed-payment');
    expect(markedFailed).toBe(true);
    expect(sinkCalls).toBe(2);

    // No credit on either delivery (failed STK never credits).
    expect(
      (await ledgerRepo.findByAccount(CUSTOMER_ACCOUNT_ID, TENANT_ID, 1, 100)).total,
    ).toBe(0);
  });

  it('a success whose amount DOES reconcile still posts the credit', async () => {
    const client = new MockMpesaClient(); // success, amount = 1000
    await initiateStkPush(
      {
        amount: 1000,
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
    const result = await handleMpesaWebhook(JSON.stringify(callback.payload), {}, {
      ledgerService,
      resolveTenantContext: async () => ({
        ...tenantContext,
        expectedAmountMinorUnits: 1000 * 100, // matches
      }),
      dedupeStore: new InMemoryWebhookDedupeStore(),
      skipSignatureCheck: true,
    });
    expect(result.status).toBe('posted');
    const balance = await ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance?.amountMinorUnits).toBe(-1000 * 100);
  });
});
