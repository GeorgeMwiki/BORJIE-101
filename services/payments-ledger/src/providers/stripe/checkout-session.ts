/**
 * Stripe Checkout Session creation adapter.
 *
 * Validates currency + amount + metadata, then delegates to an
 * {@link IStripeClient} (live or mock). NO LEDGER WRITE happens here —
 * the journal entry posts on `checkout.session.completed` via the
 * webhook handler.
 */
import { z } from 'zod';
import type { CheckoutSessionRequest, IStripeClient } from './client';
import { omitUndefined } from '../../lib/omit-undefined.js';

// Stripe accepts these as a baseline. We restrict to the currencies the
// Borjie platform actually settles in plus the universal majors.
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'KES', 'TZS', 'UGX'] as const;

export const CheckoutSessionInputSchema = z
  .object({
    amountMinor: z.number().int().positive(),
    currency: z.enum(SUPPORTED_CURRENCIES),
    customerEmail: z.string().email().optional(),
    successUrl: z.string().url(),
    cancelUrl: z.string().url(),
    tenantId: z.string().min(1),
    customerId: z.string().min(1),
    /** Optional scenario hint for mock mode (no-op in live). */
    scenarioKey: z.string().optional(),
  })
  .strict();

export type CheckoutSessionInput = z.infer<typeof CheckoutSessionInputSchema>;

export interface CreateCheckoutSessionDeps {
  readonly client: IStripeClient;
}

export interface CreateCheckoutSessionResult {
  readonly sessionId: string;
  readonly url: string;
  readonly paymentIntentId?: string;
  readonly mode: 'live' | 'mock';
}

export async function createCheckoutSession(
  rawInput: unknown,
  deps: CreateCheckoutSessionDeps,
): Promise<CreateCheckoutSessionResult> {
  const parsed = CheckoutSessionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(
      `Invalid Stripe checkout input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const metadata: Record<string, string> = {
    tenantId: parsed.data.tenantId,
    customerId: parsed.data.customerId,
  };
  if (parsed.data.scenarioKey) {
    metadata.scenarioKey = parsed.data.scenarioKey;
  }
  const session = await deps.client.createCheckoutSession(
    omitUndefined({
      amount: parsed.data.amountMinor,
      currency: parsed.data.currency,
      customerEmail: parsed.data.customerEmail,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
      metadata,
    }) as CheckoutSessionRequest,
  );
  return omitUndefined({
    sessionId: session.id,
    url: session.url,
    paymentIntentId: session.paymentIntentId,
    mode: deps.client.mode,
  }) as CreateCheckoutSessionResult;
}
