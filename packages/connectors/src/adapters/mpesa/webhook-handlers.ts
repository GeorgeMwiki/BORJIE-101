/**
 * M-Pesa Daraja 3.0 — webhook handlers for `stkCallback`.
 *
 * Flow: Safaricom POSTs a JSON envelope to our callback URL after the
 * tenant completes (or aborts) the STK prompt. We must:
 *   1. Verify origin (delegated — see `signature-verifier.ts`).
 *   2. Validate the envelope shape via Zod.
 *   3. Decode `CallbackMetadata.Item[]` into a flat normalised view.
 *   4. Dedupe — on success, by `MpesaReceiptNumber`; on failure, by
 *      `CheckoutRequestID`. Caller supplies the dedupe store (a Set in
 *      tests, Redis / Postgres in production).
 *   5. Respond `200` with `{ ResultCode: 0, ResultDesc: "Accepted" }` so
 *      Safaricom does not retry.
 *
 * Everything in this module is pure of HTTP-framework concerns — call
 * `decodeStkCallback` + `processStkCallback` from any adapter.
 */

import {
  StkCallbackEnvelopeSchema,
  type StkCallbackDecoded,
  type StkCallbackEnvelope,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Pure decoder
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate + decode a raw Daraja webhook body. Pure — no IO. Returns a
 * tagged union; never throws on bad input.
 */
export function decodeStkCallback(
  rawBody: unknown,
): { ok: true; data: StkCallbackDecoded; raw: StkCallbackEnvelope } | { ok: false; issue: string } {
  const parsed = StkCallbackEnvelopeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, issue: parsed.error.message };
  }
  const cb = parsed.data.Body.stkCallback;
  const success = cb.ResultCode === 0;

  // Build a lookup of metadata items. Daraja sends an array of
  // `{ Name, Value }` — flatten to a Map for O(1) access.
  const meta = new Map<string, string | number | undefined>();
  for (const item of cb.CallbackMetadata?.Item ?? []) {
    meta.set(item.Name, item.Value);
  }

  const receipt = meta.get('MpesaReceiptNumber');
  const amount = meta.get('Amount');
  const txDate = meta.get('TransactionDate');
  const phone = meta.get('PhoneNumber');

  const decoded: StkCallbackDecoded = {
    merchantRequestId: cb.MerchantRequestID,
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc,
    success,
    ...(typeof receipt === 'string' ? { mpesaReceiptNumber: receipt } : {}),
    ...(typeof amount === 'number'
      ? { amount }
      : typeof amount === 'string'
        ? { amount: Number(amount) }
        : {}),
    ...(txDate !== undefined ? { transactionDate: String(txDate) } : {}),
    ...(phone !== undefined ? { phoneNumber: String(phone) } : {}),
  };
  return { ok: true, data: decoded, raw: parsed.data };
}

/**
 * Compute the idempotency key for an STK callback.
 *  - Success: `MpesaReceiptNumber` (Safaricom's authoritative receipt).
 *  - Failure: `CheckoutRequestID` (the only stable id without a receipt).
 *
 * Either way the result is prefixed with `mpesa-stk:` so it cannot collide
 * with idempotency keys from other connectors sharing the same dedupe store.
 */
export function stkCallbackReceiptKey(decoded: StkCallbackDecoded): string {
  const id = decoded.success
    ? (decoded.mpesaReceiptNumber ?? decoded.checkoutRequestId)
    : decoded.checkoutRequestId;
  return `mpesa-stk:${id}`;
}

// ─────────────────────────────────────────────────────────────────────
// Stateful handler — wraps decode + dedupe + ack
// ─────────────────────────────────────────────────────────────────────

/**
 * Pluggable dedupe store. Caller supplies the implementation:
 *   - In tests: a `Set<string>` wrapper.
 *   - In production: Redis `SETNX`, Postgres unique index, etc.
 *
 * `seenRecently` MUST be atomic — returning `true` while simultaneously
 * recording the key. A naive `has() + add()` pair is a race.
 */
export interface IdempotencyStore {
  /**
   * Record-and-check in one atomic op. Returns `true` if the key was
   * already present (= duplicate, skip processing). Returns `false` if
   * the key was newly recorded (= caller MUST process and apply effects).
   */
  seenRecently(key: string): Promise<boolean>;
}

/** What the handler hands back to the HTTP-framework adapter. */
export interface StkCallbackOutcome {
  /** Always `200` — Safaricom retries on any non-2xx. */
  readonly httpStatus: 200;
  /** JSON body to send back to Safaricom. */
  readonly body: { ResultCode: 0; ResultDesc: 'Accepted' };
  /**
   * Kind of processing performed:
   *   - `applied`     : new event — caller's `onPayment` was invoked.
   *   - `duplicate`   : already seen — no side-effects.
   *   - `decode-error`: malformed body — `issue` populated.
   */
  readonly kind: 'applied' | 'duplicate' | 'decode-error';
  readonly idempotencyKey?: string;
  readonly decoded?: StkCallbackDecoded;
  readonly issue?: string;
}

export interface ProcessStkCallbackDeps {
  readonly store: IdempotencyStore;
  /**
   * Side-effect callback. Invoked once per unique `MpesaReceiptNumber`
   * (or `CheckoutRequestID` on failure). Caller persists, ledger-posts,
   * emits an event, etc. Errors propagate to the HTTP layer.
   */
  readonly onPayment: (decoded: StkCallbackDecoded) => Promise<void>;
}

/**
 * End-to-end handler — decode → dedupe → onPayment → ack. Always ACKs
 * 200 even on decode failure (Safaricom would otherwise retry forever).
 * Decode failures are surfaced via `kind === 'decode-error'` so the
 * caller can log/alert.
 */
export async function processStkCallback(
  deps: ProcessStkCallbackDeps,
  rawBody: unknown,
): Promise<StkCallbackOutcome> {
  const decoded = decodeStkCallback(rawBody);
  if (!decoded.ok) {
    return {
      httpStatus: 200,
      body: { ResultCode: 0, ResultDesc: 'Accepted' },
      kind: 'decode-error',
      issue: decoded.issue,
    };
  }
  const key = stkCallbackReceiptKey(decoded.data);
  const seen = await deps.store.seenRecently(key);
  if (seen) {
    return {
      httpStatus: 200,
      body: { ResultCode: 0, ResultDesc: 'Accepted' },
      kind: 'duplicate',
      idempotencyKey: key,
      decoded: decoded.data,
    };
  }
  await deps.onPayment(decoded.data);
  return {
    httpStatus: 200,
    body: { ResultCode: 0, ResultDesc: 'Accepted' },
    kind: 'applied',
    idempotencyKey: key,
    decoded: decoded.data,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Convenience — in-memory store for tests
// ─────────────────────────────────────────────────────────────────────

/**
 * In-memory idempotency store. Useful for unit tests + local dev. NOT
 * suitable for production (single-process, no TTL). Production must use
 * Redis / Postgres / similar.
 */
export function createInMemoryIdempotencyStore(): IdempotencyStore & {
  readonly size: () => number;
  readonly clear: () => void;
} {
  const seen = new Set<string>();
  return {
    async seenRecently(key: string): Promise<boolean> {
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    },
    size: () => seen.size,
    clear: () => seen.clear(),
  };
}
