/**
 * M-Pesa STK callback webhook handler.
 *
 * Safaricom POSTs a {@link StkCallbackPayload} to the configured
 * `callbackUrl` after the customer either approves or rejects the STK
 * prompt. This handler:
 *
 *   1. (live mode only) verifies HMAC signature via the shared
 *      middleware contract — caller is expected to have already
 *      validated the signature when `verifySignature` is true.
 *   2. de-duplicates by `(tenantId, checkoutRequestId)` so retries are
 *      a no-op.
 *   3. on success → posts a balanced journal entry through
 *      {@link LedgerService.postJournalEntry}. THIS IS THE ONLY money-
 *      ledger write path for M-Pesa.
 *
 * Hash-chain audit: every successful ledger post emits a
 * `LEDGER_ENTRIES_CREATED` domain event via the LedgerService, which
 * downstream subscribers append to the audit chain.
 *
 * NOTE: this module DOES NOT write the money ledger directly. It calls
 * `LedgerService.postJournalEntry`. The money-path audit test
 * (`__tests__/invariants/money-path-audit.test.ts`) enforces this.
 */
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
import type { StkCallbackPayload } from './client';

const CallbackItemSchema = z.object({
  Name: z.string(),
  Value: z.union([z.string(), z.number()]).optional(),
});

const StkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string(),
      ResultCode: z.number(),
      ResultDesc: z.string(),
      CallbackMetadata: z
        .object({ Item: z.array(CallbackItemSchema) })
        .optional(),
    }),
  }),
});

export type ParsedStkCallback = z.infer<typeof StkCallbackSchema>;

/**
 * Tenant resolver: given a CheckoutRequestID or business shortcode,
 * return which Borjie tenant owns the transaction + which accounts
 * to credit/debit. In production this comes from a payment-intent
 * lookup; tests inject a deterministic resolver.
 */
export interface MpesaTenantContext {
  readonly tenantId: TenantId;
  readonly customerAccountId: AccountId;
  readonly cashClearingAccountId: AccountId;
  readonly currency: CurrencyCode;
}

export type MpesaTenantResolver = (
  checkoutRequestId: string,
) => Promise<MpesaTenantContext | null>;

export interface MpesaWebhookHandlerDeps {
  readonly ledgerService: LedgerService;
  readonly resolveTenantContext: MpesaTenantResolver;
  /** Override for the in-memory dedupe set (tests). */
  readonly seenIds?: Set<string>;
  /** Skip HMAC check (default false; set true for mock-mode tests). */
  readonly skipSignatureCheck?: boolean;
  /** HMAC secret. Required when `skipSignatureCheck` is false. */
  readonly webhookSecret?: string;
}

export interface MpesaSignatureHeaders {
  readonly signature?: string;
  readonly timestamp?: string;
}

export type MpesaWebhookResult =
  | { readonly status: 'posted'; readonly journalId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'no-tenant'; readonly checkoutRequestId: string }
  | { readonly status: 'failed-payment'; readonly resultCode: number; readonly resultDesc: string }
  | { readonly status: 'rejected'; readonly reason: string };

/**
 * Verify the Daraja HMAC signature (`hex(hmac-sha256(secret, "${ts}.${rawBody}"))`).
 * Returns false on any structural error. Caller decides what to do.
 */
export function verifyMpesaSignature(
  rawBody: string,
  headers: MpesaSignatureHeaders,
  secret: string,
  replayWindowMs: number = 5 * 60 * 1000,
): boolean {
  const sigHex = headers.signature?.trim();
  const tsRaw = headers.timestamp?.trim();
  if (!sigHex || !tsRaw) return false;
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() - ts) > replayWindowMs) return false;
  const expected = createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sigHex, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Process a single M-Pesa STK callback. Idempotent by checkoutRequestId.
 * The ledger write only happens for `ResultCode === 0` (success).
 */
