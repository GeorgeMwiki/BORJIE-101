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
// Value import (the re-export above is for consumers; this brings the
// class into local scope so the fail-loud resolver can throw it).
import { SettlementError } from './orchestrator';
import { createHash } from 'node:crypto';

let ledgerPortOverride: SettlementLedgerPort | null = null;
let ledgerPortProduction: SettlementLedgerPort | null = null;
let payoutPortOverride: SettlementPayoutPort | null = null;
// Fail-loud guard (M1). The dev SHA-256 stub writes NOTHING to the ledger
// yet returns a fake journal id — if it were ever reached in an
// environment that HAS a database, the orchestrator would stamp
// status='posted' and fire the M-Pesa payout while no ledger entry exists
// (real money leaves with no double-entry record). The stub is therefore
// gated: it is reachable ONLY after the composition root has EXPLICITLY
// declared no-db mode via `__allowSettlementLedgerStub(true)` (called from
// `registerProductionLedgerPorts` solely when `getDb()` is null). In any
// other state with no production port, `resolveSettlementLedgerPort`
// throws a loud LEDGER_NOT_WIRED instead of silently no-op-posting.
let ledgerStubAllowed = false;

/** Test seam — override the ledger port (wins over production + stub). */
export function __setSettlementLedgerPortForTests(
  port: SettlementLedgerPort | null,
): void {
  ledgerPortOverride = port;
}

/**
 * Composition-root seam — register the REAL LedgerService-backed adapter.
 * Installed once at boot by `composition/ledger`. Takes precedence over
 * the dev stub but NOT over a test override.
 */
export function __setSettlementProductionLedgerPort(
  port: SettlementLedgerPort | null,
): void {
  ledgerPortProduction = port;
}

/**
 * Composition-root seam (M1) — declare that the dev stub is allowed because
 * there is NO database (DATABASE_URL unset). Called from
 * `registerProductionLedgerPorts` ONLY in the `db === null` branch. When
 * never called, `resolveSettlementLedgerPort` fails loud rather than
 * returning the money-losing stub.
 */
export function __allowSettlementLedgerStub(allowed: boolean): void {
  ledgerStubAllowed = allowed;
}

/** Test seam — override the payout port. */
export function __setSettlementPayoutPortForTests(
  port: SettlementPayoutPort | null,
): void {
  payoutPortOverride = port;
}

/**
 * Resolve the active settlement ledger port. Resolution order:
 *   1. test override (in-memory adapter), when set;
 *   2. production adapter wrapping the REAL `LedgerService.post()` from
 *      `@borjie/payments-ledger-service`, registered once at boot by
 *      `composition/ledger` (CLAUDE.md "money goes through
 *      LedgerService.post()" hard rule — this is the live money path);
 *   3. dev stub — ONLY reached when neither is wired AND the composition
 *      root has explicitly declared no-db mode (`__allowSettlementLedgerStub`).
 *      It writes NOTHING to the ledger and returns a deterministic
 *      SHA-256-derived id purely so dev flows complete.
 *
 * If a database EXISTS but no production port is registered, this throws a
 * loud `LEDGER_NOT_WIRED` (M1) — never the money-losing stub. That state
 * means boot-time ledger wiring failed; failing loud here stops the
 * orchestrator from stamping status='posted' and firing a real M-Pesa
 * payout with no backing ledger entry.
 */
export function resolveSettlementLedgerPort(): SettlementLedgerPort {
  if (ledgerPortOverride) return ledgerPortOverride;
  if (ledgerPortProduction) return ledgerPortProduction;
  if (!ledgerStubAllowed) {
    throw new SettlementError(
      'LEDGER_NOT_WIRED',
      'Settlement ledger port is not wired: a database is present but the ' +
        'production LedgerService adapter was not registered (boot wiring ' +
        'failed). Refusing the dev stub, which would post NOTHING to the ' +
        'ledger while the orchestrator fires a real payout.',
    );
  }
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
