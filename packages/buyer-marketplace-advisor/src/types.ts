/**
 * Zod schemas + TypeScript types for the buyer-marketplace-advisor.
 *
 * All public surface accepts unknown input and parses via Zod at the
 * boundary; nothing internal trusts external shape.
 */

import { z } from 'zod';

// ─── Primitives ─────────────────────────────────────────────────────

export const commoditySchema = z.enum([
  'gold',
  'copper',
  'silver',
  'tin',
  'tanzanite',
  'graphite',
  'coal',
  'iron-ore',
  'nickel',
  'cobalt',
]);
export type Commodity = z.infer<typeof commoditySchema>;

export const currencyCodeSchema = z.enum(['USD', 'TZS', 'EUR', 'GBP', 'CNY']);
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;

export const lngLatSchema = z.tuple([z.number(), z.number()]);
export type LngLat = z.infer<typeof lngLatSchema>;

export const riskBandSchema = z.enum(['low', 'medium', 'high']);
export type RiskBand = z.infer<typeof riskBandSchema>;

export const paymentInstrumentSchema = z.enum([
  'net-30',
  'net-60',
  'letter-of-credit',
  'escrow',
  'cash-against-documents',
  'open-account',
]);
export type PaymentInstrument = z.infer<typeof paymentInstrumentSchema>;

// ─── Buyer need ─────────────────────────────────────────────────────

export const buyerNeedSchema = z.object({
  buyerId: z.string().min(1),
  tenantId: z.string().min(1),
  commodity: commoditySchema,
  /** Required volume in tonnes. */
  volumeTonnes: z.number().positive(),
  /** Optional minimum grade (commodity-specific unit, e.g. g/t Au). */
  minGrade: z.number().nonnegative().optional(),
  /** Preferred origin regions (ISO-3166-2 codes or free-text region IDs). */
  preferredRegions: z.array(z.string()).default([]),
  /** Optional max price ceiling per tonne in USD. */
  maxPriceUsdPerTonne: z.number().positive().optional(),
  /** Optional destination port for ETA estimation. */
  destinationPort: z.string().optional(),
  /** Desired delivery window ISO date — best-effort. */
  desiredDeliveryByISO: z.string().optional(),
});
export type BuyerNeed = z.infer<typeof buyerNeedSchema>;

// ─── Mine catalog ───────────────────────────────────────────────────

export const mineProfileSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string(),
  commodity: commoditySchema,
  /** ISO region code or label — e.g. 'TZ-15' for Mwanza. */
  regionId: z.string(),
  location: lngLatSchema,
  /** Monthly producible tonnage. */
  monthlyOutputTonnes: z.number().nonnegative(),
  /** Avg grade in commodity-specific unit. */
  averageGrade: z.number().nonnegative(),
  /** Indicative ex-mine price USD/t. */
  indicativePriceUsdPerTonne: z.number().positive(),
  /** Compliance posture cached as low/medium/high. */
  complianceRisk: riskBandSchema.default('low'),
  /** Days from mine to typical export gateway. */
  baseLeadTimeDays: z.number().int().nonnegative().default(14),
});
export type MineProfile = z.infer<typeof mineProfileSchema>;

// ─── Mine recommendation ────────────────────────────────────────────

export const mineRecommendationSchema = z.object({
  mineId: z.string(),
  mineName: z.string(),
  /** 0..100 — higher is better fit. */
  fitScore: z.number().min(0).max(100),
  rationale: z.string(),
  indicativePriceUsdPerTonne: z.number(),
  availableTonnes: z.number().nonnegative(),
  estimatedLeadTimeDays: z.number().int().nonnegative(),
  factors: z.array(
    z.object({
      label: z.string(),
      weight: z.number(),
      contribution: z.number(),
    }),
  ),
});
export type MineRecommendation = z.infer<typeof mineRecommendationSchema>;

// ─── KYC ────────────────────────────────────────────────────────────

export const kycFactSchema = z.object({
  buyerId: z.string(),
  tenantId: z.string(),
  /** Country of registration. */
  countryCode: z.string().length(2),
  /** Sanctioned-list flag from upstream screening. */
  sanctionsHit: z.boolean(),
  /** Politically Exposed Person flag. */
  pepFlag: z.boolean(),
  /** Adverse media count last 12 months. */
  adverseMediaCount: z.number().int().nonnegative().default(0),
  /** Years in business. */
  yearsInBusiness: z.number().nonnegative().default(0),
  /** Has audited financials. */
  auditedFinancials: z.boolean().default(false),
  /** Cumulative completed trade value USD. */
  completedTradeUsd: z.number().nonnegative().default(0),
});
export type KycFact = z.infer<typeof kycFactSchema>;

export const kycRiskReportSchema = z.object({
  buyerId: z.string(),
  tenantId: z.string(),
  band: riskBandSchema,
  /** 0..100 — higher = riskier. */
  score: z.number().min(0).max(100),
  factors: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      weight: z.number(),
      hit: z.boolean(),
    }),
  ),
  blockers: z.array(z.string()),
});
export type KycRiskReport = z.infer<typeof kycRiskReportSchema>;

// ─── Payment terms ──────────────────────────────────────────────────

export const paymentTermProposalInputSchema = z.object({
  buyerId: z.string(),
  tenantId: z.string(),
  totalValueUsd: z.number().positive(),
  buyerRisk: riskBandSchema,
  buyerCurrency: currencyCodeSchema.default('USD'),
  sellerCurrency: currencyCodeSchema.default('USD'),
  /** Expected days from order to delivery. */
  expectedLeadTimeDays: z.number().int().nonnegative().default(30),
});
export type PaymentTermProposalInput = z.infer<typeof paymentTermProposalInputSchema>;

export const fxHedgeRungSchema = z.object({
  bucketDays: z.number().int().positive(),
  notionalUsd: z.number().nonnegative(),
  instrument: z.enum(['spot', 'forward', 'option']),
});
export type FxHedgeRung = z.infer<typeof fxHedgeRungSchema>;

export const paymentTermProposalSchema = z.object({
  buyerId: z.string(),
  tenantId: z.string(),
  primary: paymentInstrumentSchema,
  /** Ranked alternatives — first is fallback. */
  alternatives: z.array(paymentInstrumentSchema),
  /** Required deposit %  of total value. */
  depositPct: z.number().min(0).max(100),
  /** Suggested FX hedge ladder. */
  fxHedgeLadder: z.array(fxHedgeRungSchema),
  rationale: z.string(),
});
export type PaymentTermProposal = z.infer<typeof paymentTermProposalSchema>;

// ─── ETA estimate ───────────────────────────────────────────────────

export const etaEstimateInputSchema = z.object({
  originMineId: z.string().min(1),
  destPort: z.string().min(1),
  tonnage: z.number().positive(),
});
export type EtaEstimateInput = z.infer<typeof etaEstimateInputSchema>;

export const etaEstimateSchema = z.object({
  originMineId: z.string(),
  destPort: z.string(),
  days: z.number().positive(),
  /** 0..1 — higher = more uncertain. */
  uncertainty: z.number().min(0).max(1),
  /** Ordered route waypoints. */
  route: z.array(z.string()),
  /** Active disruption flags (strikes, floods, border closures, etc.). */
  disruptionFlags: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      severity: z.enum(['low', 'medium', 'high']),
    }),
  ),
});
export type EtaEstimate = z.infer<typeof etaEstimateSchema>;
