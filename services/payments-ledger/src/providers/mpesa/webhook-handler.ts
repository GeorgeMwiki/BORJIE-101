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
 *   2. CLASSIFIES the Daraja outcome (EDGE-HARDENING #5):
 *      `Body.stkCallback.ResultCode` 0 == success, NON-ZERO == failure
 *      (insufficient funds / wrong PIN / user-cancel / timeout). A failed
 *      STK NEVER credits the ledger — it marks the payment_intent FAILED
 *      with the code-derived reason and logs loudly. A success whose Amount
 *      does not reconcile with the expected amount is ALSO treated as a
 *      failure (mis-credit guard).
 *   3. DURABLY de-duplicates (EDGE-HARDENING #3) via a claim-after-commit
 *      {@link WebhookDedupeStore} (DB-backed `webhook_events`, migration
 *      0163) so a redelivery after restart / on another replica is a no-op.
 *   4. on success + reconciled amount → posts a balanced journal through
 *      {@link LedgerService.postJournalEntry}, KEYED on the CheckoutRequestID
 *      (durability defect #2) for post-once safety. THIS IS THE ONLY money-
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
import type { WebhookDedupeStore } from '../webhook-dedupe-store';
import { isMpesaSuccess, mpesaResultReason } from './result-codes';

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
  /**
   * Expected amount in minor units for this checkout (EDGE-HARDENING #5).
   * When the resolver knows the originating payment-intent amount it pins
   * it here; the handler refuses to credit a success whose callback amount
   * does not match (a wrong-amount success is a mis-credit). Optional —
   * omit to skip reconciliation.
   */
  readonly expectedAmountMinorUnits?: number;
}

export type MpesaTenantResolver = (
  checkoutRequestId: string,
) => Promise<MpesaTenantContext | null>;

/**
 * Optional sink for a FAILED M-Pesa payment (EDGE-HARDENING #5). When a
 * callback reports a non-zero ResultCode — or a success whose amount does
 * NOT reconcile — the handler marks the payment_intent FAILED with the
 * code-derived reason and posts NO credit journal. Production wires this to
 * the payment-intent repository; tests assert it was (not) called.
 */
export type MpesaPaymentFailureSink = (failure: {
  readonly checkoutRequestId: string;
  readonly tenantId: TenantId | null;
  readonly resultCode: number;
  readonly resultDesc: string;
  readonly failureReason: string;
}) => Promise<void> | void;

export interface MpesaWebhookHandlerDeps {
  readonly ledgerService: LedgerService;
  readonly resolveTenantContext: MpesaTenantResolver;
  /**
   * Durable, claim-after-commit dedupe (EDGE-HARDENING #3). Survives
   * restart + multi-replica when DB-backed. When supplied it is the
   * authoritative duplicate guard; the legacy `seenIds` Set is ignored.
   * The ledger post is ALSO keyed on the CheckoutRequestID (defect #2) so
   * a crash between claim-commit and ledger-post cannot double-credit.
   */
  readonly dedupeStore?: WebhookDedupeStore;
  /** Override for the in-memory dedupe set (tests / legacy fallback). */
  readonly seenIds?: Set<string>;
  /** Skip HMAC check (default false; set true for mock-mode tests). */
  readonly skipSignatureCheck?: boolean;
  /** HMAC secret. Required when `skipSignatureCheck` is false. */
  readonly webhookSecret?: string;
  /** Sink for FAILED payments (non-zero ResultCode / amount mismatch). */
  readonly onPaymentFailed?: MpesaPaymentFailureSink;
}

export interface MpesaSignatureHeaders {
  readonly signature?: string;
  readonly timestamp?: string;
}

export type MpesaWebhookResult =
  | { readonly status: 'posted'; readonly journalId: string }
  | { readonly status: 'duplicate' }
  | { readonly status: 'no-tenant'; readonly checkoutRequestId: string }
  | {
      readonly status: 'failed-payment';
      readonly resultCode: number;
      readonly resultDesc: string;
      readonly failureReason: string;
    }
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
  const checkoutRequestId = cb.CheckoutRequestID;

  // EDGE-HARDENING #5 — ResultCode classification FIRST, before any dedupe
  // claim or ledger write. ResultCode 0 == success; ANY non-zero == failure
  // (insufficient funds / wrong PIN / user-cancel / timeout). A failed STK
  // must NEVER credit the ledger or mark the payment SUCCEEDED. We mark the
  // payment_intent FAILED with the code-derived reason and surface loudly.
  if (!isMpesaSuccess(cb.ResultCode)) {
    const failureReason = mpesaResultReason(cb.ResultCode, cb.ResultDesc);
    logger.warn('mpesa STK payment FAILED — no ledger credit', {
      checkoutRequestId,
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      failureReason,
    });
    // Resolve tenant for the failure record on a best-effort basis (the
    // sink tolerates null).
    const failCtx = await deps.resolveTenantContext(checkoutRequestId);
    // F5 — mark the intent FAILED (the terminal side effect) BEFORE recording
    // the dedupe claim. The old order claimed first; a transient sink throw
    // then left the claim committed → Safaricom's redelivery saw `duplicate`
    // and the intent stayed stuck PENDING. The failure-path dedupe only avoids
    // log spam; it must NEVER swallow the terminal-state write.
    if (deps.onPaymentFailed) {
      await deps.onPaymentFailed({
        checkoutRequestId,
        tenantId: failCtx?.tenantId ?? null,
        resultCode: cb.ResultCode,
        resultDesc: cb.ResultDesc,
        failureReason,
      });
    }
    // Only after the FAILED state durably committed do we claim, so a
    // redelivery that follows a sink failure still re-runs the sink.
    await markSeen(deps, checkoutRequestId, failCtx?.tenantId ?? null);
    return {
      status: 'failed-payment',
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      failureReason,
    };
  }

  // Resolve tenant + accounts (needed for the durable claim's RLS scope).
  const ctx = await deps.resolveTenantContext(checkoutRequestId);
  if (!ctx) {
    return { status: 'no-tenant', checkoutRequestId };
  }

  // Extract amount from callback metadata. A success callback MUST carry a
  // reconcilable Amount; its absence is a malformed success we refuse to
  // credit (fail-closed — never invent an amount).
  const amountMajor = extractMetadataNumber(cb.CallbackMetadata?.Item ?? [], 'Amount');
  if (amountMajor == null) {
    return { status: 'rejected', reason: 'missing-amount' };
  }
  // M-Pesa amounts are whole major units; KES/TZS minor unit is ×100.
  const amountMinor = Math.round(amountMajor * 100);

  // EDGE-HARDENING #5 — amount reconciliation. If the resolver pins an
  // expected amount for this checkout, a mismatch is treated as a FAILED
  // payment (NOT a credit): a success ResultCode with the wrong amount is a
  // mis-credit risk. We mark FAILED + log loud and post nothing.
  if (
    ctx.expectedAmountMinorUnits !== undefined &&
    ctx.expectedAmountMinorUnits !== amountMinor
  ) {
    const failureReason = `amount-mismatch:expected-${ctx.expectedAmountMinorUnits}-got-${amountMinor}`;
    logger.error('mpesa STK amount MISMATCH — refusing to credit', {
      checkoutRequestId,
      expectedMinor: ctx.expectedAmountMinorUnits,
      gotMinor: amountMinor,
      resultCode: cb.ResultCode,
    });
    // F5 — terminal FAILED write BEFORE the dedupe claim (see above). A
    // transient sink throw must not leave a committed claim that suppresses
    // the redelivery and strands the intent at PENDING.
    if (deps.onPaymentFailed) {
      await deps.onPaymentFailed({
        checkoutRequestId,
        tenantId: ctx.tenantId,
        resultCode: cb.ResultCode,
        resultDesc: cb.ResultDesc,
        failureReason,
      });
    }
    await markSeen(deps, checkoutRequestId, ctx.tenantId);
    return {
      status: 'failed-payment',
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      failureReason,
    };
  }

  // EDGE-HARDENING #3 — durable claim BEFORE the ledger write. The claim
  // commits first; a redelivery (post-restart, other replica) hits the
  // existing row and is dropped. `markSeen` returns true on a duplicate.
  if (await markSeen(deps, checkoutRequestId, ctx.tenantId)) {
    logger.info('mpesa webhook duplicate ignored', { checkoutRequestId });
    return { status: 'duplicate' };
  }

  const journalRequest: CreateJournalEntryRequest = {
    tenantId: ctx.tenantId,
    effectiveDate: new Date(),
    paymentIntentId: checkoutRequestId as PaymentIntentId,
    createdBy: 'mpesa-webhook',
    lines: [
      {
        accountId: ctx.cashClearingAccountId,
        type: 'RENT_PAYMENT',
        direction: 'DEBIT',
        amount: Money.fromMinorUnits(amountMinor, ctx.currency),
        description: 'M-Pesa STK clearing receipt',
        metadata: { provider: 'mpesa', checkoutRequestId },
      },
      {
        accountId: ctx.customerAccountId,
        type: 'RENT_PAYMENT',
        direction: 'CREDIT',
        amount: Money.fromMinorUnits(amountMinor, ctx.currency),
        description: 'M-Pesa STK customer credit',
        metadata: { provider: 'mpesa', checkoutRequestId },
      },
    ],
  };
  // EDGE-HARDENING #3 (defence-in-depth) — key the post on the M-Pesa
  // transaction id. Even if the durable claim was lost (crash between
  // claim-commit and here, or a reconciliation replay that bypasses the
  // claim), the ledger is POST-ONCE on this key → no double-credit.
  const result = await deps.ledgerService.postJournalEntry(journalRequest, {
    idempotencyKey: `mpesa:stk:${checkoutRequestId}`,
  });
  return { status: 'posted', journalId: result.journalId };
}

/**
 * Claim an event id as seen. Prefers the durable {@link WebhookDedupeStore}
 * (survives restart + replicas); falls back to the process-local Set when
 * no store is wired (dev/test/legacy). Returns true when the event was
 * ALREADY seen (caller should drop it as a duplicate).
 */
async function markSeen(
  deps: MpesaWebhookHandlerDeps,
  checkoutRequestId: string,
  tenantId: TenantId | null,
): Promise<boolean> {
  if (deps.dedupeStore) {
    const claim = await deps.dedupeStore.claim(
      'mpesa',
      checkoutRequestId,
      tenantId ?? 'global',
    );
    return claim === 'duplicate';
  }
  const seen = deps.seenIds ?? defaultSeenIds;
  if (seen.has(checkoutRequestId)) return true;
  seen.add(checkoutRequestId);
  return false;
}

/**
 * Module-level dedupe set. Tests pass their own via `seenIds` for full
 * isolation; production usage shares this process-local cache.
 */
const defaultSeenIds = new Set<string>();

function extractMetadataNumber(
  items: ReadonlyArray<{ Name: string; Value?: string | number | undefined }>,
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
