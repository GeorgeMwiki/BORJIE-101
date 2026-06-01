/**
 * M-Pesa Daraja ResultCode classification (EDGE-HARDENING #5).
 *
 * The Daraja STK callback (`Body.stkCallback.ResultCode`) and B2C result
 * (`Result.ResultCode`) envelopes carry the REAL outcome of a transaction.
 * ResultCode 0 == success; any NON-ZERO value == failure. The previous
 * callback path treated every delivery as a success (it returned/acted on
 * an implicit `ResultCode: 0`), so a genuinely failed STK (insufficient
 * funds, wrong PIN, user cancel, timeout) could still credit the ledger or
 * mark a payment SUCCEEDED — silent money loss / mis-credit.
 *
 * This module is the single source of truth for "is this code a success?"
 * and "what human reason does this code map to?". The webhook handlers post
 * to the ledger ONLY when {@link isMpesaSuccess} is true.
 *
 * Codes below are the documented Safaricom Daraja STK/B2C result codes.
 * Unknown non-zero codes still classify as FAILURE (fail-closed) with a
 * generic reason that preserves the raw code for forensics.
 */

/** Canonical success sentinel. The ONLY code that may credit the ledger. */
export const MPESA_SUCCESS_CODE = 0 as const;

/**
 * Known Daraja result codes → stable failure reason slug. Success (0) is
 * intentionally absent; callers gate on {@link isMpesaSuccess} first.
 */
const RESULT_REASONS: Readonly<Record<number, string>> = {
  1: 'insufficient-balance',
  1001: 'subscriber-locked', // unable to lock subscriber / already in process
  1019: 'transaction-expired',
  1025: 'system-error-push', // error while sending push / invalid request
  1032: 'cancelled-by-user', // request cancelled by user (STK declined)
  1037: 'timeout-no-response', // DS timeout / user cannot be reached
  1101: 'duplicate-or-credit-failed',
  2001: 'invalid-initiator-or-pin', // wrong PIN / initiator info invalid
  9999: 'push-request-error',
  // B2C-specific (Result.ResultCode) commonly-seen failures.
  2026: 'traffic-blocking', // system busy, traffic blocked
  17: 'system-internal-error',
};

/**
 * True iff the code denotes a successful M-Pesa transaction. The handlers
 * MUST NOT credit the ledger or mark a payment SUCCEEDED unless this is
 * true (AND the amounts reconcile).
 */
export function isMpesaSuccess(resultCode: number): boolean {
  return resultCode === MPESA_SUCCESS_CODE;
}

/**
 * Map a NON-ZERO ResultCode to a stable, human-readable failure reason.
 * Unknown codes fail closed to a generic slug that retains the raw code so
 * operators can trace the exact Daraja outcome. Never returns 'success'.
 */
export function mpesaResultReason(resultCode: number, resultDesc?: string): string {
  if (resultCode === MPESA_SUCCESS_CODE) {
    // Defensive: callers should not ask for a "reason" on success, but if
    // they do, never imply a failure.
    return 'success';
  }
  const known = RESULT_REASONS[resultCode];
  if (known) return known;
  const desc = resultDesc?.trim();
  return desc
    ? `mpesa-failure-${resultCode}:${desc.slice(0, 80)}`
    : `mpesa-failure-${resultCode}`;
}
