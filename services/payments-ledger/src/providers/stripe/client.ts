/**
 * Stripe client (real + mock).
 *
 * Wave PAY-1 / Pilot-pre: pair with `providers/mpesa/client.ts`. The
 * unified `IStripeClient` describes the Checkout / PaymentIntents /
 * Refunds surface our adapter uses. Two backends:
 *
 *   - {@link LiveStripeClient}     – wraps the official Stripe SDK when
 *     `STRIPE_LIVE_KEYS_PRESENT === 'true'`.
 *   - {@link MockStripeClient}     – default. Deterministic responses
 *     + in-process webhook delivery queue.
 *
 * NO secrets in source. The factory {@link createStripeClient} reads
 * env once at call time.
 */
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { logger } from '../../logger.js';

// ---------------------------------------------------------------------------
// Public surface (request/response shapes)
// ---------------------------------------------------------------------------

export interface CheckoutSessionRequest {
  readonly amount: number; // minor units
  readonly currency: string; // ISO 4217 (lower case for Stripe wire)
  readonly customerEmail?: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface CheckoutSessionResponse {
  readonly id: string;
  readonly url: string;
  readonly paymentIntentId?: string;
  readonly clientSecret?: string;
}

export interface RefundRequest {
  readonly paymentIntentId: string;
  readonly amount?: number; // minor units
  readonly reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer';
}

export interface RefundResponse {
  readonly id: string;
  readonly status: 'pending' | 'succeeded' | 'failed' | 'canceled';
  readonly amount: number;
  readonly currency: string;
}

/**
 * Subset of the Stripe webhook event we care about. Real Stripe events
 * have many more fields — we only model what the ledger needs.
 */
export interface StripeWebhookEvent {
  readonly id: string;
  readonly type: string;
  readonly created: number;
  readonly data: {
    readonly object: StripeWebhookEventObject;
  };
}

export interface StripeWebhookEventObject {
  readonly id: string;
  readonly object: string;
  readonly amount?: number;
  readonly amount_total?: number;
  readonly amount_received?: number;
  readonly currency?: string;
  readonly status?: string;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly payment_intent?: string;
}

export interface IStripeClient {
  readonly mode: 'live' | 'mock';
  createCheckoutSession(req: CheckoutSessionRequest): Promise<CheckoutSessionResponse>;
  retrieveCheckoutSession(id: string): Promise<CheckoutSessionResponse>;
  refund(req: RefundRequest): Promise<RefundResponse>;
  /**
   * Construct + verify a webhook event from a signed body. Live mode
   * uses Stripe's signature verification; mock mode parses JSON and
   * trusts the payload (signature passed through to satisfy the
   * contract).
   */
  constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent;
}

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

export interface LiveStripeConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly apiVersion?: Stripe.LatestApiVersion;
}

