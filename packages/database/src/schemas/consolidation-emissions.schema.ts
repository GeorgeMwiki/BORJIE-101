/**
 * Consolidation emissions schema (migration 0152, D8 follow-up).
 *
 * One row per (tenant, day) summarising the nightly consolidation tick.
 * Powers the morning briefing's "what changed overnight" surface and the
 * weekly digest. Idempotent: stage 08 (publish) UPSERTs on (tenant_id,
 * emission_date) so a re-run on the same day updates rather than inserts.
 */

import { pgTable, text, integer, jsonb, timestamp, date, unique, index } from 'drizzle-orm/pg-core';

export const consolidationEmissions = pgTable(
  'consolidation_emissions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    emissionDate: date('emission_date').notNull(),
    tickId: text('tick_id').notNull(),
    factsDistilled: integer('facts_distilled').notNull().default(0),
    factsPromoted: integer('facts_promoted').notNull().default(0),
    reflexionLessonsWritten: integer('reflexion_lessons_written').notNull().default(0),
    entitiesConsolidated: integer('entities_consolidated').notNull().default(0),
    communitiesDetected: integer('communities_detected').notNull().default(0),
    rowsReEmbedded: integer('rows_re_embedded').notNull().default(0),
    digestMarkdown: text('digest_markdown'),
    highlights: jsonb('highlights').notNull().default([]),
    emittedAt: timestamp('emitted_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueTenantDate: unique('consolidation_emissions_tenant_date_unique').on(
      table.tenantId,
      table.emissionDate,
    ),
    idxTenantDate: index('idx_consolidation_emissions_tenant_date').on(
      table.tenantId,
      table.emissionDate,
    ),
    idxEmittedAt: index('idx_consolidation_emissions_emitted_at').on(table.emittedAt),
  }),
);

export type ConsolidationEmissionRow = typeof consolidationEmissions.$inferSelect;
export type NewConsolidationEmissionRow = typeof consolidationEmissions.$inferInsert;
