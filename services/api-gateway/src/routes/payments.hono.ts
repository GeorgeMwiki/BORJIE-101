/**
 * /api/v1/payments — provider-backed payment initiation + webhook
 * receivers.
 *
 *   POST   /api/v1/payments/initiate           — start M-Pesa STK or Stripe checkout
 *   POST   /api/v1/payments/webhook/mpesa      — Daraja STK callback
 *   POST   /api/v1/payments/webhook/stripe     — Stripe webhook
 *
 * Routes never touch the database directly. The money path is:
 *
 *   initiate → provider client (mock | live)
 *   webhook  → provider client.verifySignature → handle{Mpesa,Stripe}Webhook
 *              → LedgerService.postJournalEntry
 *
 * The route's dependencies (clients, tenant resolvers, LedgerService)
 * are injected via {@link createPaymentsRouter}. Production wires the
 * Drizzle-backed services; tests wire in-memory ones.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
// Wave PAY-1: import the new provider adapters from their source paths
// (workspace symlink resolves `@borjie/payments-ledger-service` to the
// stale `dist/index.js` until the package is rebuilt — using the relative
// source path lets the gateway pick up the new exports immediately).
import type {
  IMpesaClient,
  MpesaTenantResolver,
} from '../../../payments-ledger/src/providers/mpesa';
import {
  initiateStkPush,
  handleMpesaWebhook,
} from '../../../payments-ledger/src/providers/mpesa';
import type {
  IStripeClient,
  StripeTenantResolver,
} from '../../../payments-ledger/src/providers/stripe';
import {
  createCheckoutSession,
  handleStripeWebhook,
} from '../../../payments-ledger/src/providers/stripe';
import type { LedgerService } from '../../../payments-ledger/src/services/ledger.service';

export interface PaymentsRouterDeps {
  readonly mpesaClient: IMpesaClient;
  readonly stripeClient: IStripeClient;
  readonly ledgerService: LedgerService;
  readonly resolveMpesaTenant: MpesaTenantResolver;
  readonly resolveStripeTenant: StripeTenantResolver;
  /** Public callback base URL — composed into Daraja CallBackURL. */
  readonly mpesaCallbackBaseUrl: string;
  /** Default success / cancel URLs for Stripe checkout when not provided. */
  readonly stripeSuccessUrl: string;
  readonly stripeCancelUrl: string;
  /** M-Pesa business shortcode (per-tenant in production; one for now). */
  readonly mpesaBusinessShortCode: string;
  /** HMAC secret for M-Pesa Daraja callback verification (live mode). */
  readonly mpesaWebhookSecret?: string;
}

const InitiateBaseSchema = z
  .object({
    amount: z.number().positive(),
    currency: z.enum(['USD', 'EUR', 'GBP', 'KES', 'TZS', 'UGX']),
    payerPhone: z
      .string()
      .regex(/^\+?[0-9]{9,15}$/)
      .optional(),
    payerEmail: z.string().email().optional(),
    description: z.string().min(1).max(80).optional(),
  })
  .strict();

const InitiateMpesaSchema = InitiateBaseSchema.extend({
  provider: z.literal('mpesa'),
});
const InitiateStripeSchema = InitiateBaseSchema.extend({
  provider: z.literal('stripe'),
});
const InitiateSchema = z.discriminatedUnion('provider', [
  InitiateMpesaSchema,
  InitiateStripeSchema,
]);

