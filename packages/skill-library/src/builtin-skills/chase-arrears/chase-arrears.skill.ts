/**
 * chase-arrears — code skill.
 *
 * Decision-table driven. Batch input, one action per tenant. Pure
 * read-derive-write — no side effects beyond `arrears_action` writes.
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export type ArrearsAction =
  | 'reminder_only'
  | 'payment_plan_offer'
  | 'escalate_to_operator'
  | 'legal_review_requested';

export interface ArrearsRow {
  readonly tenant_id: string;
  readonly amount: number;
  readonly currency: string;
  readonly days_late: number;
  /** Historical on-time ratio in [0, 1]. */
  readonly on_time_ratio: number;
}

export interface ChaseArrearsInput {
  readonly rows: ReadonlyArray<ArrearsRow>;
}

export interface ChaseArrearsOutput {
  readonly actions: ReadonlyArray<{
    readonly tenant_id: string;
    readonly action: ArrearsAction;
    readonly amount: number;
    readonly currency: string;
    readonly days_late: number;
    readonly attribute_written: boolean;
  }>;
  readonly action_counts: Readonly<Record<ArrearsAction, number>>;
}

export function chooseAction(row: ArrearsRow): ArrearsAction {
  if (row.days_late > 90) return 'legal_review_requested';
  if (row.days_late > 60) return 'escalate_to_operator';
  if (row.days_late > 30) return 'payment_plan_offer';
  // 1-30
  if (row.on_time_ratio >= 0.9) return 'reminder_only';
  if (row.on_time_ratio >= 0.5) return 'payment_plan_offer';
  return 'escalate_to_operator';
}

const fn: SerializableFunction<ChaseArrearsInput, ChaseArrearsOutput> = {
  source: '// chase-arrears — see SKILL.md',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  run: async (
    ctx: SkillExecutionContext,
    input: ChaseArrearsInput
  ): Promise<ChaseArrearsOutput> => {
    const action_counts: Record<ArrearsAction, number> = {
      reminder_only: 0,
      payment_plan_offer: 0,
      escalate_to_operator: 0,
      legal_review_requested: 0,
    };
    const actions: Array<{
      tenant_id: string;
      action: ArrearsAction;
      amount: number;
      currency: string;
      days_late: number;
      attribute_written: boolean;
    }> = [];
    for (const row of input.rows) {
      const action = chooseAction(row);
      action_counts[action]++;
      const provenance_hash = `chase-arrears::${row.tenant_id}::${ctx.now.slice(0, 10)}`;
      const write = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
        entity_type: 'arrears_action',
        entity_id: `${row.tenant_id}::${ctx.now.slice(0, 10)}`,
        attributes: [
          {
            attribute_key: 'action',
            value: action,
            provenance: { source: 'chase-arrears.skill', hash: provenance_hash, captured_at: ctx.now },
          },
          {
            attribute_key: 'amount',
            value: row.amount,
            provenance: { source: 'chase-arrears.skill', hash: provenance_hash, captured_at: ctx.now },
          },
          {
            attribute_key: 'currency',
            value: row.currency,
            provenance: { source: 'chase-arrears.skill', hash: provenance_hash, captured_at: ctx.now },
          },
          {
            attribute_key: 'days_late',
            value: row.days_late,
            provenance: { source: 'chase-arrears.skill', hash: provenance_hash, captured_at: ctx.now },
          },
        ],
      });
      actions.push({
        tenant_id: row.tenant_id,
        action,
        amount: row.amount,
        currency: row.currency,
        days_late: row.days_late,
        attribute_written: write.attributes_written > 0,
      });
    }
    return { actions, action_counts };
  },
};

export const chaseArrearsSkill: CodeSkill<ChaseArrearsInput, ChaseArrearsOutput> = {
  id: 'chase-arrears',
  name: 'Chase Arrears',
  description:
    'Aged-debt review with decision-table chase actions per tenant — reminder, plan offer, escalation, or legal review.',
  embedding: embed('arrears outstanding debt chase reminder plan escalation legal'),
  jurisdiction: 'platform',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
