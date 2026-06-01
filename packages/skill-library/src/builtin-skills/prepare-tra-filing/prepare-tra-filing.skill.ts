/**
 * prepare-tra-filing — code skill. TZ-jurisdiction only.
 *
 * Stages a mineral royalty return draft from the royalty-payment ledger.
 * NEVER submits — operator approval required downstream.
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export interface TraPayment {
  readonly site_id: string;
  readonly amount: number;
  /** Must equal "TZS" — the skill enforces. */
  readonly currency: string;
  readonly payment_date: string;
}

export interface PrepareTraFilingInput {
  /** Inclusive yyyy-mm period, e.g. "2026-04". */
  readonly period_yyyy_mm: string;
  readonly payments: ReadonlyArray<TraPayment>;
  /**
   * Royalty rate as a fraction (e.g. 0.06 for the 6% mineral royalty). The
   * skill reads this from the entity-store in production; for tests we
   * accept it on input so the calculation is deterministic.
   */
  readonly royalty_rate: number;
}

export interface PrepareTraFilingOutput {
  readonly period_yyyy_mm: string;
  readonly gross_mineral_value: number;
  readonly royalty_due: number;
  readonly currency: string;
  readonly draft_entity_id: string;
  readonly attribute_written: boolean;
  /**
   * Returned ONLY when the input contains non-TZS payments — the operator
   * must reconcile before the filing is approved.
   */
  readonly currency_violations: ReadonlyArray<{
    readonly site_id: string;
    readonly currency: string;
    readonly amount: number;
  }>;
}

export class JurisdictionMismatchError extends Error {
  constructor(actual: string) {
    super(
      `[prepare-tra-filing] this skill is TZ-only; tenant jurisdiction is "${actual}"`
    );
  }
}

const fn: SerializableFunction<PrepareTraFilingInput, PrepareTraFilingOutput> = {
  source: '// prepare-tra-filing — see SKILL.md',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  run: async (
    ctx: SkillExecutionContext,
    input: PrepareTraFilingInput
  ): Promise<PrepareTraFilingOutput> => {
    if (ctx.jurisdiction !== 'TZ') {
      throw new JurisdictionMismatchError(ctx.jurisdiction);
    }
    if (!/^\d{4}-\d{2}$/.test(input.period_yyyy_mm)) {
      throw new Error(`period_yyyy_mm "${input.period_yyyy_mm}" must be yyyy-mm`);
    }
    let gross = 0;
    const violations: Array<{ site_id: string; currency: string; amount: number }> = [];
    for (const p of input.payments) {
      if (p.currency !== 'TZS') {
        violations.push({
          site_id: p.site_id,
          currency: p.currency,
          amount: p.amount,
        });
        continue;
      }
      gross += p.amount;
    }
    const royalty = gross * input.royalty_rate;
    const draft_entity_id = `tra_filing::${ctx.tenant_id}::${input.period_yyyy_mm}`;
    const provenance_hash = `prepare-tra-filing::${draft_entity_id}::${ctx.now.slice(0, 10)}`;
    const write = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type: 'tra_filing_draft',
      entity_id: draft_entity_id,
      attributes: [
        {
          attribute_key: 'period_yyyy_mm',
          value: input.period_yyyy_mm,
          provenance: { source: 'prepare-tra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'gross_mineral_value',
          value: gross,
          provenance: { source: 'prepare-tra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'royalty_due',
          value: royalty,
          provenance: { source: 'prepare-tra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'currency',
          value: 'TZS',
          provenance: { source: 'prepare-tra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'royalty_rate',
          value: input.royalty_rate,
          provenance: { source: 'prepare-tra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'currency_violations_count',
          value: violations.length,
          provenance: { source: 'prepare-tra-filing.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });
    return {
      period_yyyy_mm: input.period_yyyy_mm,
      gross_mineral_value: gross,
      royalty_due: royalty,
      currency: 'TZS',
      draft_entity_id,
      attribute_written: write.attributes_written > 0,
      currency_violations: violations,
    };
  },
};

export const prepareTraFilingSkill: CodeSkill<PrepareTraFilingInput, PrepareTraFilingOutput> = {
  id: 'prepare-tra-filing',
  name: 'Prepare TRA Filing',
  description:
    'Stage a TZ mineral royalty return draft from the royalty-payment ledger; TZ-only, operator-review-gated.',
  embedding: embed('tra tanzania mineral royalty return filing tax draft monthly'),
  jurisdiction: 'TZ',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
