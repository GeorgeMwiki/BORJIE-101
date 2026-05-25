/**
 * dispatch-maintenance — code skill.
 *
 * Picks the best-scoring vendor for a ticket and writes a dispatch entity.
 * Severity-driven SLA attachment. Currency-neutral, jurisdiction-neutral.
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export type Severity = 1 | 2 | 3 | 4;

export interface CandidateVendor {
  readonly vendor_id: string;
  readonly categories: ReadonlyArray<string>;
  readonly locality: string;
  /** 0–5 stars. */
  readonly rating: number;
  /** Open tickets currently assigned. */
  readonly open_tickets: number;
}

export interface DispatchMaintenanceInput {
  readonly ticket_id: string;
  readonly category: string;
  readonly locality: string;
  readonly severity: Severity;
  readonly description: string;
  readonly candidates: ReadonlyArray<CandidateVendor>;
}

export interface DispatchMaintenanceOutput {
  readonly ticket_id: string;
  readonly assigned_vendor_id: string;
  readonly score: number;
  readonly sla_respond_hours: number;
  readonly sla_resolve_hours: number;
  readonly attribute_written: boolean;
  readonly reason: string;
}

export interface VendorScore {
  readonly vendor_id: string;
  readonly score: number;
}

export function scoreVendor(
  v: CandidateVendor,
  category: string,
  locality: string
): number {
  const locality_match = v.locality === locality ? 1 : 0;
  const category_match = v.categories.includes(category) ? 1 : 0;
  const rating_norm = Math.max(0, Math.min(1, v.rating / 5));
  const load = 1 / (1 + v.open_tickets);
  return 0.4 * locality_match + 0.3 * category_match + 0.2 * rating_norm + 0.1 * load;
}

export function rankVendorCandidates(
  candidates: ReadonlyArray<CandidateVendor>,
  category: string,
  locality: string
): ReadonlyArray<VendorScore> {
  return candidates
    .map((v) => ({ vendor_id: v.vendor_id, score: scoreVendor(v, category, locality) }))
    .sort((a, b) => b.score - a.score);
}

export function slaForSeverity(severity: Severity): {
  readonly respond_hours: number;
  readonly resolve_hours: number;
} {
  switch (severity) {
    case 1:
      return { respond_hours: 1, resolve_hours: 4 };
    case 2:
      return { respond_hours: 4, resolve_hours: 24 };
    case 3:
      return { respond_hours: 24, resolve_hours: 72 };
    case 4:
      return { respond_hours: 72, resolve_hours: 14 * 24 };
  }
}

const fn: SerializableFunction<DispatchMaintenanceInput, DispatchMaintenanceOutput> = {
  source: '// dispatch-maintenance — see SKILL.md',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  run: async (
    ctx: SkillExecutionContext,
    input: DispatchMaintenanceInput
  ): Promise<DispatchMaintenanceOutput> => {
    if (input.candidates.length === 0) {
      throw new Error(`No candidate vendors for ticket ${input.ticket_id}`);
    }
    const ranked = rankVendorCandidates(input.candidates, input.category, input.locality);
    const top = ranked[0];
    if (!top) {
      throw new Error('rankCandidates returned empty list despite non-empty input');
    }
    const sla = slaForSeverity(input.severity);
    const provenance_hash = `dispatch-maintenance::${input.ticket_id}::${top.vendor_id}`;
    const write = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type: 'maintenance_dispatch',
      entity_id: `${input.ticket_id}::${top.vendor_id}`,
      attributes: [
        {
          attribute_key: 'ticket_id',
          value: input.ticket_id,
          provenance: { source: 'dispatch-maintenance.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'vendor_id',
          value: top.vendor_id,
          provenance: { source: 'dispatch-maintenance.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'severity',
          value: input.severity,
          provenance: { source: 'dispatch-maintenance.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'sla_respond_hours',
          value: sla.respond_hours,
          provenance: { source: 'dispatch-maintenance.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'sla_resolve_hours',
          value: sla.resolve_hours,
          provenance: { source: 'dispatch-maintenance.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'score',
          value: top.score,
          provenance: { source: 'dispatch-maintenance.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });
    return {
      ticket_id: input.ticket_id,
      assigned_vendor_id: top.vendor_id,
      score: top.score,
      sla_respond_hours: sla.respond_hours,
      sla_resolve_hours: sla.resolve_hours,
      attribute_written: write.attributes_written > 0,
      reason: `Selected ${top.vendor_id} with score ${top.score.toFixed(3)} for ${input.category} in ${input.locality} at severity ${input.severity}.`,
    };
  },
};

export const dispatchMaintenanceSkill: CodeSkill<
  DispatchMaintenanceInput,
  DispatchMaintenanceOutput
> = {
  id: 'dispatch-maintenance',
  name: 'Dispatch Maintenance',
  description:
    'Score vendors by locality/category/rating/load, attach severity SLA, write dispatch entity.',
  embedding: embed('maintenance ticket vendor dispatch severity sla assignment'),
  jurisdiction: 'platform',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
