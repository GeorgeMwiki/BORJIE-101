/**
 * skill.estate.get_tenant_credit — portable, FICO-scale credit rating.
 *
 * Invoked when an operator asks "how reliable is the unit-4B tenant?",
 * "credit rating for customer X?". Composes `scoreTenantCredit` from the
 * credit-rating subtree and returns a structured response the UI binds to
 * a credit_rating_card blackboard block (gauge, letter grade, dimension
 * bars, recommended action).
 */

import { z } from 'zod';
import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  DEFAULT_GRADING_WEIGHTS,
  GradingWeights,
  scoreTenantCredit,
  CreditRating,
  CreditRatingInputs,
} from '../../credit-rating/index.js';

export const TenantCreditParamsSchema = z.object({
  tenantId: z.string().min(1),
  customerId: z.string().min(1),
  totalInvoices: z.number().int().nonnegative(),
  paidOnTimeCount: z.number().int().nonnegative(),
  paidLate30DaysCount: z.number().int().nonnegative().default(0),
  paidLate60DaysCount: z.number().int().nonnegative().default(0),
  paidLate90PlusCount: z.number().int().nonnegative().default(0),
  defaultCount: z.number().int().nonnegative().default(0),
  extensionsGranted: z.number().int().nonnegative().default(0),
  extensionsHonored: z.number().int().nonnegative().default(0),
  installmentAgreementsOffered: z.number().int().nonnegative().default(0),
  installmentAgreementsHonored: z.number().int().nonnegative().default(0),
  rentToIncomeRatio: z.number().nullable().default(null),
  avgTenancyMonths: z.number().nonnegative().default(0),
  activeTenancyCount: z.number().int().nonnegative().default(0),
  disputeCount: z.number().int().nonnegative().default(0),
  damageDeductionCount: z.number().int().nonnegative().default(0),
  subleaseViolationCount: z.number().int().nonnegative().default(0),
  newestInvoiceAt: z.string().nullable().default(null),
  oldestInvoiceAt: z.string().nullable().default(null),
  asOf: z.string().default(() => new Date().toISOString()),
  weights: z
    .object({
      payment_history: z.number().nonnegative(),
      promise_keeping: z.number().nonnegative(),
      rent_to_income: z.number().nonnegative(),
      tenancy_length: z.number().nonnegative(),
      dispute_history: z.number().nonnegative(),
    })
    .optional(),
});

export type TenantCreditParams = z.infer<typeof TenantCreditParamsSchema>;

export interface CreditRatingCardBlock {
  readonly blockType: 'credit_rating_card';
  readonly score: number | null;
  readonly letterGrade: string | null;
  readonly band: string;
  readonly dimensionBars: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly value: number;
    readonly weight: number;
  }>;
  readonly strongestFactor: string | null;
  readonly weakestFactor: string | null;
  readonly recommendedAction: string;
  readonly insufficientDataReason: string | null;
  readonly dataFreshness: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  payment_history: 'Payment history',
  promise_keeping: 'Promise keeping',
  rent_to_income: 'Rent-to-income',
  tenancy_length: 'Tenancy length',
  dispute_history: 'Dispute record',
};

function toCreditCard(rating: CreditRating): CreditRatingCardBlock {
  const dims = rating.dimensions;
  const dimensionBars = [
    { key: 'payment_history', weight: dims.payment_history.weight, value: dims.payment_history.score },
    { key: 'promise_keeping', weight: dims.promise_keeping.weight, value: dims.promise_keeping.score },
    { key: 'rent_to_income', weight: dims.rent_to_income.weight, value: dims.rent_to_income.score },
    { key: 'tenancy_length', weight: dims.tenancy_length.weight, value: dims.tenancy_length.score },
    { key: 'dispute_history', weight: dims.dispute_history.weight, value: dims.dispute_history.score },
  ].map((d) => ({
    key: d.key,
    label: DIMENSION_LABELS[d.key] ?? d.key,
    value: d.value,
    weight: d.weight,
  }));

  const recommendedAction =
    rating.recommendations[0] ??
    (rating.band === 'insufficient_data'
      ? 'Wait for more invoice history — rating will activate automatically.'
      : 'Maintain current payment behavior.');

  return {
    blockType: 'credit_rating_card',
    score: rating.numericScore,
    letterGrade: rating.letterGrade,
    band: rating.band,
    dimensionBars,
    strongestFactor: rating.strongestFactor,
    weakestFactor: rating.weakestFactor,
    recommendedAction,
    insufficientDataReason: rating.insufficientDataReason,
    dataFreshness: rating.dataFreshness,
  };
}

