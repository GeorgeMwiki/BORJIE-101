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
 * Idempotency (EDGE-HARDENING #3): dedupe by `event.id`. Stripe guarantees
 * at-least-once delivery and may retry the same event for ~3 days. A
 * durable {@link WebhookDedupeStore} (DB-backed `webhook_events`, migration
 * 0163) claims each event id BEFORE the ledger write so a redelivery after
 * a restart or on another replica is dropped. The ledger post is ALSO keyed
 * on `event.id` (durability defect #2) as a post-once backstop. When no
 * store is wired (dev/test) the handler falls back to a process-local Set.
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
import type { WebhookDedupeStore } from '../webhook-dedupe-store';

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
  /**
   * Durable, claim-after-commit dedupe (EDGE-HARDENING #3). Survives
   * restart + multi-replica when DB-backed. When supplied it is the
   * authoritative duplicate guard; the legacy `seenEventIds` Set is
   * ignored. The ledger post is ALSO keyed on `event.id` (defect #2) so a
   * crash between claim-commit and ledger-post cannot double-credit.
   */
  readonly dedupeStore?: WebhookDedupeStore;
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

  // EDGE-HARDENING #3 — durable dedupe. With a store wired this survives
  // restart + replicas; without one it falls back to the process-local Set
  // (dev/test/legacy). The actual CLAIM (which advances the dedupe state)
  // happens AT the point we commit to acting, inside each processor, so a
  // tenant-less/ignored event still records correctly. Here we only do a
  // cheap pre-check to short-circuit obvious replays.
  if (event.type === 'checkout.session.completed') {
    return processCheckoutCompleted(event, deps);
  }
  if (event.type === 'charge.refunded') {
    return processRefund(event, deps);
  }
  // We intentionally don't post for other event types (e.g.
  // `checkout.session.expired`, `payment_intent.payment_failed`). Record
  // the dedupe marker so retries are still idempotent and the ledger
  // remains untouched.
  if (await markStripeSeen(deps, event.id, null)) {
    logger.info('stripe webhook duplicate ignored', { eventId: event.id });
    return { status: 'duplicate' };
  }
  return { status: 'ignored', reason: event.type };
}

/**
 * Claim a Stripe event id as seen. Prefers the durable
 * {@link WebhookDedupeStore} (survives restart + replicas); falls back to
 * the process-local Set otherwise. Returns true when ALREADY seen (caller
 * drops the event as a duplicate).
 */
async function markStripeSeen(
  deps: StripeWebhookHandlerDeps,
  eventId: string,
  tenantId: TenantId | null,
): Promise<boolean> {
  if (deps.dedupeStore) {
    const claim = await deps.dedupeStore.claim(
      'stripe',
      eventId,
      tenantId ?? 'global',
    );
    return claim === 'duplicate';
  }
  const seen = deps.seenEventIds ?? defaultSeenIds;
  if (seen.has(eventId)) return true;
  seen.add(eventId);
  return false;
}

async function processCheckoutCompleted(
  event: StripeWebhookEvent,
  deps: StripeWebhookHandlerDeps,
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

  // EDGE-HARDENING #3 — claim durably (tenant-scoped) BEFORE the ledger
  // write. A redelivery post-restart/other-replica hits the existing row
  // and is dropped here. The claim commits first; the ledger key below is
  // the post-once backstop if the claim is ever lost.
  if (await markStripeSeen(deps, event.id, ctx.tenantId)) {
    logger.info('stripe webhook duplicate ignored', { eventId: event.id });
    return { status: 'duplicate' };
  }

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
  // EDGE-HARDENING #3 (defence-in-depth) — key the post on the Stripe event
  // id. Even if the durable claim was lost, the ledger is POST-ONCE on this
  // key so a redelivery cannot double-credit.
  const result = await deps.ledgerService.postJournalEntry(journalRequest, {
    idempotencyKey: `stripe:${event.id}`,
  });
  return { status: 'posted', journalId: result.journalId };
}

async function processRefund(
  event: StripeWebhookEvent,
  deps: StripeWebhookHandlerDeps,
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

  // EDGE-HARDENING #3 — claim durably (tenant-scoped) BEFORE the reversing
  // ledger write; a redelivered refund event is dropped here.
  if (await markStripeSeen(deps, event.id, ctx.tenantId)) {
    logger.info('stripe webhook duplicate ignored', { eventId: event.id });
    return { status: 'duplicate' };
  }

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
  // EDGE-HARDENING #3 (defence-in-depth) — post-once on the Stripe event id.
  const result = await deps.ledgerService.postJournalEntry(journalRequest, {
    idempotencyKey: `stripe:${event.id}`,
  });
  return { status: 'refunded', journalId: result.journalId };
}

const defaultSeenIds = new Set<string>();
