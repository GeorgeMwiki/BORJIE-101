/**
 * Stripe webhook handler.
 *
 * Receives events from Stripe (or the in-process mock queue) and posts
 * a balanced journal entry through {@link LedgerService.postJournalEntry}
 * for the events we care about:
 *
 *   - `checkout.session.completed`   → credit customer / debit cash clearing
 *   - `charge.refunded`              → debit customer / credit cash clearing
 *
 * Hard rule (CLAUDE.md): this module NEVER writes the money ledger
 * directly. The money-path audit test enforces this.
 *
 * Idempotency: dedupe by `event.id`. Stripe guarantees at-least-once
 * delivery and may retry the same event up to ~3 days; the in-memory
 * set is bounded by process lifetime, with a persistent layer recommended
 * for production via the existing `webhook-idempotency.middleware.ts`.
 */
import {
  Money,
  type AccountId,
  type TenantId,
  type PaymentIntentId,
  type CurrencyCode,
  type CreateJournalEntryRequest,
} from '@borjie/domain-models';
import type { LedgerService } from '../../services/ledger.service';
import { logger } from '../../logger.js';
import type { IStripeClient, StripeWebhookEvent } from './client';

const ACCEPTED_CURRENCIES = new Set<CurrencyCode>([
  'USD',
  'EUR',
  'GBP',
  'KES',
  'TZS',
  'UGX',
]);

/**
 * Tenant resolver: given a Stripe event's metadata + payment intent id,
 * return the Borjie tenant + accounts.
 */
export interface StripeTenantContext {
  readonly tenantId: TenantId;
  readonly customerAccountId: AccountId;
  readonly cashClearingAccountId: AccountId;
  readonly currency: CurrencyCode;
}

export type StripeTenantResolver = (
  event: StripeWebhookEvent,
) => Promise<StripeTenantContext | null>;

export interface StripeWebhookHandlerDeps {
  readonly client: IStripeClient;
  readonly ledgerService: LedgerService;
  readonly resolveTenantContext: StripeTenantResolver;
  readonly seenEventIds?: Set<string>;
}

export type StripeWebhookResult =
  | { readonly status: 'posted'; readonly journalId: string }
  | { readonly status: 'refunded'; readonly journalId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'ignored'; readonly reason: string }
  | { readonly status: 'no-tenant' }
  | { readonly status: 'rejected'; readonly reason: string };

