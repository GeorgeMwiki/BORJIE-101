/**
 * Data Onboarding persistence (Wave 18U).
 *
 * Companion to docs/DESIGN/DATA_ONBOARDING_SPEC.md. Drizzle types
 * for the 2 tables created by migration 0022_data_onboarding.sql:
 *
 *   - dataOnboardingSessions       → one row per onboarding session,
 *                                     status lifecycle discovering →
 *                                     matching → proposing →
 *                                     awaiting_owner → persisting →
 *                                     enriching → complete | failed.
 *                                     JSONB columns hold the typed
 *                                     payloads of each completed
 *                                     stage. Tenant-scoped.
 *   - dataOnboardingRowProvenance  → one row per persisted DB row,
 *                                     bound back to the source file +
 *                                     sheet + row number. Tenant-scoped.
 *
 * Schema-evolution proposals themselves live in the existing
 * mutation-authority-owned proposals tables — no duplication.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  numeric,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// data_onboarding_sessions
// ============================================================================

export const dataOnboardingSessions = pgTable(
  'data_onboarding_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    attachmentId: uuid('attachment_id').notNull(),
    /** Closed catalogue: see EntityType in @borjie/data-onboarding. */
    inferredEntityType: text('inferred_entity_type').notNull(),
    /** 0..1 (numeric precision 3 scale 2). */
    entityConfidence: numeric('entity_confidence', {
      precision: 3,
      scale: 2,
    }).notNull(),
    /**
     * discovering | matching | proposing | awaiting_owner |
     * persisting | enriching | complete | failed.
     */
    status: text('status').notNull().default('discovering'),
    /** Typed `DiscoveredSchema` payload from Stage 2. */
    discoveredSchema: jsonb('discovered_schema'),
    /** Typed `SchemaMatchResult` payload from Stage 3. */
    schemaMatchResult: jsonb('schema_match_result'),
    /** Typed `SchemaEvolutionProposal[]` payload from Stage 4. */
    evolutionProposals: jsonb('evolution_proposals'),
    /** Typed `PersistResult` payload from Stage 5. */
    persistResult: jsonb('persist_result'),
    /** Typed `ProfileChainGraph` payload from Stage 6. */
    profileChainGraph: jsonb('profile_chain_graph'),
    /** Typed `EnrichmentResult` payload from Stage 7. */
    enrichmentResult: jsonb('enrichment_result'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('data_onboarding_sessions_tenant_idx').on(t.tenantId),
    statusIdx: index('data_onboarding_sessions_status_idx').on(t.status),
    startedIdx: index('data_onboarding_sessions_started_idx').on(t.startedAt),
    entityTypeIdx: index('data_onboarding_sessions_entity_type_idx').on(
      t.inferredEntityType,
    ),
    attachmentIdx: index('data_onboarding_sessions_attachment_idx').on(
      t.attachmentId,
    ),
  }),
);

// ============================================================================
// data_onboarding_row_provenance
// ============================================================================

export const dataOnboardingRowProvenance = pgTable(
  'data_onboarding_row_provenance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** The actual target table name (e.g. `workers`, `ore_parcels`). */
    targetTable: text('target_table').notNull(),
    /** The persisted row's id, as text for flexibility across PK types. */
    targetRowId: text('target_row_id').notNull(),
    sourceSessionId: uuid('source_session_id')
      .notNull()
      .references(() => dataOnboardingSessions.id, { onDelete: 'cascade' }),
    sourceFileName: text('source_file_name'),
    sourceSheet: text('source_sheet'),
    sourceRowNumber: integer('source_row_number').notNull(),
    /** insert | update | skip. */
    operation: text('operation').notNull(),
    /** Hash linking this provenance into the tenant's audit chain. */
    auditHash: text('audit_hash').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('data_onboarding_row_provenance_tenant_idx').on(
      t.tenantId,
    ),
    targetIdx: index('data_onboarding_row_provenance_target_idx').on(
      t.targetTable,
      t.targetRowId,
    ),
    sessionIdx: index('data_onboarding_row_provenance_session_idx').on(
      t.sourceSessionId,
    ),
    recordedIdx: index('data_onboarding_row_provenance_recorded_idx').on(
      t.recordedAt,
    ),
  }),
);

// ============================================================================
// Inferred Drizzle row + insert types
// ============================================================================

export type DataOnboardingSession =
  typeof dataOnboardingSessions.$inferSelect;
export type NewDataOnboardingSession =
  typeof dataOnboardingSessions.$inferInsert;

export type DataOnboardingRowProvenance =
  typeof dataOnboardingRowProvenance.$inferSelect;
export type NewDataOnboardingRowProvenance =
  typeof dataOnboardingRowProvenance.$inferInsert;