export function createPaymentsRouter(deps: PaymentsRouterDeps): Hono {
  const app = new Hono();

  // POST /webhook/mpesa — Daraja callback. Public endpoint (no auth);
  // signature verification is the gate. Mounted BEFORE the
  // authMiddleware below so it stays open.
  app.post('/webhook/mpesa', async (c) => {
    const rawBody = await c.req.text();
    // `exactOptionalPropertyTypes` forbids assigning `undefined` to an
    // optional field — only include the keys when present so the
    // signature object stays minimal.
    const signature = c.req.header('x-mpesa-signature');
    const timestamp = c.req.header('x-mpesa-timestamp');
    const sigHeaders: { signature?: string; timestamp?: string } = {};
    if (signature !== undefined) sigHeaders.signature = signature;
    if (timestamp !== undefined) sigHeaders.timestamp = timestamp;
    const skipSig = deps.mpesaClient.mode === 'mock' && !deps.mpesaWebhookSecret;
    const handlerDeps: {
      ledgerService: typeof deps.ledgerService;
      resolveTenantContext: typeof deps.resolveMpesaTenant;
      skipSignatureCheck: boolean;
      webhookSecret?: string;
    } = {
      ledgerService: deps.ledgerService,
      resolveTenantContext: deps.resolveMpesaTenant,
      skipSignatureCheck: skipSig,
    };
    if (deps.mpesaWebhookSecret !== undefined) {
      handlerDeps.webhookSecret = deps.mpesaWebhookSecret;
    }
    const result = await handleMpesaWebhook(rawBody, sigHeaders, handlerDeps);
    // Daraja interprets 4xx/5xx as retryable; respond 200 with explicit
    // ResultCode so we stay in control of idempotency. The handler
    // already marked retries as duplicates.
    if (result.status === 'rejected') {
      return c.json({ ResultCode: 1, ResultDesc: result.reason }, 401);
    }
    return c.json({ ResultCode: 0, ResultDesc: result.status }, 200);
  });

  // POST /webhook/stripe — Stripe webhook. Public; signature verified.
  app.post('/webhook/stripe', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('stripe-signature') ?? '';
    if (!signature) {
      return c.json(
        {
          success: false as const,
          error: { code: 'MISSING_SIGNATURE', message: 'stripe-signature header required' },
        },
        400,
      );
    }
    const result = await handleStripeWebhook(rawBody, signature, {
      client: deps.stripeClient,
      ledgerService: deps.ledgerService,
      resolveTenantContext: deps.resolveStripeTenant,
    });
    if (result.status === 'rejected') {
      return c.json(
        {
          success: false as const,
          error: { code: 'WEBHOOK_REJECTED', message: result.reason },
        },
        400,
      );
    }
    return c.json({ success: true as const, status: result.status }, 200);
  });

  // Authenticated paths below.
  app.use('/initiate', authMiddleware);
  app.post('/initiate', async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      return c.json(
        {
          success: false as const,
          error: { code: 'INVALID_JSON', message: 'Request body must be JSON' },
        },
        400,
      );
    }
    const parsed = InitiateSchema.safeParse(json);
    if (!parsed.success) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.issues.map((i) => i.message).join('; '),
          },
        },
        400,
      );
    }
    const auth = c.get('auth');
    if (parsed.data.provider === 'mpesa') {
      if (!parsed.data.payerPhone) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'PAYER_PHONE_REQUIRED',
              message: 'payerPhone is required for M-Pesa STK push',
            },
          },
          400,
        );
      }
      if (parsed.data.currency !== 'KES') {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'UNSUPPORTED_CURRENCY',
              message: 'M-Pesa STK only accepts KES',
            },
          },
          400,
        );
      }
      try {
        const result = await initiateStkPush(
          {
            amount: Math.round(parsed.data.amount),
            currency: 'KES',
            phoneNumber: parsed.data.payerPhone,
            accountReference: 'BORJIE',
            transactionDesc: (parsed.data.description ?? 'Payment').slice(0, 13),
            callbackUrl: `${deps.mpesaCallbackBaseUrl}/api/v1/payments/webhook/mpesa`,
            businessShortCode: deps.mpesaBusinessShortCode,
          },
          { client: deps.mpesaClient },
        );
        return c.json(
          {
            success: true as const,
            data: {
              provider: 'mpesa' as const,
              mode: result.mode,
              checkoutRequestId: result.checkoutRequestId,
              merchantRequestId: result.merchantRequestId,
              tenantId: auth.tenantId,
            },
          },
          201,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'mpesa initiation failed';
        return c.json(
          {
            success: false as const,
            error: { code: 'PROVIDER_ERROR', message },
          },
          502,
        );
      }
    }
    // provider === 'stripe'
    try {
      // amount is treated as MINOR units for Stripe (cents). The
      // request schema's `amount` mirrors the user's input; we coerce
      // to integer minor units here. For 0-decimal currencies (TZS,
      // UGX) the amount is already in major units == minor units.
      const amountMinor = Math.round(parsed.data.amount);
      const result = await createCheckoutSession(
        {
          amountMinor,
          currency: parsed.data.currency,
          customerEmail: parsed.data.payerEmail,
          successUrl: deps.stripeSuccessUrl,
          cancelUrl: deps.stripeCancelUrl,
          tenantId: auth.tenantId,
          customerId: auth.userId,
        },
        { client: deps.stripeClient },
      );
      return c.json(
        {
          success: true as const,
          data: {
            provider: 'stripe' as const,
            mode: result.mode,
            sessionId: result.sessionId,
            url: result.url,
            paymentIntentId: result.paymentIntentId,
            tenantId: auth.tenantId,
          },
        },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'stripe initiation failed';
      return c.json(
        {
          success: false as const,
          error: { code: 'PROVIDER_ERROR', message },
        },
        502,
      );
    }
  });

  return app;
}

export type PaymentsRouter = ReturnType<typeof createPaymentsRouter>;
