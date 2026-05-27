/**
 * M-Pesa adapter — end-to-end integration tests against the mock client.
 *
 * Exercises the FULL code path: initiateStkPush → enqueued callback →
 * webhook handler → LedgerService.postJournalEntry. NO live keys, NO
 * network. The mock client is the default and runs hermetically.
 *
 * The ledger uses the in-memory repositories so tests own state.
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
  MockMpesaClient,
  createMpesaClient,
  initiateStkPush,
  normalisePhone,
  handleMpesaWebhook,
  verifyMpesaSignature,
  type MpesaTenantContext,
} from '../../providers/mpesa';
import { createHmac } from 'node:crypto';

const TENANT_ID = 'tenant-mpesa-1' as TenantId;
const CUSTOMER_ID = 'cust-mpesa-1' as CustomerId;
const CUSTOMER_ACCOUNT_ID = 'acct-cust-mpesa-1' as AccountId;
const CLEARING_ACCOUNT_ID = 'acct-cash-clearing-mpesa-1' as AccountId;

interface Harness {
  client: MockMpesaClient;
  ledgerService: LedgerService;
  ledgerRepo: InMemoryLedgerRepository;
  accountRepo: InMemoryAccountRepository;
  tenantContext: MpesaTenantContext;
}

async function makeHarness(): Promise<Harness> {
  const ledgerRepo = new InMemoryLedgerRepository();
  const accountRepo = new InMemoryAccountRepository();
  const eventPublisher = new InMemoryEventPublisher();
  const ledgerService = new LedgerService({
    ledgerRepository: ledgerRepo,
    accountRepository: accountRepo,
    eventPublisher,
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
      'KES',
      'test',
    ),
  );
  await accountRepo.create(
    createCustomerLiabilityAccount(
      CLEARING_ACCOUNT_ID,
      TENANT_ID,
      'platform-clearing' as CustomerId,
      'KES',
      'test',
    ),
  );
  const client = new MockMpesaClient();
  const tenantContext: MpesaTenantContext = {
    tenantId: TENANT_ID,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    cashClearingAccountId: CLEARING_ACCOUNT_ID,
    currency: 'KES',
  };
  return { client, ledgerService, ledgerRepo, accountRepo, tenantContext };
}

describe('M-Pesa STK Push — initiateStkPush', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness();
  });

  it('initiates a happy-path STK push and enqueues a callback in mock mode', async () => {
    const result = await initiateStkPush(
      {
        amount: 1500,
        currency: 'KES',
        phoneNumber: '+254712345678',
        accountReference: 'BORJIE',
        transactionDesc: 'Rent May',
        callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
        businessShortCode: '174379',
      },
      { client: harness.client },
    );
    expect(result.mode).toBe('mock');
    expect(result.checkoutRequestId).toMatch(/^ws_CO_/);
    expect(harness.client.pendingCallbackCount()).toBe(1);
  });

  it('rejects negative amounts via zod', async () => {
    await expect(
      initiateStkPush(
        {
          amount: -100,
          currency: 'KES',
          phoneNumber: '+254712345678',
          accountReference: 'BORJIE',
          transactionDesc: 'Rent',
          callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
          businessShortCode: '174379',
        },
        { client: harness.client },
      ),
    ).rejects.toThrow(/Invalid STK push input/);
  });

  it('rejects unsupported currency at validation', async () => {
    await expect(
      initiateStkPush(
        {
          amount: 1500,
          currency: 'USD',
          phoneNumber: '+254712345678',
          accountReference: 'BORJIE',
          transactionDesc: 'Rent',
          callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
          businessShortCode: '174379',
        },
        { client: harness.client },
      ),
    ).rejects.toThrow(/Invalid STK push input/);
  });

  it('rejects invalid phone numbers', async () => {
    await expect(
      initiateStkPush(
        {
          amount: 1500,
          currency: 'KES',
          phoneNumber: 'not-a-phone',
          accountReference: 'BORJIE',
          transactionDesc: 'Rent',
          callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
          businessShortCode: '174379',
        },
        { client: harness.client },
      ),
    ).rejects.toThrow(/Invalid STK push input/);
  });

  it('normalises 07-prefixed Kenyan phone numbers to 254-prefixed', () => {
    expect(normalisePhone('0712345678')).toBe('254712345678');
    expect(normalisePhone('+254 712 345 678')).toBe('254712345678');
    expect(normalisePhone('712345678')).toBe('254712345678');
  });
});

describe('M-Pesa webhook handler — happy path', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness();
  });

  it('posts a balanced journal entry via LedgerService on successful callback', async () => {
    await initiateStkPush(
      {
        amount: 2500,
        currency: 'KES',
        phoneNumber: '+254712345678',
        accountReference: 'BORJIE',
        transactionDesc: 'Rent',
        callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
        businessShortCode: '174379',
      },
      { client: harness.client },
    );
    const [callback] = harness.client.drainCallbacks();
    expect(callback).toBeDefined();

    const seen = new Set<string>();
    const result = await handleMpesaWebhook(
      JSON.stringify(callback.payload),
      {},
      {
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenIds: seen,
        skipSignatureCheck: true,
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
      expect(debit?.amount.amountMinorUnits).toBe(credit?.amount.amountMinorUnits);
      expect(debit?.amount.amountMinorUnits).toBe(2500 * 100);
    }
  });

  it('updates account balance on the customer account', async () => {
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
      { client: harness.client },
    );
    const [callback] = harness.client.drainCallbacks();
    await handleMpesaWebhook(
      JSON.stringify(callback.payload),
      {},
      {
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenIds: new Set(),
        skipSignatureCheck: true,
      },
    );
    const customerBalance = await harness.ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(customerBalance).not.toBeNull();
    expect(customerBalance!.amountMinorUnits).toBe(-1000 * 100);
  });
});

describe('M-Pesa webhook handler — failure paths', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness();
  });

  it('rejects malformed JSON without touching the ledger', async () => {
    const result = await handleMpesaWebhook(
      'not-json',
      {},
      {
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenIds: new Set(),
        skipSignatureCheck: true,
      },
    );
    expect(result).toEqual({ status: 'rejected', reason: 'invalid-json' });
  });

  it('rejects when the parsed shape does not match Daraja schema', async () => {
    const result = await handleMpesaWebhook(
      JSON.stringify({ Body: { wrong: 'shape' } }),
      {},
      {
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenIds: new Set(),
        skipSignatureCheck: true,
      },
    );
    expect(result).toEqual({ status: 'rejected', reason: 'invalid-shape' });
  });

  it('skips ledger when callback reports a failed payment (ResultCode != 0)', async () => {
    const failClient = new MockMpesaClient({
      scenarios: { '254700000000': { forceResultCode: 1032, forceResultDesc: 'User cancelled' } },
    });
    await initiateStkPush(
      {
        amount: 500,
        currency: 'KES',
        phoneNumber: '+254700000000',
        accountReference: 'BORJIE',
        transactionDesc: 'Rent',
        callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
        businessShortCode: '174379',
      },
      { client: failClient },
    );
    const [callback] = failClient.drainCallbacks();
    const result = await handleMpesaWebhook(
      JSON.stringify(callback.payload),
      {},
      {
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => harness.tenantContext,
        seenIds: new Set(),
        skipSignatureCheck: true,
      },
    );
    expect(result.status).toBe('failed-payment');
    const balance = await harness.ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance?.amountMinorUnits ?? 0).toBe(0);
  });

  it('returns no-tenant when the resolver cannot find the tenant', async () => {
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
      { client: harness.client },
    );
    const [callback] = harness.client.drainCallbacks();
    const result = await handleMpesaWebhook(
      JSON.stringify(callback.payload),
      {},
      {
        ledgerService: harness.ledgerService,
        resolveTenantContext: async () => null,
        seenIds: new Set(),
        skipSignatureCheck: true,
      },
    );
    expect(result.status).toBe('no-tenant');
  });
});

describe('M-Pesa webhook idempotency', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await makeHarness();
  });

  it('re-firing the same callback twice posts only ONE journal entry', async () => {
    await initiateStkPush(
      {
        amount: 3000,
        currency: 'KES',
        phoneNumber: '+254712345678',
        accountReference: 'BORJIE',
        transactionDesc: 'Rent',
        callbackUrl: 'https://api.borjie.test/webhooks/mpesa/stk',
        businessShortCode: '174379',
      },
      { client: harness.client },
    );
    const [callback] = harness.client.drainCallbacks();
    const seen = new Set<string>();
    const deps = {
      ledgerService: harness.ledgerService,
      resolveTenantContext: async () => harness.tenantContext,
      seenIds: seen,
      skipSignatureCheck: true,
    };
    const first = await handleMpesaWebhook(
      JSON.stringify(callback.payload),
      {},
      deps,
    );
    const second = await handleMpesaWebhook(
      JSON.stringify(callback.payload),
      {},
      deps,
    );
    expect(first.status).toBe('posted');
    expect(second.status).toBe('duplicate');
    const balance = await harness.ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance?.amountMinorUnits).toBe(-3000 * 100);
  });
});

describe('M-Pesa HMAC signature verification', () => {
  it('accepts a freshly-signed payload', () => {
    const body = '{"Body":{"stkCallback":{"ResultCode":0}}}';
    const ts = Date.now();
    const secret = 'shh';
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(
      verifyMpesaSignature(body, { signature: sig, timestamp: String(ts) }, secret),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"Body":{"stkCallback":{"ResultCode":0}}}';
    const ts = Date.now();
    const secret = 'shh';
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(
      verifyMpesaSignature(
        '{"tampered":true}',
        { signature: sig, timestamp: String(ts) },
        secret,
      ),
    ).toBe(false);
  });

  it('rejects a stale timestamp outside the 5-minute window', () => {
    const body = '{"Body":{"stkCallback":{"ResultCode":0}}}';
    const ts = Date.now() - 10 * 60 * 1000;
    const secret = 'shh';
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(
      verifyMpesaSignature(body, { signature: sig, timestamp: String(ts) }, secret),
    ).toBe(false);
  });

  it('handler rejects when signature missing in live mode', async () => {
    const ledgerRepo = new InMemoryLedgerRepository();
    const accountRepo = new InMemoryAccountRepository();
    const ledgerService = new LedgerService({
      ledgerRepository: ledgerRepo,
      accountRepository: accountRepo,
      eventPublisher: new InMemoryEventPublisher(),
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    const result = await handleMpesaWebhook(
      '{"Body":{"stkCallback":{"ResultCode":0,"MerchantRequestID":"m","CheckoutRequestID":"c","ResultDesc":"ok"}}}',
      {},
      {
        ledgerService,
        resolveTenantContext: async () => null,
        seenIds: new Set(),
        skipSignatureCheck: false,
        webhookSecret: 'shh',
      },
    );
    expect(result.status).toBe('rejected');
  });
});

describe('M-Pesa B2C (refund-style) flow', () => {
  it('the mock client returns a deterministic conversation id for B2C', async () => {
    const client = new MockMpesaClient();
    const result = await client.b2c({
      amount: 100,
      partyA: '174379',
      partyB: '254712345678',
      remarks: 'Refund',
      resultUrl: 'https://api.borjie.test/webhooks/mpesa/b2c/result',
      queueTimeOutUrl: 'https://api.borjie.test/webhooks/mpesa/b2c/timeout',
    });
    expect(result.responseCode).toBe('0');
    expect(result.conversationId).toMatch(/^AG_/);
  });
});

describe('M-Pesa factory env switching', () => {
  it('returns the mock client by default', () => {
    const client = createMpesaClient({ env: {} });
    expect(client.mode).toBe('mock');
  });

  it('throws when live mode requested with missing creds', () => {
    expect(() =>
      createMpesaClient({ env: { MPESA_LIVE_KEYS_PRESENT: 'true' } }),
    ).toThrow(/MPESA_LIVE_KEYS_PRESENT=true but/);
  });

  it('returns the live client when all creds are present', () => {
    const client = createMpesaClient({
      env: {
        MPESA_LIVE_KEYS_PRESENT: 'true',
        MPESA_CONSUMER_KEY: 'k',
        MPESA_CONSUMER_SECRET: 's',
        MPESA_SHORT_CODE: '174379',
        MPESA_PASS_KEY: 'pk',
      },
    });
    expect(client.mode).toBe('live');
  });
});
