/**
 * Payment-term proposal.
 *
 * Selects a primary instrument + ranked alternatives based on buyer
 * risk band + trade value + currency mismatch. Builds an FX hedge
 * ladder when currency mismatch exists.
 *
 * Pure function. No I/O.
 */

import {
  paymentTermProposalInputSchema,
  type FxHedgeRung,
  type PaymentInstrument,
  type PaymentTermProposal,
  type PaymentTermProposalInput,
  type RiskBand,
} from './types.js';

interface InstrumentRule {
  readonly riskBand: RiskBand;
  readonly minValueUsd: number;
  readonly maxValueUsd: number;
  readonly primary: PaymentInstrument;
  readonly alternatives: ReadonlyArray<PaymentInstrument>;
  readonly depositPct: number;
}

const RULES: ReadonlyArray<InstrumentRule> = [
  // Low-risk buyers: open account or short Net term.
  {
    riskBand: 'low',
    minValueUsd: 0,
    maxValueUsd: 50_000,
    primary: 'open-account',
    alternatives: ['net-30', 'cash-against-documents'],
    depositPct: 0,
  },
  {
    riskBand: 'low',
    minValueUsd: 50_000,
    maxValueUsd: 500_000,
    primary: 'net-30',
    alternatives: ['net-60', 'cash-against-documents'],
    depositPct: 10,
  },
  {
    riskBand: 'low',
    minValueUsd: 500_000,
    maxValueUsd: Infinity,
    primary: 'net-60',
    alternatives: ['letter-of-credit'],
    depositPct: 20,
  },
  // Medium-risk buyers: cash-against-docs or LC + deposit.
  {
    riskBand: 'medium',
    minValueUsd: 0,
    maxValueUsd: 250_000,
    primary: 'cash-against-documents',
    alternatives: ['letter-of-credit', 'escrow'],
    depositPct: 25,
  },
  {
    riskBand: 'medium',
    minValueUsd: 250_000,
    maxValueUsd: Infinity,
    primary: 'letter-of-credit',
    alternatives: ['escrow', 'cash-against-documents'],
    depositPct: 30,
  },
  // High-risk buyers: escrow or LC mandatory; large deposit.
  {
    riskBand: 'high',
    minValueUsd: 0,
    maxValueUsd: Infinity,
    primary: 'escrow',
    alternatives: ['letter-of-credit'],
    depositPct: 50,
  },
];

export function proposeTerms(
  rawInput: PaymentTermProposalInput,
): PaymentTermProposal {
  const input = paymentTermProposalInputSchema.parse(rawInput);
  const rule = RULES.find(
    (r) =>
      r.riskBand === input.buyerRisk &&
      input.totalValueUsd >= r.minValueUsd &&
      input.totalValueUsd < r.maxValueUsd,
  );

  if (!rule) {
    // Defensive default — should not happen given the rule matrix.
    return {
      buyerId: input.buyerId,
      tenantId: input.tenantId,
      primary: 'escrow',
      alternatives: ['letter-of-credit'],
      depositPct: 50,
      fxHedgeLadder: [...buildHedgeLadder(input)],
      rationale:
        'No specific rule matched buyer profile; defaulted to escrow ' +
        'with 50% deposit.',
    };
  }

  return {
    buyerId: input.buyerId,
    tenantId: input.tenantId,
    primary: rule.primary,
    alternatives: [...rule.alternatives],
    depositPct: rule.depositPct,
    fxHedgeLadder: [...buildHedgeLadder(input)],
    rationale: buildRationale(input, rule),
  };
}

function buildRationale(
  input: PaymentTermProposalInput,
  rule: InstrumentRule,
): string {
  return (
    `Buyer is ${input.buyerRisk}-risk; trade value ` +
    `${input.totalValueUsd.toLocaleString('en-US')} USD. ` +
    `Primary instrument ${rule.primary} with ${rule.depositPct}% deposit. ` +
    `Alternatives: ${rule.alternatives.join(', ') || 'none'}.`
  );
}

// ─── FX hedge ladder ────────────────────────────────────────────────

/**
 * When buyer and seller hold different currencies, split the trade
 * value across a 3-rung ladder:
 *   - 30% spot (within 7 days)
 *   - 40% forward (~half the lead time)
 *   - 30% option (full lead time)
 *
 * Same-currency trades return an empty ladder.
 */
export function buildHedgeLadder(
  input: PaymentTermProposalInput,
): ReadonlyArray<FxHedgeRung> {
  if (input.buyerCurrency === input.sellerCurrency) return [];
  const half = Math.max(7, Math.floor(input.expectedLeadTimeDays / 2));
  return [
    {
      bucketDays: 7,
      notionalUsd: input.totalValueUsd * 0.3,
      instrument: 'spot',
    },
    {
      bucketDays: half,
      notionalUsd: input.totalValueUsd * 0.4,
      instrument: 'forward',
    },
    {
      bucketDays: input.expectedLeadTimeDays,
      notionalUsd: input.totalValueUsd * 0.3,
      instrument: 'option',
    },
  ];
}
