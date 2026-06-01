/**
 * Settlement orchestrator — commercial chain L8 types.
 *
 * Money math (TZS, primary currency):
 *   gross   = offered_tonnage * offered_price_tzs
 *   royalty = gross * ROYALTY_RATE  (mineral-kind specific; default 7%)
 *   fee     = gross * PLATFORM_FEE_RATE  (1.5%)
 *   net     = gross - royalty - fee
 *
 * Money path (CLAUDE.md hard rule): every settlement runs
 * `LedgerService.post()` via the SettlementLedgerPort seam. The
 * journal must be balanced (debits = credits) — the orchestrator
 * builds three lines:
 *   DR  buyer_settlement_pool   gross
 *   CR  royalty_payable         royalty
 *   CR  platform_fee_revenue    fee
 *   CR  seller_payout_pool      net
 * (gross debit = royalty + fee + net credits.)
 */

export type SettlementStatus =
  | 'pending'
  | 'posted'
  | 'paying_out'
  | 'completed'
  | 'failed';

export type PayoutProvider = 'mpesa_b2c' | 'wallet' | 'stripe';

export interface SettlementMath {
  readonly grossTzs: number;
  readonly royaltyTzs: number;
  readonly feeTzs: number;
  readonly netTzs: number;
}

export interface SignDeliveryInput {
  readonly tenantId: string;
  readonly buyerUserId: string;
  readonly responseId: string;
  readonly coCStepChecksum: string;
}

export interface SignDeliveryResult {
  readonly settlementId: string;
  readonly status: SettlementStatus;
  readonly math: SettlementMath;
  readonly ledgerTxnId: string | null;
  readonly payoutProvider: PayoutProvider | null;
  readonly payoutProviderRef: string | null;
  readonly idempotent: boolean;
}

export interface SettlementLedgerPostInput {
  readonly tenantId: string;
  readonly responseId: string;
  readonly idempotencyKey: string;
  readonly math: SettlementMath;
}

export interface SettlementLedgerPostResult {
  /** Journal id from LedgerService.post(). */
  readonly journalId: string;
}

export interface SettlementLedgerPort {
  post(input: SettlementLedgerPostInput): Promise<SettlementLedgerPostResult>;
}

export interface SettlementPayoutInput {
  readonly tenantId: string;
  readonly settlementId: string;
  readonly netTzs: number;
  readonly sellerUserId: string;
}

export interface SettlementPayoutResult {
  readonly provider: PayoutProvider;
  readonly providerRef: string;
}

export interface SettlementPayoutPort {
  payout(input: SettlementPayoutInput): Promise<SettlementPayoutResult>;
}

/**
 * Default royalty rate when the mineral kind doesn't have a specific
 * override. Tanzanian gold mining levy is 7%, matching the corpus.
 */
export const DEFAULT_ROYALTY_RATE = 0.07;

/**
 * Per-mineral royalty rates (Tanzania). Add new rates here as the
 * mineral catalog grows. Numbers in [0, 1].
 */
export const ROYALTY_RATES_BY_MINERAL: Readonly<Record<string, number>> = {
  gold: 0.07,
  tanzanite: 0.06,
  diamond: 0.06,
  copper: 0.05,
  cobalt: 0.05,
  nickel: 0.05,
  iron: 0.03,
  coal: 0.03,
  silver: 0.04,
  rare_earth: 0.05,
  limestone: 0.03,
  gypsum: 0.03,
  salt: 0.03,
  gemstone_other: 0.06,
};

/** Borjie platform fee — 1.5% of gross. */
export const PLATFORM_FEE_RATE = 0.015;

export function royaltyRateForMineral(mineralKind: string): number {
  return ROYALTY_RATES_BY_MINERAL[mineralKind] ?? DEFAULT_ROYALTY_RATE;
}

/**
 * Compute the settlement math from a response row — INTEGER minor units
 * end-to-end (no float on the money path).
 *
 * The `settlements` money columns are BIGINT integer minor units and the
 * ledger journal posts integer minor units; the previous float `round2`
 * pipeline could round a leg differently from the ledger boundary's own
 * `Math.round`, so the settlements row and the ledger journal could
 * disagree by 1 shilling per leg. We integerise ONCE here so this is the
 * single integer source of truth fed into BOTH the settlements INSERT
 * (orchestrator) AND the ledger post (`splitSettlementMinorUnits`):
 *
 *   gross   = round(tonnage * price)            — once, at the boundary
 *   royalty = round(gross * royaltyRate)        — independent integer leg
 *   fee     = round(gross * PLATFORM_FEE_RATE)  — independent integer leg
 *   net     = gross - royalty - fee             — exact integer remainder
 *
 * `net` as the remainder guarantees the double-entry identity
 * `gross === royalty + fee + net` at integer scale (the seller absorbs any
 * sub-unit rounding residual — the economically correct plug). The result
 * satisfies the `settlements_math_chk` CHECK (net = gross - royalty - fee)
 * exactly, because all four are integers derived from one another.
 *
 * For TZS (0-decimal) one minor unit == one shilling so these integers are
 * also whole shillings. For a 2-decimal expansion currency the upstream
 * tonnage/price would already be supplied in minor units.
 */
export function computeSettlementMath(input: {
  readonly offeredTonnage: number;
  readonly offeredPriceTzs: number;
  readonly mineralKind: string;
}): SettlementMath {
  if (input.offeredTonnage <= 0) {
    throw new Error('offeredTonnage must be positive');
  }
  if (input.offeredPriceTzs <= 0) {
    throw new Error('offeredPriceTzs must be positive');
  }
  const grossTzs = Math.round(input.offeredTonnage * input.offeredPriceTzs);
  const royaltyRate = royaltyRateForMineral(input.mineralKind);
  const royaltyTzs = Math.round(grossTzs * royaltyRate);
  const feeTzs = Math.round(grossTzs * PLATFORM_FEE_RATE);
  // net is the exact integer remainder — guarantees gross === royalty +
  // fee + net so the journal provably balances and the CHECK holds.
  const netTzs = grossTzs - royaltyTzs - feeTzs;
  return { grossTzs, royaltyTzs, feeTzs, netTzs };
}
