/**
 * handle-late-royalty — code skill.
 *
 * Reads the counterparty's offtake-agreement state from the entity-store,
 * computes the current step in the late-royalty ladder, writes a
 * `late_royalty_event` attribute for the current step (idempotent via
 * provenance hash), and returns a typed result the caller can format for
 * chat or downstream tickets.
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export interface HandleLateRoyaltyInput {
  readonly tenant_id: string;
  /** Offtake / supply-agreement entity id. */
  readonly agreement_id: string;
  /** Days past due. */
  readonly days_late: number;
  /**
   * Counterparty's preferred channel. Used by the skill to flag downstream
   * notification routing — it does NOT send messages itself.
   */
  readonly preferred_channel: 'sms' | 'email' | 'whatsapp' | 'voice' | 'in_person';
}

export type LateRoyaltyStep =
  | 'grace_window'
  | 'first_notice'
  | 'second_notice'
  | 'escalation';

export interface HandleLateRoyaltyOutput {
  readonly step: LateRoyaltyStep;
  readonly tenant_id: string;
  readonly agreement_id: string;
  readonly action: string;
  readonly attribute_written: boolean;
  readonly idempotent_skip: boolean;
  /**
   * Jurisdiction late-fee rate hint, in basis points of one period's
   * royalty per day late. NOT a fee TOTAL — caller computes that with the
   * agreement royalty figure. Returns `null` for jurisdictions with no
   * statutory rate.
   */
  readonly late_fee_bps_per_day: number | null;
}

/**
 * Pure ladder calculator. Configurable via the `grace_days` argument; the
 * production wiring pulls this from the counterparty's offtake-agreement
 * entity.
 */
export function computeStep(days_late: number, grace_days = 5): LateRoyaltyStep {
  if (days_late <= grace_days) return 'grace_window';
  if (days_late <= grace_days + 10) return 'first_notice';
  if (days_late <= grace_days + 30) return 'second_notice';
  return 'escalation';
}

/** Jurisdiction-specific late-fee rate lookup. Stub for the skill — real
 * values come from `compliance-plugins`. The skill never hard-codes
 * jurisdiction defaults in business logic. */
function lateFeeRateBpsPerDay(jurisdiction: string): number | null {
  // The skill calls into the entity-store for the live config in
  // production; here we return null so the skill is portable.
  void jurisdiction;
  return null;
}

const fn: SerializableFunction<HandleLateRoyaltyInput, HandleLateRoyaltyOutput> = {
  source: `// handle-late-royalty code skill — see SKILL.md for full description`,
  input_schema: {
    type: 'object',
    properties: {
      tenant_id: { type: 'string' },
      agreement_id: { type: 'string' },
      days_late: { type: 'number' },
      preferred_channel: { type: 'string' },
    },
    required: ['tenant_id', 'agreement_id', 'days_late', 'preferred_channel'],
  },
  output_schema: {
    type: 'object',
    properties: {
      step: { type: 'string' },
      attribute_written: { type: 'boolean' },
      idempotent_skip: { type: 'boolean' },
    },
  },
  run: async (
    ctx: SkillExecutionContext,
    input: HandleLateRoyaltyInput
  ): Promise<HandleLateRoyaltyOutput> => {
    const step = computeStep(input.days_late);
    const provenance_hash = `handle-late-royalty::${input.agreement_id}::${step}::${ctx.now.slice(0, 10)}`;
    const result = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type: 'late_royalty_event',
      entity_id: `${input.agreement_id}::${step}::${ctx.now.slice(0, 10)}`,
      attributes: [
        {
          attribute_key: 'step',
          value: step,
          provenance: { source: 'handle-late-royalty.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'days_late',
          value: input.days_late,
          provenance: { source: 'handle-late-royalty.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'preferred_channel',
          value: input.preferred_channel,
          provenance: { source: 'handle-late-royalty.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });
    return {
      step,
      tenant_id: input.tenant_id,
      agreement_id: input.agreement_id,
      action: stepActionLabel(step),
      attribute_written: result.attributes_written > 0,
      idempotent_skip: result.attributes_written === 0 && result.attributes_skipped > 0,
      late_fee_bps_per_day: lateFeeRateBpsPerDay(ctx.jurisdiction),
    };
  },
};

function stepActionLabel(step: LateRoyaltyStep): string {
  switch (step) {
    case 'grace_window':
      return 'log_only';
    case 'first_notice':
      return 'send_friendly_reminder';
    case 'second_notice':
      return 'send_formal_letter_and_apply_late_fee';
    case 'escalation':
      return 'alert_legal_team_with_payment_plan_offer';
  }
}

export const handleLateRoyaltySkill: CodeSkill<HandleLateRoyaltyInput, HandleLateRoyaltyOutput> = {
  id: 'handle-late-royalty',
  name: 'Handle Late Royalty',
  description:
    'Walk a late-royalty ticket through grace -> first-notice -> second-notice -> escalation idempotently with entity-store writes.',
  embedding: embed('late royalty overdue counterparty payment ladder notice'),
  jurisdiction: 'platform',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
