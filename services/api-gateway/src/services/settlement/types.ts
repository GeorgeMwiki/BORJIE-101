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
 * Round to two decimals — TZS settlements are stored as numeric(15,2)
 * per the migration. We round half-up.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the settlement math from a response row.
 *
 * Inputs are positive numbers. The result satisfies the migration's
 * CHECK constraint: net = gross - royalty - fee.
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
  const grossTzs = round2(input.offeredTonnage * input.offeredPriceTzs);
  const royaltyRate = royaltyRateForMineral(input.mineralKind);
  const royaltyTzs = round2(grossTzs * royaltyRate);
  const feeTzs = round2(grossTzs * PLATFORM_FEE_RATE);
  // Compute net as gross - royalty - fee then round; the CHECK
  // constraint will refuse rows that don't satisfy this identity.
  const netTzs = round2(grossTzs - royaltyTzs - feeTzs);
  return { grossTzs, royaltyTzs, feeTzs, netTzs };
}
