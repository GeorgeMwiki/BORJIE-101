/**
 * handle-late-rent — code skill.
 *
 * Reads the tenant's lease state from the entity-store, computes the
 * current step in the late-rent ladder, writes a `late_rent_event`
 * attribute for the current step (idempotent via provenance hash), and
 * returns a typed result the caller can format for chat or downstream
 * tickets.
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export interface HandleLateRentInput {
  readonly tenant_id: string;
  /** Lease entity id. */
  readonly lease_id: string;
  /** Days past due. */
  readonly days_late: number;
  /**
   * Tenant's preferred channel. Used by the skill to flag downstream
   * notification routing — it does NOT send messages itself.
   */
  readonly preferred_channel: 'sms' | 'email' | 'whatsapp' | 'voice' | 'in_person';
}

export type LateRentStep =
  | 'grace_window'
  | 'first_notice'
  | 'second_notice'
  | 'escalation';

export interface HandleLateRentOutput {
  readonly step: LateRentStep;
  readonly tenant_id: string;
  readonly lease_id: string;
  readonly action: string;
  readonly attribute_written: boolean;
  readonly idempotent_skip: boolean;
  /**
   * Jurisdiction late-fee rate hint, in basis points of one month's rent
   * per day late. NOT a fee TOTAL — caller computes that with the lease
   * rent figure. Returns `null` for jurisdictions with no statutory rate.
   */
  readonly late_fee_bps_per_day: number | null;
}

/**
 * Pure ladder calculator. Configurable via the `grace_days` argument; the
 * production wiring pulls this from the tenant's lease entity.
 */
export function computeStep(days_late: number, grace_days = 5): LateRentStep {
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

const fn: SerializableFunction<HandleLateRentInput, HandleLateRentOutput> = {
  source: `// handle-late-rent code skill — see SKILL.md for full description`,
  input_schema: {
    type: 'object',
    properties: {
      tenant_id: { type: 'string' },
      lease_id: { type: 'string' },
      days_late: { type: 'number' },
      preferred_channel: { type: 'string' },
    },
    required: ['tenant_id', 'lease_id', 'days_late', 'preferred_channel'],
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
    input: HandleLateRentInput
  ): Promise<HandleLateRentOutput> => {
    const step = computeStep(input.days_late);
    const provenance_hash = `handle-late-rent::${input.lease_id}::${step}::${ctx.now.slice(0, 10)}`;
    const result = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type: 'late_rent_event',
      entity_id: `${input.lease_id}::${step}::${ctx.now.slice(0, 10)}`,
      attributes: [
        {
          attribute_key: 'step',
          value: step,
          provenance: { source: 'handle-late-rent.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'days_late',
          value: input.days_late,
          provenance: { source: 'handle-late-rent.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'preferred_channel',
          value: input.preferred_channel,
          provenance: { source: 'handle-late-rent.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });
    return {
      step,
      tenant_id: input.tenant_id,
      lease_id: input.lease_id,
      action: stepActionLabel(step),
      attribute_written: result.attributes_written > 0,
      idempotent_skip: result.attributes_written === 0 && result.attributes_skipped > 0,
      late_fee_bps_per_day: lateFeeRateBpsPerDay(ctx.jurisdiction),
    };
  },
};

function stepActionLabel(step: LateRentStep): string {
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

export const handleLateRentSkill: CodeSkill<HandleLateRentInput, HandleLateRentOutput> = {
  id: 'handle-late-rent',
  name: 'Handle Late Rent',
  description:
    'Walk a late-rent ticket through grace -> first-notice -> second-notice -> escalation idempotently with entity-store writes.',
  embedding: embed('late rent overdue tenant payment ladder notice'),
  jurisdiction: 'platform',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
