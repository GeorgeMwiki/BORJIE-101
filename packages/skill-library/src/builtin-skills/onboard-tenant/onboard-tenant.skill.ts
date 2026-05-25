/**
 * onboard-tenant — code skill.
 *
 * Walks a new tenant through KYC -> lease -> deposit -> allocation ->
 * welcome. Idempotent per step (provenance-hash dedup).
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export type OnboardStep =
  | 'kyc_started'
  | 'lease_drafted'
  | 'deposit_recorded'
  | 'unit_allocated'
  | 'welcome_pack_sent';

export interface OnboardTenantInput {
  readonly tenant_id: string;
  readonly step: OnboardStep;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface OnboardTenantOutput {
  readonly tenant_id: string;
  readonly step: OnboardStep;
  readonly entity_id: string;
  readonly attribute_written: boolean;
  readonly idempotent_skip: boolean;
  readonly next_step: OnboardStep | null;
}

const STEP_ORDER: ReadonlyArray<OnboardStep> = [
  'kyc_started',
  'lease_drafted',
  'deposit_recorded',
  'unit_allocated',
  'welcome_pack_sent',
];

export function nextStep(step: OnboardStep): OnboardStep | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1) return null;
  if (idx === STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1] ?? null;
}

const fn: SerializableFunction<OnboardTenantInput, OnboardTenantOutput> = {
  source: '// onboard-tenant — see SKILL.md',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  run: async (
    ctx: SkillExecutionContext,
    input: OnboardTenantInput
  ): Promise<OnboardTenantOutput> => {
    const entity_type = `tenant_onboarding_${input.step}`;
    const entity_id = `${input.tenant_id}::${input.step}`;
    const provenance_hash = `onboard-tenant::${input.tenant_id}::${input.step}`;
    const result = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type,
      entity_id,
      attributes: [
        {
          attribute_key: 'tenant_id',
          value: input.tenant_id,
          provenance: { source: 'onboard-tenant.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'step',
          value: input.step,
          provenance: { source: 'onboard-tenant.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'payload',
          value: input.payload,
          provenance: { source: 'onboard-tenant.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'jurisdiction',
          value: ctx.jurisdiction,
          provenance: { source: 'onboard-tenant.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });
    return {
      tenant_id: input.tenant_id,
      step: input.step,
      entity_id,
      attribute_written: result.attributes_written > 0,
      idempotent_skip: result.attributes_written === 0 && result.attributes_skipped > 0,
      next_step: nextStep(input.step),
    };
  },
};

export const onboardTenantSkill: CodeSkill<OnboardTenantInput, OnboardTenantOutput> = {
  id: 'onboard-tenant',
  name: 'Onboard Tenant',
  description:
    'Walk a new tenant through KYC, lease, deposit, allocation, welcome — one step at a time, idempotent.',
  embedding: embed('tenant onboarding kyc lease deposit allocation welcome pack'),
  jurisdiction: 'platform',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
