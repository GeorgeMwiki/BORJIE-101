/**
 * Stripe adapter — end-to-end integration tests against the mock client.
 *
 * Exercises the FULL code path: createCheckoutSession → enqueued webhook
 * → handleStripeWebhook → LedgerService.postJournalEntry. NO live keys,
 * NO network. Mock mode is default; live mode opt-in via env.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountId,
  type CustomerId,
  type TenantId,
} from '@borjie/domain-models';
import { createCustomerLiabilityAccount } from '@borjie/domain-models';
import { LedgerService } from '../../services/ledger.service';
import { InMemoryLedgerRepository } from '../../repositories/ledger.repository';
import { InMemoryAccountRepository } from '../../repositories/account.repository';
import { InMemoryEventPublisher } from '../../events/event-publisher';
import {
  MockStripeClient,
  createStripeClient,
  createCheckoutSession,
  handleStripeWebhook,
  type StripeTenantContext,
  type StripeWebhookEvent,
} from '../../providers/stripe';

const TENANT_ID = 'tenant-stripe-1' as TenantId;
const CUSTOMER_ID = 'cust-stripe-1' as CustomerId;
const CUSTOMER_ACCOUNT_ID = 'acct-cust-stripe-1' as AccountId;
const CLEARING_ACCOUNT_ID = 'acct-cash-clearing-stripe-1' as AccountId;

interface Harness {
  client: MockStripeClient;
  ledgerService: LedgerService;
  tenantContext: StripeTenantContext;
}

async function makeHarness(currency: 'USD' | 'KES' = 'USD'): Promise<Harness> {
  const ledgerRepo = new InMemoryLedgerRepository();
  const accountRepo = new InMemoryAccountRepository();
  const ledgerService = new LedgerService({
    ledgerRepository: ledgerRepo,
    accountRepository: accountRepo,
    eventPublisher: new InMemoryEventPublisher(),
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
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
  const client = new MockStripeClient();
  const tenantContext: StripeTenantContext = {
    tenantId: TENANT_ID,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    cashClearingAccountId: CLEARING_ACCOUNT_ID,
    currency,
  };
  return { client, ledgerService, tenantContext };
}

describe('Stripe checkout session — createCheckoutSession', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness('USD');
  });

  it('creates a happy-path checkout session and enqueues a completed event', async () => {
    const result = await createCheckoutSession(
      {
        amountMinor: 5_000,
        currency: 'USD',
        customerEmail: 'test@borjie.io',
        successUrl: 'https://borjie.test/success',
        cancelUrl: 'https://borjie.test/cancel',
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
      },
      { client: harness.client },
    );
    expect(result.mode).toBe('mock');
    expect(result.sessionId).toMatch(/^cs_test_/);
    expect(harness.client.pendingWebhookCount()).toBe(1);
  });

  it('rejects negative amount', async () => {
    await expect(
      createCheckoutSession(
        {
          amountMinor: -100,
          currency: 'USD',
          successUrl: 'https://borjie.test/success',
          cancelUrl: 'https://borjie.test/cancel',
          tenantId: TENANT_ID,
          customerId: CUSTOMER_ID,
        },
        { client: harness.client },
      ),
    ).rejects.toThrow(/Invalid Stripe checkout input/);
  });

  it('rejects unsupported currency', async () => {
    await expect(
      createCheckoutSession(
        {
          amountMinor: 5_000,
          currency: 'BTC' as 'USD',
          successUrl: 'https://borjie.test/success',
          cancelUrl: 'https://borjie.test/cancel',
          tenantId: TENANT_ID,
          customerId: CUSTOMER_ID,
        },
        { client: harness.client },
      ),
    ).rejects.toThrow(/Invalid Stripe checkout input/);
  });

  it('rejects bad URLs', async () => {
    await expect(
      createCheckoutSession(
        {
          amountMinor: 5_000,
          currency: 'USD',
          successUrl: 'not-a-url',
          cancelUrl: 'https://borjie.test/cancel',
          tenantId: TENANT_ID,
          customerId: CUSTOMER_ID,
        },
        { client: harness.client },
      ),
    ).rejects.toThrow(/Invalid Stripe checkout input/);
  });
});

describe('Stripe webhook handler — happy path', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness('USD');
  });

  it('posts a balanced journal entry via LedgerService on completed event', async () => {
    await createCheckoutSession(
      {
        amountMinor: 12_500,
        currency: 'USD',
        successUrl: 'https://borjie.test/success',
        cancelUrl: 'https://borjie.test/cancel',
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
      },
      { client: harness.client },
    );
    const [webhook] = harness.client.drainWebhooks();
    expect(webhook.type).toBe('checkout.session.completed');
    const result = await handleStripeWebhook(
      JSON.stringify(webhook.payload),
      'sig-mock',
      {
        client: harness.client,
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenEventIds: new Set(),
      },
    );
    expect(result.status).toBe('posted');
    if (result.status === 'posted') {
      const entries = await harness.ledgerService.getJournalEntries(
        result.journalId,
        TENANT_ID,
      );
      expect(entries).toHaveLength(2);
      const debit = entries.find((e) => e.direction === 'DEBIT');
      const credit = entries.find((e) => e.direction === 'CREDIT');
      expect(debit?.amount.amountMinorUnits).toBe(12_500);
      expect(credit?.amount.amountMinorUnits).toBe(12_500);
    }
  });

  it('updates account balance on the customer account', async () => {
    await createCheckoutSession(
      {
        amountMinor: 1_000,
        currency: 'USD',
        successUrl: 'https://borjie.test/success',
        cancelUrl: 'https://borjie.test/cancel',
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
      },
      { client: harness.client },
    );
    const [webhook] = harness.client.drainWebhooks();
    await handleStripeWebhook(
      JSON.stringify(webhook.payload),
      'sig-mock',
      {
        client: harness.client,
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenEventIds: new Set(),
      },
    );
    const balance = await harness.ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance!.amountMinorUnits).toBe(-1_000);
  });
});

describe('Stripe webhook handler — failure paths', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness('USD');
  });

  it('rejects when signature is empty (mock contract requires non-empty)', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_x',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_x',
          object: 'checkout.session',
          amount_total: 100,
          currency: 'usd',
          status: 'complete',
          metadata: {},
        },
      },
    };
    const result = await handleStripeWebhook(JSON.stringify(event), '', {
      client: harness.client,
      ledgerService: harness.ledgerService,
      resolveTenantContext: async () => harness.tenantContext,
      seenEventIds: new Set(),
    });
    expect(result.status).toBe('rejected');
  });

  it('rejects when amount or currency missing in payload', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_y',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_y',
          object: 'checkout.session',
          metadata: {},
        },
      },
    };
    const result = await handleStripeWebhook(JSON.stringify(event), 'sig', {
      client: harness.client,
      ledgerService: harness.ledgerService,
      resolveTenantContext: async () => harness.tenantContext,
      seenEventIds: new Set(),
    });
    expect(result).toEqual({ status: 'rejected', reason: 'missing-amount-or-currency' });
  });

  it('rejects when payload currency does not match tenant account currency', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_z',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_z',
          object: 'checkout.session',
          amount_total: 1000,
          currency: 'kes',
          status: 'complete',
          metadata: {},
        },
      },
    };
    const result = await handleStripeWebhook(JSON.stringify(event), 'sig', {
      client: harness.client,
      ledgerService: harness.ledgerService,
      resolveTenantContext: async () => harness.tenantContext, // USD
      seenEventIds: new Set(),
    });
    expect(result.status).toBe('rejected');
  });

  it('ignores event types that do not affect the ledger (e.g. expired)', async () => {
    const event: StripeWebhookEvent = {
      id: 'evt_exp',
      type: 'checkout.session.expired',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'cs_exp',
          object: 'checkout.session',
          amount_total: 1000,
          currency: 'usd',
          status: 'expired',
          metadata: {},
        },
      },
    };
    const result = await handleStripeWebhook(JSON.stringify(event), 'sig', {
      client: harness.client,
      ledgerService: harness.ledgerService,
      resolveTenantContext: async () => harness.tenantContext,
      seenEventIds: new Set(),
    });
    expect(result).toEqual({ status: 'ignored', reason: 'checkout.session.expired' });
  });
});

describe('Stripe webhook idempotency', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness('USD');
  });

  it('replaying the same eventId twice posts only ONE journal entry', async () => {
    await createCheckoutSession(
      {
        amountMinor: 4_000,
        currency: 'USD',
        successUrl: 'https://borjie.test/success',
        cancelUrl: 'https://borjie.test/cancel',
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
      },
      { client: harness.client },
    );
    const [webhook] = harness.client.drainWebhooks();
    const seen = new Set<string>();
    const deps = {
      client: harness.client,
      ledgerService: harness.ledgerService,
      resolveTenantContext: async () => harness.tenantContext,
      seenEventIds: seen,
    };
    const first = await handleStripeWebhook(
      JSON.stringify(webhook.payload),
      'sig',
      deps,
    );
    const second = await handleStripeWebhook(
      JSON.stringify(webhook.payload),
      'sig',
      deps,
    );
    expect(first.status).toBe('posted');
    expect(second).toEqual({ status: 'duplicate' });
    const balance = await harness.ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance!.amountMinorUnits).toBe(-4_000);
  });
});

describe('Stripe refund flow', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness('USD');
  });

  it('posts a reversing journal entry on charge.refunded', async () => {
    // First, charge to give the customer a non-zero balance
    await createCheckoutSession(
      {
        amountMinor: 6_000,
        currency: 'USD',
        successUrl: 'https://borjie.test/success',
        cancelUrl: 'https://borjie.test/cancel',
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
      },
      { client: harness.client },
    );
    const [chargeWebhook] = harness.client.drainWebhooks();
    const seen = new Set<string>();
    await handleStripeWebhook(JSON.stringify(chargeWebhook.payload), 'sig', {
      client: harness.client,
      ledgerService: harness.ledgerService,
      resolveTenantContext: async () => harness.tenantContext,
      seenEventIds: seen,
    });

    // Now issue a refund
    await harness.client.refund({
      paymentIntentId: 'pi_mock',
      amount: 6_000,
      reason: 'requested_by_customer',
    });
    const [refundWebhook] = harness.client.drainWebhooks();
    const result = await handleStripeWebhook(
      JSON.stringify(refundWebhook.payload),
      'sig',
      {
        client: harness.client,
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenEventIds: seen,
      },
    );
    expect(result.status).toBe('refunded');
    const balance = await harness.ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance!.amountMinorUnits).toBe(0);
  });
});

describe('Stripe factory env switching', () => {
  it('returns the mock client by default', () => {
    const client = createStripeClient({ env: {} });
    expect(client.mode).toBe('mock');
  });

  it('throws when live mode requested with missing creds', () => {
    expect(() =>
      createStripeClient({ env: { STRIPE_LIVE_KEYS_PRESENT: 'true' } }),
    ).toThrow(/STRIPE_LIVE_KEYS_PRESENT=true but/);
  });
});
