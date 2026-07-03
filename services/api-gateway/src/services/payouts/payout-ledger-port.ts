/**
 * Payout money-out ledger port (Blocker 4 — the disbursement DEBIT leg).
 *
 * THE DEFECT THIS CLOSES: the monthly-close orchestrator deliberately does
 * NOT import payments-ledger (orchestrator-service.ts header) and posts NO
 * ledger leg anywhere — not an accrual, not a payable. The payouts worker
 * then dispatches real cash via M-Pesa B2C / EFT and only flips the outbox
 * row to `published`. Cash leaves the business with NO money-out journal, so
 * the books never reflect the disbursement (violates the CLAUDE.md "money
 * path through LedgerService.post()" hard rule).
 *
 * WHAT THE CLEARING JOURNAL RECORDS. On a SUCCESSFUL send the worker posts a
 * balanced 2-leg journal through the REAL `LedgerService.post()`:
 *
 *   DR  seller_payable   net   (extinguish the liability owed to the owner)
 *   CR  cash_clearing    net   (cash has left the business via the rail)
 *
 * The monthly-close disbursement is the CLEARING of what the owner is owed;
 * debiting `seller_payable` and crediting `cash_clearing` is the honest
 * money-out entry. (There is no upstream accrual to net against in this lane —
 * the orchestrator posts nothing — so this journal stands alone and balances
 * on its own two legs.)
 *
 * IDEMPOTENCY (replay-safe). The ledger `idempotencyKey` is a pure function of
 * the MONEY content — a SHA-256 over the outbox idempotencyKey AND the integer
 * amount AND the currency. `LedgerService.postJournalEntry` records it under a
 * UNIQUE (tenant_id, idempotency_key) row inside the SAME transaction as the
 * atomic post, so a reclaim/replay of the identical payout returns the
 * ORIGINAL journal (never a double-post), while ANY amount change forces a
 * fresh post. Mirrors the settlement / payroll adapters' money-key discipline.
 *
 * The real adapter lives in composition/ledger (wired at boot with the
 * gateway's LedgerService); this file owns only the port TYPE + a factory the
 * composition root calls. Kept free of a hard payments-ledger import so the
 * worker + its unit tests stay lightweight — the composition root supplies the
 * concrete `LedgerService`-backed implementation.
 */

export interface PayoutLedgerPostInput {
  readonly tenantId: string;
  readonly ownerId: string;
  /** Integer minor units — the net disbursed to the owner. */
  readonly amountMinor: number;
  readonly currency: string;
  /** The outbox idempotencyKey (`${run.id}:${ownerId}`) — money-key seed. */
  readonly idempotencyKey: string;
  /** The rail's transaction id (Daraja ConversationID / EFT ref) — audit only. */
  readonly providerRef: string;
}

export interface PayoutLedgerPostResult {
  /** Journal id from LedgerService.post(). */
  readonly journalId: string;
}

export interface PayoutLedgerPort {
  post(input: PayoutLedgerPostInput): Promise<PayoutLedgerPostResult>;
}

// ---------------------------------------------------------------------------
// Composition seam — the boot wiring registers the REAL LedgerService-backed
// adapter here; the worker resolves it. Mirrors the settlement port's
// `__set*`/`resolve*` seams so the worker never imports payments-ledger.
// ---------------------------------------------------------------------------

let productionPort: PayoutLedgerPort | null = null;
let testOverride: PayoutLedgerPort | null = null;

/** Composition-root seam — register the REAL adapter once at boot. */
export function __setPayoutProductionLedgerPort(
  port: PayoutLedgerPort | null,
): void {
  productionPort = port;
}

/** Test seam — override the port (wins over production). */
export function __setPayoutLedgerPortForTests(
  port: PayoutLedgerPort | null,
): void {
  testOverride = port;
}

/**
 * Resolve the active payout ledger port, or `null` when none is wired (no db /
 * dev). Returning null (rather than a no-op stub) is deliberate: the worker
 * skips ledger posting only when NO port exists, and the composition root wires
 * the real port whenever a database is present. A dev/no-db boot leaves it null
 * so the worker does not fabricate a money-out leg it cannot durably record.
 */
export function resolvePayoutLedgerPort(): PayoutLedgerPort | null {
  return testOverride ?? productionPort;
}