function paramsToInputs(p: TenantCreditParams): CreditRatingInputs {
  return {
    tenantId: p.tenantId,
    customerId: p.customerId,
    totalInvoices: p.totalInvoices,
    paidOnTimeCount: p.paidOnTimeCount,
    paidLate30DaysCount: p.paidLate30DaysCount,
    paidLate60DaysCount: p.paidLate60DaysCount,
    paidLate90PlusCount: p.paidLate90PlusCount,
    defaultCount: p.defaultCount,
    extensionsGranted: p.extensionsGranted,
    extensionsHonored: p.extensionsHonored,
    installmentAgreementsOffered: p.installmentAgreementsOffered,
    installmentAgreementsHonored: p.installmentAgreementsHonored,
    rentToIncomeRatio: p.rentToIncomeRatio,
    avgTenancyMonths: p.avgTenancyMonths,
    activeTenancyCount: p.activeTenancyCount,
    disputeCount: p.disputeCount,
    damageDeductionCount: p.damageDeductionCount,
    subleaseViolationCount: p.subleaseViolationCount,
    newestInvoiceAt: p.newestInvoiceAt,
    oldestInvoiceAt: p.oldestInvoiceAt,
    asOf: p.asOf,
  };
}

export interface TenantCreditResult {
  readonly rating: CreditRating;
  readonly card: CreditRatingCardBlock;
}

function resolveWeights(
  raw: TenantCreditParams['weights'],
): GradingWeights {
  if (!raw) return DEFAULT_GRADING_WEIGHTS;
  return {
    payment_history: raw.payment_history ?? DEFAULT_GRADING_WEIGHTS.payment_history,
    promise_keeping: raw.promise_keeping ?? DEFAULT_GRADING_WEIGHTS.promise_keeping,
    rent_to_income: raw.rent_to_income ?? DEFAULT_GRADING_WEIGHTS.rent_to_income,
    tenancy_length: raw.tenancy_length ?? DEFAULT_GRADING_WEIGHTS.tenancy_length,
    dispute_history: raw.dispute_history ?? DEFAULT_GRADING_WEIGHTS.dispute_history,
  };
}

export function runTenantCredit(params: TenantCreditParams): TenantCreditResult {
  const parsed = TenantCreditParamsSchema.parse(params);
  const weights = resolveWeights(parsed.weights);
  const rating = scoreTenantCredit(paramsToInputs(parsed), weights);
  return { rating, card: toCreditCard(rating) };
}

export const tenantCreditTool: ToolHandler = {
  name: 'skill.estate.get_tenant_credit',
  description:
    'Compute a FICO-scale (300-850) tenant credit rating from live payment history. Returns numeric score, letter grade, 5-factor breakdown, and a credit_rating_card block for the blackboard.',
  parameters: {
    type: 'object',
    required: ['tenantId', 'customerId', 'totalInvoices', 'paidOnTimeCount'],
    properties: {
      tenantId: { type: 'string' },
      customerId: { type: 'string' },
      totalInvoices: { type: 'number' },
      paidOnTimeCount: { type: 'number' },
      paidLate30DaysCount: { type: 'number' },
      paidLate60DaysCount: { type: 'number' },
      paidLate90PlusCount: { type: 'number' },
      defaultCount: { type: 'number' },
      extensionsGranted: { type: 'number' },
      extensionsHonored: { type: 'number' },
      installmentAgreementsOffered: { type: 'number' },
      installmentAgreementsHonored: { type: 'number' },
      rentToIncomeRatio: { type: ['number', 'null'] },
      avgTenancyMonths: { type: 'number' },
      activeTenancyCount: { type: 'number' },
      disputeCount: { type: 'number' },
      damageDeductionCount: { type: 'number' },
      subleaseViolationCount: { type: 'number' },
      newestInvoiceAt: { type: ['string', 'null'] },
      oldestInvoiceAt: { type: ['string', 'null'] },
      asOf: { type: 'string' },
      weights: { type: 'object' },
    },
  },
  async execute(params) {
    const parsed = TenantCreditParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = runTenantCredit(parsed.data);
    const r = result.rating;
    const summary =
      r.band === 'insufficient_data'
        ? `Customer ${r.customerId}: insufficient data — ${r.insufficientDataReason}`
        : `Customer ${r.customerId}: ${r.numericScore}/${850} (${r.letterGrade}, ${r.band}); weakest=${r.weakestFactor}`;
    return {
      ok: true,
      data: result,
      evidenceSummary: summary,
    };
  },
};
