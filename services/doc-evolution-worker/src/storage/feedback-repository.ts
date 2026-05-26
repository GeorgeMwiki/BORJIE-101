/**
 * feedback-repository — read on `doc_feedback_events`.
 *
 * The nightly aggregator pulls every event in the rolling window per
 * recipe and asks the metric-computer to bucket them.
 */

import type { DocFeedbackEventRow, FeedbackKind } from '../types.js';
import type { SqlPort } from './recipe-repository.js';

export interface FeedbackRepository {
  listForRecipeWindow(args: {
    readonly recipe_id: string;
    readonly recipe_version: number;
    readonly window_start_iso: string;
    readonly window_end_iso: string;
  }): Promise<ReadonlyArray<DocFeedbackEventRow>>;
  /** Convenience: regulator flag count in the configured lookback. */
  countRegulatorFlags(args: {
    readonly recipe_id: string;
    readonly recipe_version: number;
    readonly since_iso: string;
  }): Promise<number>;
  /** Convenience: events grouped by `feedback_kind`. */
  countByKind(args: {
    readonly recipe_id: string;
    readonly recipe_version: number;
    readonly window_start_iso: string;
    readonly window_end_iso: string;
  }): Promise<ReadonlyArray<{ kind: FeedbackKind; count: number }>>;
}

export function createFeedbackRepository(sql: SqlPort): FeedbackRepository {
  return {
    async listForRecipeWindow(args) {
      return sql<DocFeedbackEventRow>`
        select e.id, e.artifact_id, e.tenant_id, e.feedback_kind,
               e.section_path, coalesce(e.detail, '{}'::jsonb) as detail,
               e.recorded_at
        from doc_feedback_events e
        join document_artifacts a on a.id = e.artifact_id
        where a.recipe_id = ${args.recipe_id}
          and a.recipe_version = ${args.recipe_version}
          and e.recorded_at >= ${args.window_start_iso}::timestamptz
          and e.recorded_at <= ${args.window_end_iso}::timestamptz
        order by e.recorded_at asc
      `;
    },
    async countRegulatorFlags(args) {
      const rows = await sql<{ count: string }>`
        select count(*)::text as count
        from doc_feedback_events e
        join document_artifacts a on a.id = e.artifact_id
        where a.recipe_id = ${args.recipe_id}
          and a.recipe_version = ${args.recipe_version}
          and e.feedback_kind = 'regulator_flag'
          and e.recorded_at >= ${args.since_iso}::timestamptz
      `;
      const n = Number(rows[0]?.count ?? '0');
      return Number.isFinite(n) ? n : 0;
    },
    async countByKind(args) {
      const rows = await sql<{ kind: FeedbackKind; count: string }>`
        select e.feedback_kind as kind, count(*)::text as count
        from doc_feedback_events e
        join document_artifacts a on a.id = e.artifact_id
        where a.recipe_id = ${args.recipe_id}
          and a.recipe_version = ${args.recipe_version}
          and e.recorded_at >= ${args.window_start_iso}::timestamptz
          and e.recorded_at <= ${args.window_end_iso}::timestamptz
        group by e.feedback_kind
      `;
      return rows.map((r) => ({ kind: r.kind, count: Number(r.count) }));
    },
  };
}
