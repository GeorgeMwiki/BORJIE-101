/**
 * tutoring_skill_pack (migration 0210) — Piece H Socratic-tutor
 * concept registry.
 *
 * One row per concept. `tenant_id` NULL = platform built-in (10 are
 * seeded: NOI, Cap Rate, Arrears Aging, Occupancy Rate, Depreciation,
 * Trial Balance, P&L, Balance Sheet, Cash Flow, IRR). Tenants can
 * author custom concepts.
 *
 * The lesson orchestrator pulls live tenant data through
 * `data_binding_jsonb` and substitutes placeholders into the
 * worked-example. Every number carries a citation back to the source
 * row, so the learner can drill in.
 *
 * RLS pattern (see 0210_tutoring_skill_pack.sql):
 *   - SELECT: tenant_id IS NULL OR tenant_id = current_app_tenant_id()
 *   - INSERT/UPDATE/DELETE: tenant_id = current_app_tenant_id()
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export interface TutoringWorkedExample {
  readonly prompt: string;
  readonly answer: string;
  readonly explanation: string;
  /** Keys in data_binding_jsonb.placeholders that this example cites. */
  readonly citation_keys: readonly string[];
}

export interface TutoringCheckUnderstanding {
  readonly question: string;
  /** Regex pattern matched (case-insensitive) against the learner's answer. */
  readonly expected_pattern: string;
  readonly hint: string;
}

export interface TutoringContent {
  readonly hook: string;
  readonly definition: string;
  readonly formula: string | null;
  readonly worked_example: TutoringWorkedExample;
  readonly common_mistakes: readonly string[];
  readonly check_understanding: readonly TutoringCheckUnderstanding[];
}

export interface TutoringMasteryThresholds {
  readonly beginner: { readonly min_correct: number };
  readonly intermediate: {
    readonly min_correct: number;
    readonly window?: number;
  };
  readonly advanced: {
    readonly min_correct: number;
    readonly window?: number;
  };
}

export interface TutoringDataBinding {
  /** Repository / data-provider key, e.g. "payments-ledger.tenant.month_summary". */
  readonly source: string;
  /** Inputs to the data-source call. */
  readonly inputs: Readonly<Record<string, unknown>>;
  /**
   * Map of placeholder key → JSONPath expression (relative to the data
   * source's response) that fills the worked-example placeholder.
   */
  readonly placeholders: Readonly<Record<string, string>>;
}

export const tutoringSkillPack = pgTable(
  'tutoring_skill_pack',
  {
    id: text('id').primaryKey(),
    /** NULL = platform built-in concept. */
    tenantId: text('tenant_id'),
    conceptSlug: text('concept_slug').notNull(),
    displayNameEn: text('display_name_en').notNull(),
    displayNameSw: text('display_name_sw'),
    description: text('description'),
    /** TEXT[] of concept slugs this concept depends on. */
    prerequisiteConcepts: text('prerequisite_concepts').array(),
    masteryThresholdsJsonb: jsonb('mastery_thresholds_jsonb')
      .$type<TutoringMasteryThresholds>()
      .notNull(),
    contentJsonb: jsonb('content_jsonb').$type<TutoringContent>().notNull(),
    dataBindingJsonb: jsonb('data_binding_jsonb').$type<TutoringDataBinding>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    platformSlugIdx: uniqueIndex('uq_tutoring_skill_pack_platform_slug')
      .on(t.conceptSlug)
      .where(sql`tenant_id IS NULL`),
    tenantSlugIdx: uniqueIndex('uq_tutoring_skill_pack_tenant_slug')
      .on(t.tenantId, t.conceptSlug)
      .where(sql`tenant_id IS NOT NULL`),
    tenantIdx: index('idx_tutoring_skill_pack_tenant').on(t.tenantId),
    slugCheck: check(
      'ck_tutoring_skill_pack_slug_nonempty',
      sql`length(${t.conceptSlug}) > 0`,
    ),
  }),
);

export type TutoringSkillPackRow = typeof tutoringSkillPack.$inferSelect;
export type TutoringSkillPackInsert = typeof tutoringSkillPack.$inferInsert;
