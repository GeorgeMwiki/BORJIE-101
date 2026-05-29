/**
 * Settlement orchestrator — public surface.
 *
 * Commercial chain L8 — the sign-delivery → ledger → payout chain.
 * Pure service classes; the route handler in
 * routes/marketplace/rfb.hono.ts wires them with the injected
 * SettlementLedgerPort + SettlementPayoutPort.
 */

export {
  SettlementOrchestrator,
  SettlementError,
  type SettlementOrchestratorDeps,
} from './orchestrator';

export {
  computeSettlementMath,
  royaltyRateForMineral,
  round2,
  DEFAULT_ROYALTY_RATE,
  ROYALTY_RATES_BY_MINERAL,
  PLATFORM_FEE_RATE,
  type SettlementStatus,
  type SettlementMath,
  type PayoutProvider,
  type SignDeliveryInput,
  type SignDeliveryResult,
  type SettlementLedgerPort,
  type SettlementLedgerPostInput,
  type SettlementLedgerPostResult,
  type SettlementPayoutPort,
  type SettlementPayoutInput,
  type SettlementPayoutResult,
} from './types';

import type {
  SettlementLedgerPort,
  SettlementPayoutPort,
  SettlementLedgerPostInput,
  SettlementLedgerPostResult,
  SettlementPayoutInput,
  SettlementPayoutResult,
} from './types';
import { createHash } from 'node:crypto';

let ledgerPortOverride: SettlementLedgerPort | null = null;
let payoutPortOverride: SettlementPayoutPort | null = null;

/** Test seam — override the ledger port. */
export function __setSettlementLedgerPortForTests(
  port: SettlementLedgerPort | null,
): void {
  ledgerPortOverride = port;
}

/** Test seam — override the payout port. */
export function __setSettlementPayoutPortForTests(
  port: SettlementPayoutPort | null,
): void {
  payoutPortOverride = port;
}

/**
 * Resolve the active settlement ledger port. Production composition
 * registers an adapter wrapping `LedgerService.post()` from the
 * payments-ledger package (CLAUDE.md hard rule).
 *
 * Dev fallback: deterministic SHA-256-derived journal id so the
 * chain still completes end-to-end without a live ledger.
 */
export function resolveSettlementLedgerPort(): SettlementLedgerPort {
  if (ledgerPortOverride) return ledgerPortOverride;
  return {
    async post(
      input: SettlementLedgerPostInput,
    ): Promise<SettlementLedgerPostResult> {
      const seed = `${input.tenantId}:${input.responseId}:${input.idempotencyKey}`;
      const journalId = `stl-jrn-${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`;
      return { journalId };
    },
  };
}

/**
 * Resolve the active payout port. Production composition wires
 * M-Pesa B2C / wallet-credit / future-Stripe per the seller's
 * payout-preference profile. Dev fallback returns a deterministic
 * stub so tests + dev flows complete.
 */
export function resolveSettlementPayoutPort(): SettlementPayoutPort {
  if (payoutPortOverride) return payoutPortOverride;
  return {
    async payout(
      input: SettlementPayoutInput,
    ): Promise<SettlementPayoutResult> {
      const seed = `${input.settlementId}:${input.sellerUserId}`;
      const providerRef = `mpesa-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
      return { provider: 'mpesa_b2c', providerRef };
    },
  };
}
