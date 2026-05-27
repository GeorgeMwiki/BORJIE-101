/**
 * Tests for `/api/v1/payments` provider-backed routes.
 *
 * Exercises the gateway in isolation with mock M-Pesa + Stripe clients
 * and in-memory ledger. Verifies:
 *   - 401 when initiate is called without JWT
 *   - 400 on schema violations
 *   - happy path (mpesa + stripe) → 201 + provider correlation id
 *   - webhook 200 + ledger write on success
 *   - webhook 400 on bad payload
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt';
import { createPaymentsRouter } from '../routes/payments.hono';
import {
  type AccountId,
  type CustomerId,
  type TenantId,
} from '@borjie/domain-models';
import { createCustomerLiabilityAccount } from '@borjie/domain-models';
import { LedgerService } from '../../../payments-ledger/src/services/ledger.service';
import { InMemoryLedgerRepository } from '../../../payments-ledger/src/repositories/ledger.repository';
import { InMemoryAccountRepository } from '../../../payments-ledger/src/repositories/account.repository';
import { InMemoryEventPublisher } from '../../../payments-ledger/src/events/event-publisher';
import { MockMpesaClient } from '../../../payments-ledger/src/providers/mpesa';
import { MockStripeClient } from '../../../payments-ledger/src/providers/stripe';

const TENANT_ID = 'tn-pay-1' as TenantId;
const USER_ID = 'usr-pay-1';
const CUSTOMER_ACCOUNT_ID = 'acct-cust-pay-1' as AccountId;
const CLEARING_ACCOUNT_ID = 'acct-clear-pay-1' as AccountId;

async function buildHarness(currency: 'KES' | 'USD' = 'USD') {
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
      USER_ID as CustomerId,
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
  const mpesaClient = new MockMpesaClient();
  const stripeClient = new MockStripeClient();
  const tenantCtx = {
    tenantId: TENANT_ID,
    customerAccountId: CUSTOMER_ACCOUNT_ID,
    cashClearingAccountId: CLEARING_ACCOUNT_ID,
    currency,
  };
  const router = createPaymentsRouter({
    mpesaClient,
    stripeClient,
    ledgerService,
    resolveMpesaTenant: async () => tenantCtx,
    resolveStripeTenant: async () => tenantCtx,
    mpesaCallbackBaseUrl: 'https://api.borjie.test',
    stripeSuccessUrl: 'https://borjie.test/success',
    stripeCancelUrl: 'https://borjie.test/cancel',
    mpesaBusinessShortCode: '174379',
  });
  const app = new Hono();
  app.route('/payments', router);
  return { app, mpesaClient, stripeClient, ledgerService };
}

function mintJwt(tenantId: string = TENANT_ID): string {
  return jwt.sign(
    {
      userId: USER_ID,
      tenantId,
      role: 'TENANT_ADMIN',
      permissions: ['*'],
      propertyAccess: ['*'],
    },
    getJwtSecret(),
    { algorithm: 'HS256', expiresIn: '2h' },
  );
}

describe('POST /payments/initiate — auth', () => {
  it('returns 401 without a JWT', async () => {
    const { app } = await buildHarness('KES');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mpesa', amount: 100, currency: 'KES', payerPhone: '+254700000000' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /payments/initiate — validation', () => {
  it('returns 400 on invalid JSON', async () => {
    const { app } = await buildHarness('KES');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is missing or negative', async () => {
    const { app } = await buildHarness('KES');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'mpesa', amount: -1, currency: 'KES', payerPhone: '+254700000000' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when provider is unknown', async () => {
    const { app } = await buildHarness('KES');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'paypal', amount: 100, currency: 'USD' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when M-Pesa request omits payerPhone', async () => {
    const { app } = await buildHarness('KES');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'mpesa', amount: 100, currency: 'KES' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PAYER_PHONE_REQUIRED');
  });

  it('returns 400 when M-Pesa request uses non-KES currency', async () => {
    const { app } = await buildHarness('KES');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: 'mpesa', amount: 100, currency: 'USD', payerPhone: '+254700000000' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /payments/initiate — M-Pesa happy path', () => {
  it('returns 201 with a checkoutRequestId from the mock client', async () => {
    const { app, mpesaClient } = await buildHarness('KES');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'mpesa',
        amount: 2500,
        currency: 'KES',
        payerPhone: '+254712345678',
        description: 'Rent',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { provider: string; mode: string; checkoutRequestId: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('mpesa');
    expect(body.data.mode).toBe('mock');
    expect(body.data.checkoutRequestId).toMatch(/^ws_CO_/);
    expect(mpesaClient.pendingCallbackCount()).toBe(1);
  });
});

describe('POST /payments/initiate — Stripe happy path', () => {
  it('returns 201 with a sessionId from the mock client', async () => {
    const { app, stripeClient } = await buildHarness('USD');
    const res = await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'stripe',
        amount: 5000,
        currency: 'USD',
        payerEmail: 'pay@borjie.io',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { provider: string; mode: string; sessionId: string; url: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('stripe');
    expect(body.data.mode).toBe('mock');
    expect(body.data.sessionId).toMatch(/^cs_test_/);
    expect(body.data.url).toContain('checkout.stripe.com');
    expect(stripeClient.pendingWebhookCount()).toBe(1);
  });
});

describe('POST /payments/webhook/mpesa', () => {
  it('returns 200 and posts a journal entry on a successful callback', async () => {
    const { app, mpesaClient, ledgerService } = await buildHarness('KES');
    // First, initiate (this enqueues the callback)
    await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'mpesa',
        amount: 1000,
        currency: 'KES',
        payerPhone: '+254712345678',
      }),
    });
    const [callback] = mpesaClient.drainCallbacks();
    const res = await app.request('/payments/webhook/mpesa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(callback.payload),
    });
    expect(res.status).toBe(200);
    const balance = await ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance!.amountMinorUnits).toBe(-1000 * 100);
  });

  it('returns 401 when payload is malformed JSON', async () => {
    const { app } = await buildHarness('KES');
    const res = await app.request('/payments/webhook/mpesa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /payments/webhook/stripe', () => {
  it('returns 200 and posts a journal entry on checkout.session.completed', async () => {
    const { app, stripeClient, ledgerService } = await buildHarness('USD');
    await app.request('/payments/initiate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${mintJwt()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'stripe',
        amount: 2500,
        currency: 'USD',
      }),
    });
    const [webhook] = stripeClient.drainWebhooks();
    const res = await app.request('/payments/webhook/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'sig-mock',
      },
      body: JSON.stringify(webhook.payload),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; status: string };
    expect(body.success).toBe(true);
    expect(body.status).toBe('posted');
    const balance = await ledgerService.getAccountBalance(
      CUSTOMER_ACCOUNT_ID,
      TENANT_ID,
    );
    expect(balance!.amountMinorUnits).toBe(-2500);
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const { app } = await buildHarness('USD');
    const res = await app.request('/payments/webhook/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
          },
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_SIGNATURE');
  });
});