export async function handleMpesaWebhook(
  rawBody: string,
  headers: MpesaSignatureHeaders,
  deps: MpesaWebhookHandlerDeps,
): Promise<MpesaWebhookResult> {
  // Signature check (skipped in mock mode for tests by explicit opt-out)
  if (!deps.skipSignatureCheck) {
    const secret = deps.webhookSecret;
    if (!secret) {
      return { status: 'rejected', reason: 'missing-webhook-secret' };
    }
    if (!verifyMpesaSignature(rawBody, headers, secret)) {
      logger.warn('mpesa webhook signature rejected');
      return { status: 'rejected', reason: 'invalid-signature' };
    }
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 'rejected', reason: 'invalid-json' };
  }

  const parsed = StkCallbackSchema.safeParse(json);
  if (!parsed.success) {
    return { status: 'rejected', reason: 'invalid-shape' };
  }
  const cb = parsed.data.Body.stkCallback;

  // Idempotency — process each CheckoutRequestID exactly once
  const seen = deps.seenIds ?? defaultSeenIds;
  if (seen.has(cb.CheckoutRequestID)) {
    logger.info('mpesa webhook duplicate ignored', {
      checkoutRequestId: cb.CheckoutRequestID,
    });
    return { status: 'duplicate' };
  }

  // Non-success — record the dedupe marker (so retries don't re-process)
  // but never write to the ledger
  if (cb.ResultCode !== 0) {
    seen.add(cb.CheckoutRequestID);
    return {
      status: 'failed-payment',
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
    };
  }

  // Resolve tenant + accounts
  const ctx = await deps.resolveTenantContext(cb.CheckoutRequestID);
  if (!ctx) {
    return { status: 'no-tenant', checkoutRequestId: cb.CheckoutRequestID };
  }

  // Extract amount from callback metadata
  const amountMajor = extractMetadataNumber(cb.CallbackMetadata?.Item ?? [], 'Amount');
  if (amountMajor == null) {
    return { status: 'rejected', reason: 'missing-amount' };
  }
  const amountMinor = Math.round(amountMajor * 100);

  // Mark as seen BEFORE the ledger write — if the ledger write fails we
  // still want to reject duplicate retries in this process cycle. The
  // outbox/event publisher gives at-least-once delivery downstream.
  seen.add(cb.CheckoutRequestID);

  const journalRequest: CreateJournalEntryRequest = {
    tenantId: ctx.tenantId,
    effectiveDate: new Date(),
    paymentIntentId: cb.CheckoutRequestID as PaymentIntentId,
    createdBy: 'mpesa-webhook',
    lines: [
      {
        accountId: ctx.cashClearingAccountId,
        type: 'RENT_PAYMENT',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(amountMinor, ctx.currency),
        description: 'M-Pesa STK clearing receipt',
        metadata: { provider: 'mpesa', checkoutRequestId: cb.CheckoutRequestID },
      },
      {
        accountId: ctx.customerAccountId,
        type: 'RENT_PAYMENT',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(amountMinor, ctx.currency),
        description: 'M-Pesa STK customer credit',
        metadata: { provider: 'mpesa', checkoutRequestId: cb.CheckoutRequestID },
      },
    ],
  };
  const result = await deps.ledgerService.postJournalEntry(journalRequest);
  return { status: 'posted', journalId: result.journalId };
}

/**
 * Module-level dedupe set. Tests pass their own via `seenIds` for full
 * isolation; production usage shares this process-local cache.
 */
const defaultSeenIds = new Set<string>();

function extractMetadataNumber(
  items: ReadonlyArray<{ Name: string; Value?: string | number }>,
  name: string,
): number | null {
  const found = items.find((item) => item.Name === name);
  if (!found || found.Value == null) return null;
  const num = typeof found.Value === 'number' ? found.Value : Number(found.Value);
  return Number.isFinite(num) ? num : null;
}

/**
 * Helper for the Daraja callback payload type so route handlers can
 * type-check the request before passing the raw body through.
 */
export type { StkCallbackPayload };
