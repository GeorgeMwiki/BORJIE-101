/**
 * prepare-kra-filing — code skill. KE-jurisdiction only.
 *
 * Stages a Monthly Rental Income (MRI) filing draft from the rent-payment
 * ledger. NEVER submits — operator approval required downstream.
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export interface KraPayment {
  readonly property_id: string;
  readonly amount: number;
  /** Must equal "KES" — the skill enforces. */
  readonly currency: string;
  readonly payment_date: string;
}

export interface PrepareKraFilingInput {
  /** Inclusive yyyy-mm period, e.g. "2026-04". */
  readonly period_yyyy_mm: string;
  readonly payments: ReadonlyArray<KraPayment>;
  /**
   * Tax rate as a fraction (e.g. 0.075 for 7.5%). The skill reads this
   * from the entity-store in production; for tests we accept it on input
   * so the calculation is deterministic.
   */
  readonly mri_rate: number;
}

export interface PrepareKraFilingOutput {
  readonly period_yyyy_mm: string;
  readonly gross_rental_income: number;
  readonly tax_due: number;
  readonly currency: string;
  readonly draft_entity_id: string;
  readonly attribute_written: boolean;
  /**
   * Returned ONLY when the input contains non-KES payments — the operator
   * must reconcile before the filing is approved.
   */
  readonly currency_violations: ReadonlyArray<{
    readonly property_id: string;
    readonly currency: string;
    readonly amount: number;
  }>;
}

export class JurisdictionMismatchError extends Error {
  constructor(actual: string) {
    super(
      `[prepare-kra-filing] this skill is KE-only; tenant jurisdiction is "${actual}"`
    );
  }
}

const fn: SerializableFunction<PrepareKraFilingInput, PrepareKraFilingOutput> = {
  source: '// prepare-kra-filing — see SKILL.md',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  run: async (
    ctx: SkillExecutionContext,
    input: PrepareKraFilingInput
  ): Promise<PrepareKraFilingOutput> => {
    if (ctx.jurisdiction !== 'KE') {
      throw new JurisdictionMismatchError(ctx.jurisdiction);
    }
    if (!/^\d{4}-\d{2}$/.test(input.period_yyyy_mm)) {
      throw new Error(`period_yyyy_mm "${input.period_yyyy_mm}" must be yyyy-mm`);
    }
    let gross = 0;
    const violations: Array<{ property_id: string; currency: string; amount: number }> = [];
    for (const p of input.payments) {
      if (p.currency !== 'KES') {
        violations.push({
          property_id: p.property_id,
          currency: p.currency,
          amount: p.amount,
        });
        continue;
      }
      gross += p.amount;
    }
    const tax = gross * input.mri_rate;
    const draft_entity_id = `kra_filing::${ctx.tenant_id}::${input.period_yyyy_mm}`;
    const provenance_hash = `prepare-kra-filing::${draft_entity_id}::${ctx.now.slice(0, 10)}`;
    const write = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type: 'kra_filing_draft',
      entity_id: draft_entity_id,
      attributes: [
        {
          attribute_key: 'period_yyyy_mm',
          value: input.period_yyyy_mm,
          provenance: { source: 'prepare-kra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'gross_rental_income',
          value: gross,
          provenance: { source: 'prepare-kra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'tax_due',
          value: tax,
          provenance: { source: 'prepare-kra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'currency',
          value: 'KES',
          provenance: { source: 'prepare-kra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'mri_rate',
          value: input.mri_rate,
          provenance: { source: 'prepare-kra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'currency_violations_count',
          value: violations.length,
          provenance: { source: 'prepare-kra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });
    return {
      period_yyyy_mm: input.period_yyyy_mm,
      gross_rental_income: gross,
      tax_due: tax,
      currency: 'KES',
      draft_entity_id,
      attribute_written: write.attributes_written > 0,
      currency_violations: violations,
    };
  },
};

export const prepareKraFilingSkill: CodeSkill<PrepareKraFilingInput, PrepareKraFilingOutput> = {
  id: 'prepare-kra-filing',
  name: 'Prepare KRA Filing',
  description:
    'Stage a KE monthly rental-income filing draft from the rent-payment ledger; KE-only, operator-review-gated.',
  embedding: embed('kra kenya rental income mri filing tax draft monthly'),
  jurisdiction: 'KE',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