export class LiveStripeClient implements IStripeClient {
  readonly mode = 'live' as const;

  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: LiveStripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: config.apiVersion ?? '2026-03-25.dahlia',
    });
    this.webhookSecret = config.webhookSecret;
  }

  async createCheckoutSession(
    req: CheckoutSessionRequest,
  ): Promise<CheckoutSessionResponse> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: req.currency.toLowerCase(),
            unit_amount: req.amount,
            product_data: { name: 'Borjie payment' },
          },
        },
      ],
      customer_email: req.customerEmail,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      metadata: req.metadata as Stripe.MetadataParam,
    });
    return {
      id: session.id,
      url: session.url ?? '',
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id,
    };
  }

  async retrieveCheckoutSession(id: string): Promise<CheckoutSessionResponse> {
    const session = await this.stripe.checkout.sessions.retrieve(id);
    return {
      id: session.id,
      url: session.url ?? '',
      paymentIntentId:
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id,
    };
  }

  async refund(req: RefundRequest): Promise<RefundResponse> {
    const refund = await this.stripe.refunds.create({
      payment_intent: req.paymentIntentId,
      amount: req.amount,
      reason: req.reason as Stripe.RefundCreateParams.Reason | undefined,
    });
    return {
      id: refund.id,
      status: refund.status as RefundResponse['status'],
      amount: refund.amount,
      currency: refund.currency.toUpperCase(),
    };
  }

  constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.webhookSecret,
    );
    return {
      id: event.id,
      type: event.type,
      created: event.created,
      data: {
        object: event.data.object as unknown as StripeWebhookEventObject,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Mock client (in-process, deterministic)
// ---------------------------------------------------------------------------

export interface MockStripeScenario {
  /** Forces the checkout session payment status. Default 'paid'. */
  readonly forcePaymentStatus?: 'paid' | 'unpaid' | 'failed';
}

export interface MockStripeClientOptions {
  /** Per-metadata-key scenario override. Lookup by metadata.scenarioKey. */
  readonly scenarios?: Readonly<Record<string, MockStripeScenario>>;
}

export interface QueuedStripeWebhook {
  readonly type: string;
  readonly payload: StripeWebhookEvent;
}

export class MockStripeClient implements IStripeClient {
  readonly mode = 'mock' as const;

  private readonly options: MockStripeClientOptions;
  private readonly webhooks: QueuedStripeWebhook[] = [];
  private readonly sessions: Map<string, CheckoutSessionResponse> = new Map();

  constructor(options: MockStripeClientOptions = {}) {
    this.options = options;
  }

  async createCheckoutSession(
    req: CheckoutSessionRequest,
  ): Promise<CheckoutSessionResponse> {
    const id = `cs_test_${randomUUID().replace(/-/g, '')}`;
    const paymentIntentId = `pi_test_${randomUUID().replace(/-/g, '')}`;
    const session: CheckoutSessionResponse = {
      id,
      url: `https://checkout.stripe.com/c/pay/${id}`,
      paymentIntentId,
    };
    this.sessions.set(id, session);

    const scenarioKey = req.metadata.scenarioKey;
    const scenario: MockStripeScenario =
      scenarioKey && this.options.scenarios?.[scenarioKey]
        ? this.options.scenarios[scenarioKey]
        : {};
    const status = scenario.forcePaymentStatus ?? 'paid';
    const eventType =
      status === 'paid'
        ? 'checkout.session.completed'
        : status === 'failed'
          ? 'checkout.session.async_payment_failed'
          : 'checkout.session.expired';
    this.webhooks.push({
      type: eventType,
      payload: {
        id: `evt_test_${randomUUID().replace(/-/g, '')}`,
        type: eventType,
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id,
            object: 'checkout.session',
            amount_total: req.amount,
            currency: req.currency.toLowerCase(),
            status: status === 'paid' ? 'complete' : status,
            metadata: req.metadata,
            payment_intent: paymentIntentId,
          },
        },
      },
    });
    logger.info('mock stripe checkout session enqueued webhook', {
      sessionId: id,
      eventType,
    });
    return session;
  }

  async retrieveCheckoutSession(id: string): Promise<CheckoutSessionResponse> {
    const existing = this.sessions.get(id);
    if (!existing) {
      throw new Error(`Mock Stripe: checkout session ${id} not found`);
    }
    return existing;
  }

  async refund(req: RefundRequest): Promise<RefundResponse> {
    const id = `re_test_${randomUUID().replace(/-/g, '')}`;
    const response: RefundResponse = {
      id,
      status: 'succeeded',
      amount: req.amount ?? 0,
      currency: 'USD',
    };
    this.webhooks.push({
      type: 'charge.refunded',
      payload: {
        id: `evt_test_${randomUUID().replace(/-/g, '')}`,
        type: 'charge.refunded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id,
            object: 'refund',
            amount: req.amount ?? 0,
            currency: 'usd',
            status: 'succeeded',
            payment_intent: req.paymentIntentId,
          },
        },
      },
    });
    return response;
  }

  /**
   * Mock signature verification: accept any non-empty `signature` and
   * parse the body as JSON. Live mode uses HMAC; tests can pass an
   * arbitrary token.
   */
  constructWebhookEvent(rawBody: string, signature: string): StripeWebhookEvent {
    if (!signature) {
      throw new Error('Mock Stripe: signature required (even if not verified)');
    }
    return JSON.parse(rawBody) as StripeWebhookEvent;
  }

  drainWebhooks(): readonly QueuedStripeWebhook[] {
    const drained = [...this.webhooks];
    this.webhooks.length = 0;
    return drained;
  }

  pendingWebhookCount(): number {
    return this.webhooks.length;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function isStripeLiveMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STRIPE_LIVE_KEYS_PRESENT === 'true';
}

export interface CreateStripeClientOptions {
  readonly mockScenarios?: Readonly<Record<string, MockStripeScenario>>;
  readonly env?: NodeJS.ProcessEnv;
}

export function createStripeClient(
  options: CreateStripeClientOptions = {},
): IStripeClient {
  const env = options.env ?? process.env;
  if (!isStripeLiveMode(env)) {
    return new MockStripeClient({ scenarios: options.mockScenarios });
  }
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !webhookSecret) {
    throw new Error(
      'STRIPE_LIVE_KEYS_PRESENT=true but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET missing.',
    );
  }
  return new LiveStripeClient({ secretKey, webhookSecret });
}