/**
 * Process a single Stripe webhook. Signature verification is delegated
 * to the client.constructWebhookEvent (live: HMAC; mock: pass-through).
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string,
  deps: StripeWebhookHandlerDeps,
): Promise<StripeWebhookResult> {
  let event: StripeWebhookEvent;
  try {
    event = deps.client.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown verification error';
    logger.warn('stripe webhook signature rejected', { reason: message });
    return { status: 'rejected', reason: 'invalid-signature' };
  }

  const seen = deps.seenEventIds ?? defaultSeenIds;
  if (seen.has(event.id)) {
    logger.info('stripe webhook duplicate ignored', { eventId: event.id });
    return { status: 'duplicate' };
  }

  if (event.type === 'checkout.session.completed') {
    return processCheckoutCompleted(event, deps, seen);
  }
  if (event.type === 'charge.refunded') {
    return processRefund(event, deps, seen);
  }
  // We intentionally don't post for other event types (e.g.
  // `checkout.session.expired`, `payment_intent.payment_failed`). Record
  // the dedupe marker so retries are still idempotent and the ledger
  // remains untouched.
  seen.add(event.id);
  return { status: 'ignored', reason: event.type };
}

async function processCheckoutCompleted(
  event: StripeWebhookEvent,
  deps: StripeWebhookHandlerDeps,
  seen: Set<string>,
): Promise<StripeWebhookResult> {
  const obj = event.data.object;
  const amount = obj.amount_total ?? obj.amount ?? obj.amount_received;
  const currencyRaw = obj.currency?.toUpperCase();
  if (amount == null || !currencyRaw) {
    return { status: 'rejected', reason: 'missing-amount-or-currency' };
  }
  if (!ACCEPTED_CURRENCIES.has(currencyRaw as CurrencyCode)) {
    return { status: 'rejected', reason: `unsupported-currency:${currencyRaw}` };
  }
  const ctx = await deps.resolveTenantContext(event);
  if (!ctx) {
    return { status: 'no-tenant' };
  }
  if (ctx.currency !== currencyRaw) {
    return {
      status: 'rejected',
      reason: `currency-mismatch:${ctx.currency}-vs-${currencyRaw}`,
    };
  }

  // Mark seen BEFORE the ledger write — retries within this process
  // cannot double-write. Persistent dedupe lives at the gateway layer.
  seen.add(event.id);

  const journalRequest: CreateJournalEntryRequest = {
    tenantId: ctx.tenantId,
    effectiveDate: new Date(event.created * 1000),
    paymentIntentId: (obj.payment_intent ?? obj.id) as PaymentIntentId,
    createdBy: 'stripe-webhook',
    lines: [
      {
        accountId: ctx.cashClearingAccountId,
        type: 'RENT_PAYMENT',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(amount, ctx.currency),
        description: 'Stripe checkout clearing receipt',
        metadata: { provider: 'stripe', sessionId: obj.id, eventId: event.id },
      },
      {
        accountId: ctx.customerAccountId,
        type: 'RENT_PAYMENT',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(amount, ctx.currency),
        description: 'Stripe checkout customer credit',
        metadata: { provider: 'stripe', sessionId: obj.id, eventId: event.id },
      },
    ],
  };
  const result = await deps.ledgerService.postJournalEntry(journalRequest);
  return { status: 'posted', journalId: result.journalId };
}

async function processRefund(
  event: StripeWebhookEvent,
  deps: StripeWebhookHandlerDeps,
  seen: Set<string>,
): Promise<StripeWebhookResult> {
  const obj = event.data.object;
  const amount = obj.amount ?? obj.amount_received;
  const currencyRaw = obj.currency?.toUpperCase();
  if (amount == null || !currencyRaw) {
    return { status: 'rejected', reason: 'missing-amount-or-currency' };
  }
  if (!ACCEPTED_CURRENCIES.has(currencyRaw as CurrencyCode)) {
    return { status: 'rejected', reason: `unsupported-currency:${currencyRaw}` };
  }
  const ctx = await deps.resolveTenantContext(event);
  if (!ctx) {
    return { status: 'no-tenant' };
  }

  seen.add(event.id);

  // Refund flow reverses the original journal direction.
  const journalRequest: CreateJournalEntryRequest = {
    tenantId: ctx.tenantId,
    effectiveDate: new Date(event.created * 1000),
    paymentIntentId: (obj.payment_intent ?? obj.id) as PaymentIntentId,
    createdBy: 'stripe-webhook',
    lines: [
      {
        accountId: ctx.customerAccountId,
        // DEPOSIT_REFUND is the closest reversing type in the canonical
        // narrow LedgerEntryType union exported from @borjie/domain-models.
        // The broader `REFUND` literal exists in the local payments-ledger
        // types.ts but isn't part of the domain-models union the LedgerService
        // accepts. Use the narrow type to keep the journal balanced and the
        // reconciliation correct; downstream classifiers read the
        // `metadata.provider === 'stripe'` field for refund-specific logic.
        type: 'DEPOSIT_REFUND',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(amount, ctx.currency),
        description: 'Stripe refund customer debit',
        metadata: { provider: 'stripe', refundId: obj.id, eventId: event.id },
      },
      {
        accountId: ctx.cashClearingAccountId,
        type: 'DEPOSIT_REFUND',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(amount, ctx.currency),
        description: 'Stripe refund clearing credit',
        metadata: { provider: 'stripe', refundId: obj.id, eventId: event.id },
      },
    ],
  };
  const result = await deps.ledgerService.postJournalEntry(journalRequest);
  return { status: 'refunded', journalId: result.journalId };
}

const defaultSeenIds = new Set<string>();
