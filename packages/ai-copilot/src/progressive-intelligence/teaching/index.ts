/**
 * Teaching Hints — link accumulator state to Professor sub-persona prompts.
 *
 * When certain thresholds are crossed (rent-to-income ratio, arrears
 * pattern, maintenance cost load), inject a teaching hint into the
 * Professor's system prompt so explanations ride on real data.
 *
 * Hints are rendered as markdown snippets; callers concatenate them into
 * the persona prompt before LLM invocation.
 *
 * @module progressive-intelligence/teaching
 */

import type { AccumulatedEstateContext } from '../types.js';

export type TeachingHintId =
  | 'rent_affordability_high'
  | 'deposit_below_standard'
  | 'short_tenure_risk'
  | 'renewal_increment_aggressive'
  | 'maintenance_category_high_cost'
  | 'compliance_notice_legal_weight';

export interface TeachingHint {
  readonly id: TeachingHintId;
  readonly title: string;
  readonly explanation: string;
  readonly dataSnapshot: Record<string, unknown>;
}

export interface TeachingEvaluator {
  (ctx: AccumulatedEstateContext): TeachingHint | null;
}

const rentAffordability: TeachingEvaluator = (ctx) => {
  const income = ctx.tenantProfile.monthlyIncomeCents;
  const rent = ctx.leaseTerms.monthlyRentCents;
  if (!income || !rent || income === 0) return null;
  const ratio = rent / income;
  if (ratio <= 0.33) return null;
  return {
    id: 'rent_affordability_high',
    title: 'Rent-to-income ratio above 33%',
    explanation:
      `Rent is ${(ratio * 100).toFixed(0)}% of declared income. Above 33% is a ` +
      `classic affordability warning: arrears likelihood rises sharply, especially ` +
      `during school-fees quarters. Consider a smaller unit, a guarantor, or a shorter probation term.`,
    dataSnapshot: { rent, income, ratio },
  };
};

const depositBelowStandard: TeachingEvaluator = (ctx) => {
  const rent = ctx.leaseTerms.monthlyRentCents;
  const deposit = ctx.leaseTerms.depositCents;
  if (!rent || deposit === undefined) return null;
  const months = deposit / rent;
  if (months >= 2) return null;
  return {
    id: 'deposit_below_standard',
    title: 'Deposit below 2 months of rent',
    explanation:
      `Deposit covers ${months.toFixed(1)} month(s) of rent. Standard in Tanzania/Kenya is ` +
      `2–3 months. Under-collateralised deposits complicate end-of-lease dispute resolution.`,
    dataSnapshot: { rent, deposit, months },
  };
};

const shortTenure: TeachingEvaluator = (ctx) => {
  const tenure = ctx.leaseTerms.tenureMonths;
  if (!tenure || tenure >= 6) return null;
  return {
    id: 'short_tenure_risk',
    title: 'Tenure shorter than 6 months',
    explanation:
      `Short tenure increases turnover cost and vacancy risk. Consider whether this is a ` +
      `furnished-short-stay unit or if a longer commitment is appropriate.`,
    dataSnapshot: { tenureMonths: tenure },
  };
};

const renewalIncrement: TeachingEvaluator = (ctx) => {
  const existing = ctx.renewalProposal.existingRentCents;
  const proposed = ctx.renewalProposal.proposedRentCents;
  if (!existing || !proposed) return null;
  const incrementPct = ((proposed - existing) / existing) * 100;
  if (incrementPct <= 15) return null;
  return {
    id: 'renewal_increment_aggressive',
    title: `Renewal increment ${incrementPct.toFixed(0)}% above prior rent`,
    explanation:
      `Aggressive increments drive churn, especially in tenant-rich markets. Market comps ` +
      `typically support 5–10% annual increments. Document the justification or accept churn risk.`,
    dataSnapshot: { existing, proposed, incrementPct },
  };
};

const maintenanceCategoryCost: TeachingEvaluator = (ctx) => {
  const cat = ctx.maintenanceCase.category;
  if (cat !== 'electrical' && cat !== 'structural' && cat !== 'hvac') return null;
  return {
    id: 'maintenance_category_high_cost',
    title: `High-cost maintenance category: ${cat}`,
    explanation:
      `Electrical, structural, and HVAC cases are the most expensive to repair. Budget for ` +
      `vendor dispatch + assessment before authorising the fix. Consider a second quote for large jobs.`,
    dataSnapshot: { category: cat },
  };
};

const complianceLegalWeight: TeachingEvaluator = (ctx) => {
  const kind = ctx.complianceNotice.noticeType;
  if (kind !== 'termination' && kind !== 'default') return null;
  return {
    id: 'compliance_notice_legal_weight',
    title: `${kind} notice has legal weight`,
    explanation:
      `Termination and default notices carry legal consequences. Wording, delivery method ` +
      `(certified, bailiff), and jurisdiction-specific grace periods matter. Have legal review ` +
      `before dispatch.`,
    dataSnapshot: { kind },
  };
};

const EVALUATORS: readonly TeachingEvaluator[] = [
  rentAffordability,
  depositBelowStandard,
  shortTenure,
  renewalIncrement,
  maintenanceCategoryCost,
  complianceLegalWeight,
];

export function evaluateTeachingHints(
  ctx: AccumulatedEstateContext,
): readonly TeachingHint[] {
  return EVALUATORS.map((fn) => fn(ctx)).filter(
    (h): h is TeachingHint => h !== null,
  );
}

export function renderTeachingHintsAsPromptSegment(
  hints: readonly TeachingHint[],
): string {
  if (hints.length === 0) return '';
  const lines = [
    '# Teaching Hints (professor-mode)',
    'Use these as evidence-anchored explanations when the user asks *why* or *explain*.',
    '',
    ...hints.map(
      (h) =>
        `- **${h.title}** — ${h.explanation}`,
    ),
  ];
  return lines.join('\n');
}
