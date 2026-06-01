/**
 * compile-weekly-report — code skill.
 *
 * Aggregates royalty/production/maintenance/outstanding-royalties for a
 * 7-day window from the entity-store. Read-derive-write only — no side
 * effects beyond the single `weekly_report` entity write.
 */

import type {
  CodeSkill,
  SerializableFunction,
  SkillExecutionContext,
} from '../../voyager-library/index.js';
import { embed } from '../embed.js';

export interface CompileWeeklyReportInput {
  /** ISO-8601 start of the 7-day window (inclusive). */
  readonly window_start: string;
  /** ISO-8601 end of the 7-day window (exclusive). */
  readonly window_end: string;
  /** Portfolio scope — list of site entity ids to roll up. */
  readonly site_ids: ReadonlyArray<string>;
  /**
   * Pre-aggregated raw signals supplied by the caller. The skill itself
   * does not query the entity-store for entire portfolio data — that's
   * the orchestrator's job (efficient batched fetch). The skill TRANSFORMS
   * + WRITES the report entity.
   */
  readonly signals: WeeklyReportSignals;
}

export interface WeeklyReportSignals {
  readonly royalty_payments: ReadonlyArray<{
    readonly amount: number;
    readonly currency: string;
    readonly site_id: string;
    readonly payment_date: string;
  }>;
  readonly asset_snapshot: ReadonlyArray<{
    readonly asset_id: string;
    readonly site_id: string;
    readonly status: 'producing' | 'idle' | 'maintenance' | 'unavailable';
  }>;
  readonly maintenance_closures: ReadonlyArray<{
    readonly ticket_id: string;
    readonly closed_at: string;
    readonly site_id: string;
  }>;
  readonly outstanding_royalties: ReadonlyArray<{
    readonly counterparty_id: string;
    readonly days_late: number;
    readonly amount: number;
    readonly currency: string;
  }>;
}

export interface CompileWeeklyReportOutput {
  readonly report_id: string;
  readonly royalty_collected_by_currency: Readonly<Record<string, number>>;
  readonly production_utilisation_ratio: number;
  readonly maintenance_closed_count: number;
  readonly outstanding_royalties_by_bucket: Readonly<{
    readonly d_0_30: { readonly count: number; readonly total_by_currency: Readonly<Record<string, number>> };
    readonly d_31_60: { readonly count: number; readonly total_by_currency: Readonly<Record<string, number>> };
    readonly d_61_90: { readonly count: number; readonly total_by_currency: Readonly<Record<string, number>> };
    readonly d_90p: { readonly count: number; readonly total_by_currency: Readonly<Record<string, number>> };
  }>;
  readonly attribute_written: boolean;
}

const fn: SerializableFunction<CompileWeeklyReportInput, CompileWeeklyReportOutput> = {
  source: '// compile-weekly-report — see SKILL.md',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
  run: async (
    ctx: SkillExecutionContext,
    input: CompileWeeklyReportInput
  ): Promise<CompileWeeklyReportOutput> => {
    const report_id = `weekly::${input.window_start.slice(0, 10)}::${ctx.tenant_id}`;

    const royalty_collected_by_currency: Record<string, number> = {};
    for (const p of input.signals.royalty_payments) {
      royalty_collected_by_currency[p.currency] = (royalty_collected_by_currency[p.currency] ?? 0) + p.amount;
    }

    const producing = input.signals.asset_snapshot.filter((a) => a.status === 'producing').length;
    const production_utilisation_ratio =
      input.signals.asset_snapshot.length === 0
        ? 0
        : producing / input.signals.asset_snapshot.length;

    const maintenance_closed_count = input.signals.maintenance_closures.length;

    type Bucket = { count: number; total_by_currency: Record<string, number> };
    const mk = (): Bucket => ({ count: 0, total_by_currency: {} });
    const d_0_30 = mk();
    const d_31_60 = mk();
    const d_61_90 = mk();
    const d_90p = mk();
    for (const a of input.signals.outstanding_royalties) {
      const bkt = a.days_late <= 30 ? d_0_30 : a.days_late <= 60 ? d_31_60 : a.days_late <= 90 ? d_61_90 : d_90p;
      bkt.count++;
      bkt.total_by_currency[a.currency] = (bkt.total_by_currency[a.currency] ?? 0) + a.amount;
    }

    const provenance_hash = `compile-weekly-report::${ctx.tenant_id}::${input.window_start}::${input.window_end}`;
    const write = await ctx.entity_store.upsertEntity(ctx.tenant_id, {
      entity_type: 'weekly_report',
      entity_id: report_id,
      attributes: [
        {
          attribute_key: 'window_start',
          value: input.window_start,
          provenance: { source: 'compile-weekly-report.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'window_end',
          value: input.window_end,
          provenance: { source: 'compile-weekly-report.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'royalty_collected_by_currency',
          value: royalty_collected_by_currency,
          provenance: { source: 'compile-weekly-report.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'production_utilisation_ratio',
          value: production_utilisation_ratio,
          provenance: { source: 'compile-weekly-report.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'maintenance_closed_count',
          value: maintenance_closed_count,
          provenance: { source: 'compile-weekly-report.skill', hash: provenance_hash, captured_at: ctx.now },
        },
        {
          attribute_key: 'outstanding_royalties_by_bucket',
          value: { d_0_30, d_31_60, d_61_90, d_90p },
          provenance: { source: 'compile-weekly-report.skill', hash: provenance_hash, captured_at: ctx.now },
        },
      ],
    });

    return {
      report_id,
      royalty_collected_by_currency,
      production_utilisation_ratio,
      maintenance_closed_count,
      outstanding_royalties_by_bucket: { d_0_30, d_31_60, d_61_90, d_90p },
      attribute_written: write.attributes_written > 0,
    };
  },
};

export const compileWeeklyReportSkill: CodeSkill<
  CompileWeeklyReportInput,
  CompileWeeklyReportOutput
> = {
  id: 'compile-weekly-report',
  name: 'Compile Weekly Report',
  description:
    'Aggregate 7-day royalty, production, maintenance, and outstanding-royalty signals into a portfolio weekly report entity.',
  embedding: embed('weekly report portfolio royalty production maintenance outstanding royalties'),
  jurisdiction: 'platform',
  success_count: 0,
  failure_count: 0,
  consecutive_failures: 0,
  quarantined: false,
  code: fn,
};
