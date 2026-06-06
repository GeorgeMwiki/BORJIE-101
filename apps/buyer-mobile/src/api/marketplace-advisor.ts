/**
 * Buyer marketplace-advisor API client.
 *
 * Thin typed wrappers over the gateway's buyer-side advisor surface
 * (`@borjie/buyer-marketplace-advisor` exposed at
 * `/api/v1/mining/marketplace-advisor/*` — see
 * services/api-gateway/src/routes/mining/marketplace-advisor.hono.ts).
 *
 * The advisor is pure compute server-side: it ranks live mineral-supply
 * listings against the buyer's need (volume / grade / price / region /
 * compliance), proposes payment instruments + an FX hedge ladder, and
 * estimates delivery ETA. Buyer identity + tenant are taken from the
 * session token server-side — never sent in the body.
 *
 * Currency: amounts are USD-denominated by the advisor's trade model
 * (the seller-listing TZS price is converted server-side using the
 * `fxTzsPerUsd` we pass). The caller renders with the buyer's locale
 * formatter — no currency is hard-coded here.
 */

import { apiFetch } from './client'
import { MINING_PREFIX } from './config'
import type { Mineral } from '@/types/listing'

const ADVISOR_PREFIX = `${MINING_PREFIX}/marketplace-advisor`

// ── Commodity axis (advisor enum — base minerals) ───────────────────
export type AdvisorCommodity =
  | 'gold'
  | 'copper'
  | 'silver'
  | 'tin'
  | 'tanzanite'
  | 'graphite'
  | 'coal'
  | 'iron-ore'
  | 'nickel'
  | 'cobalt'

/**
 * Map the marketplace's product-grade `Mineral` union down to the
 * advisor's base-commodity axis so a buyer browsing `gold_concentrate`
 * listings can request `gold` recommendations.
 */
export function mineralToCommodity(mineral: Mineral): AdvisorCommodity {
  switch (mineral) {
    case 'gold_concentrate':
    case 'gold_dore':
      return 'gold'
    case 'tanzanite_rough':
    case 'gemstone_mixed':
      return 'tanzanite'
    case 'coltan':
      return 'cobalt'
    case 'copper_concentrate':
      return 'copper'
    case 'tin_cassiterite':
      return 'tin'
    case 'silver_concentrate':
      return 'silver'
    default:
      return 'gold'
  }
}

// ── Recommend mines ─────────────────────────────────────────────────

export interface RecommendMinesInput {
  readonly commodity: AdvisorCommodity
  readonly volumeTonnes: number
  readonly minGrade?: number
  readonly preferredRegions?: readonly string[]
  readonly maxPriceUsdPerTonne?: number
  readonly destinationPort?: string
  /** TZS per 1 USD — converts seller-listing prices to the USD axis. */
  readonly fxTzsPerUsd: number
}

export interface RecommendationFactor {
  readonly label: string
  readonly weight: number
  readonly contribution: number
}

export interface MineRecommendation {
  readonly mineId: string
  readonly mineName: string
  readonly fitScore: number
  readonly rationale: string
  readonly indicativePriceUsdPerTonne: number
  readonly availableTonnes: number
  readonly estimatedLeadTimeDays: number
  readonly factors: readonly RecommendationFactor[]
}

interface RecommendResponse {
  readonly data: readonly MineRecommendation[]
}

export async function recommendMines(
  input: RecommendMinesInput,
  signal?: AbortSignal,
): Promise<readonly MineRecommendation[]> {
  const { fxTzsPerUsd, ...need } = input
  const response = await apiFetch<RecommendResponse>(
    `${ADVISOR_PREFIX}/recommend-mines`,
    {
      method: 'POST',
      body: {
        need: {
          commodity: need.commodity,
          volumeTonnes: need.volumeTonnes,
          ...(need.minGrade !== undefined ? { minGrade: need.minGrade } : {}),
          preferredRegions: need.preferredRegions ?? [],
          ...(need.maxPriceUsdPerTonne !== undefined
            ? { maxPriceUsdPerTonne: need.maxPriceUsdPerTonne }
            : {}),
          ...(need.destinationPort !== undefined
            ? { destinationPort: need.destinationPort }
            : {}),
        },
        fxTzsPerUsd,
      },
      signal,
    },
  )
  return response.data
}

// ── Payment terms ───────────────────────────────────────────────────

export type RiskBand = 'low' | 'medium' | 'high'
export type PaymentInstrument =
  | 'net-30'
  | 'net-60'
  | 'letter-of-credit'
  | 'escrow'
  | 'cash-against-documents'
  | 'open-account'
export type CurrencyCode = 'USD' | 'TZS' | 'EUR' | 'GBP' | 'CNY'

export interface PaymentTermsInput {
  readonly totalValueUsd: number
  readonly buyerRisk: RiskBand
  readonly buyerCurrency?: CurrencyCode
  readonly sellerCurrency?: CurrencyCode
  readonly expectedLeadTimeDays?: number
}

export interface FxHedgeRung {
  readonly bucketDays: number
  readonly notionalUsd: number
  readonly instrument: 'spot' | 'forward' | 'option'
}

export interface PaymentTermProposal {
  readonly primary: PaymentInstrument
  readonly alternatives: readonly PaymentInstrument[]
  readonly depositPct: number
  readonly fxHedgeLadder: readonly FxHedgeRung[]
  readonly rationale: string
}

interface PaymentTermsResponse {
  readonly data: PaymentTermProposal
}

export async function proposePaymentTerms(
  input: PaymentTermsInput,
  signal?: AbortSignal,
): Promise<PaymentTermProposal> {
  const response = await apiFetch<PaymentTermsResponse>(
    `${ADVISOR_PREFIX}/payment-terms`,
    {
      method: 'POST',
      body: {
        totalValueUsd: input.totalValueUsd,
        buyerRisk: input.buyerRisk,
        ...(input.buyerCurrency ? { buyerCurrency: input.buyerCurrency } : {}),
        ...(input.sellerCurrency
          ? { sellerCurrency: input.sellerCurrency }
          : {}),
        ...(input.expectedLeadTimeDays !== undefined
          ? { expectedLeadTimeDays: input.expectedLeadTimeDays }
          : {}),
      },
      signal,
    },
  )
  return response.data
}

// ── ETA estimate ────────────────────────────────────────────────────

export interface EtaInput {
  readonly originMineId: string
  readonly destPort: string
  readonly tonnage: number
}

export interface EtaDisruptionFlag {
  readonly code: string
  readonly label: string
  readonly severity: 'low' | 'medium' | 'high'
}

export interface EtaEstimate {
  readonly originMineId: string
  readonly destPort: string
  readonly days: number
  readonly uncertainty: number
  readonly route: readonly string[]
  readonly disruptionFlags: readonly EtaDisruptionFlag[]
}

interface EtaResponse {
  readonly data: EtaEstimate
}

export async function estimateEta(
  input: EtaInput,
  signal?: AbortSignal,
): Promise<EtaEstimate> {
  const response = await apiFetch<EtaResponse>(`${ADVISOR_PREFIX}/eta`, {
    method: 'POST',
    body: input,
    signal,
  })
  return response.data
}
