/**
 * onboard-counterparty — code skill.
 *
 * Walks a new counterparty through KYC -> supply-agreement -> prepayment
 * -> allocation -> welcome. Idempotent per step (provenance-hash dedup).
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export type OnboardStep =
  | 'kyc_started'
  | 'agreement_drafted'
  | 'prepayment_recorded'
  | 'allocation_confirmed'
  | 'welcome_pack_sent';

export interface OnboardCounterpartyInput {
  readonly counterparty_id: string;
  readonly step: OnboardStep;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OnboardCounterpartyOutput {
  readonly counterparty_id: string;
  readonly step: OnboardStep;
  readonly entity_id: string;
  readonly attribute_written: boolean;
  readonly idempotent_skip: boolean;
  readonly next_step: OnboardStep | null;
}

const STEP_ORDER: ReadonlyArray<OnboardStep> = [
  'kyc_started',
  'agreement_drafted',
  'prepayment_recorded',
  'allocation_confirmed',
  'welcome_pack_sent',
];

export function nextStep(step: OnboardStep): OnboardStep | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1) return null;
  if (idx === STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1] ?? null;
}

const fn: SerializableFunction<OnboardCounterpartyInput, OnboardCounterpartyOutput> = {
  source: '// onboard-counterparty — see SKILL.md',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  run: async (
    ctx: SkillExecutionContext,
    input: OnboardCounterpartyInput
  ): Promise<OnboardCounterpartyOutput> => {
    const entity_type = `counterparty_onboarding_${input.step}`;
    const entity_id = `${input.counterparty_id}::${input.step}`;
    const provenance_hash = `onboard-counterparty::${input.counterparty_id}::${input.step}`;
    const result = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type,
      entity_id,
      attributes: [
        {
          attribute_key: 'counterparty_id',
          value: input.counterparty_id,
          provenance: { source: 'onboard-counterparty.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'step',
          value: input.step,
          provenance: { source: 'onboard-counterparty.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'payload',
          value: input.payload,
          provenance: { source: 'onboard-counterparty.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'jurisdiction',
          value: ctx.jurisdiction,
          provenance: { source: 'onboard-counterparty.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });
    return {
      counterparty_id: input.counterparty_id,
      step: input.step,
      entity_id,
      attribute_written: result.attributes_written > 0,
      idempotent_skip: result.attributes_written === 0 && result.attributes_skipped > 0,
      next_step: nextStep(input.step),
    };
  },
};

export const onboardCounterpartySkill: CodeSkill<OnboardCounterpartyInput, OnboardCounterpartyOutput> = {
  id: 'onboard-counterparty',
  name: 'Onboard Counterparty',
  description:
    'Walk a new counterparty through KYC, supply-agreement, prepayment, allocation, welcome — one step at a time, idempotent.',
  embedding: embed('counterparty onboarding kyc supply agreement prepayment allocation welcome pack'),
  jurisdiction: 'platform',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
