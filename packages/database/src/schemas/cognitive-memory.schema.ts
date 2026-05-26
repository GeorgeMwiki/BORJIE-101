/**
 * Unified Cognitive Memory persistence (Wave 18AA).
 *
 * Companion to docs/DESIGN/UNIFIED_COGNITIVE_MEMORY_SPEC.md. Drizzle
 * types for the 3 tables created by migration 0029_cognitive_memory.sql:
 *
 *   - cognitiveMemoryCells          → the unified shared semantic memory.
 *                                     One row per memory cell. pgvector
 *                                     embedding (1536-dim, OpenAI
 *                                     text-embedding-3-large). HNSW
 *                                     vector index. Tenant-scoped, RLS.
 *   - cognitiveMemoryReinforcements → one row per reinforce call. Cross-
 *                                     specialisation audit trail.
 *                                     Tenant-scoped, RLS.
 *   - platformMemoryCells           → federated cross-tenant cells (PII-
 *                                     stripped). No RLS — globally
 *                                     readable; federation promoter is
 *                                     the sole writer.
 *
 * The two tenant-scoped tables use the canonical `app.tenant_id` GUC
 * RLS policy (migration 0003 pattern). `platform_memory_cells` has no
 * tenant_id column.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  numeric,
  customType,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Custom drizzle column wrapping pgvector at 1536 dimensions (OpenAI
 * text-embedding-3-large). Stored as `vector(1536)` in Postgres;
 * serialised as `[0.1, 0.2, ...]` at the wire. Migration 0029 ensures
 * the `vector` extension is created. Mirrors the pattern used by
 * `intelligence-corpus.schema.ts` and `core-entity/core-entity.schema.ts`.
 */
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    const stripped = value.replace(/^\[|\]$/g, '');
    return stripped ? stripped.split(',').map(Number) : [];
  },
});

// ============================================================================
// cognitive_memory_cells — the unified shared semantic memory
// ============================================================================

export const cognitiveMemoryCells = pgTable(
  'cognitive_memory_cells',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** 'tenant_root' or an org_unit_id. See spec §5. */
    scopeId: text('scope_id').notNull(),
    /**
     * pattern | fact | rule | preference | template | citation |
     * failure | terminology. See spec §2.
     */
    kind: text('kind').notNull(),
    contentText: text('content_text').notNull(),
    contentStructured: jsonb('content_structured'),
    embedding: vector1536('embedding'),
    /** Agent id (junior id or 'mr-mwikila') that first observed this cell. */
    contributedBySpecialisation: text('contributed_by_specialisation').notNull(),
    reinforcedBySpecialisations: text('reinforced_by_specialisations')
      .array()
      .notNull()
      .default([]),
    /** → cognitive_turns(id) when present. Nullable to allow seed cells. */
    contributedInTurnId: uuid('contributed_in_turn_id'),
    reinforcedInTurnIds: uuid('reinforced_in_turn_ids')
      .array()
      .notNull()
      .default([]),
    /** SpanCitation[] — provenance + evidence carried by the cell. */
    evidenceCitations: jsonb('evidence_citations').notNull().default([]),
    confidenceScore: numeric('confidence_score', { precision: 3, scale: 2 })
      .notNull()
      .default('0.50'),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    /**
     * observed | reinforced | consolidated | decayed | contradicted.
     * See spec §4.
     */
    promotionStatus: text('promotion_status').notNull().default('observed'),
    /** Self-FK; when contradicted, points to the cell that replaced this one. */
    contradictingCellId: uuid('contradicting_cell_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    decayedAt: timestamp('decayed_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantScopeIdx: index('idx_cmc_tenant_scope').on(
      t.tenantId,
      t.scopeId,
      t.promotionStatus,
    ),
    specialisationIdx: index('idx_cmc_specialisation').on(
      t.contributedBySpecialisation,
      t.createdAt,
    ),
    kindStatusIdx: index('idx_cmc_kind_status').on(
      t.tenantId,
      t.kind,
      t.promotionStatus,
    ),
  }),
);

export type CognitiveMemoryCellRow = typeof cognitiveMemoryCells.$inferSelect;
export type CognitiveMemoryCellInsert = typeof cognitiveMemoryCells.$inferInsert;

// ============================================================================
// cognitive_memory_reinforcements — cross-specialisation audit trail
// ============================================================================

export const cognitiveMemoryReinforcements = pgTable(
  'cognitive_memory_reinforcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cellId: uuid('cell_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    specialisation: text('specialisation').notNull(),
    turnId: uuid('turn_id').notNull(),
    reinforcedAt: timestamp('reinforced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    cellIdx: index('idx_cmr_cell').on(t.cellId, t.reinforcedAt),
    tenantIdx: index('idx_cmr_tenant').on(t.tenantId, t.reinforcedAt),
  }),
);

export type CognitiveMemoryReinforcementRow =
  typeof cognitiveMemoryReinforcements.$inferSelect;
export type CognitiveMemoryReinforcementInsert =
  typeof cognitiveMemoryReinforcements.$inferInsert;

// ============================================================================
// platform_memory_cells — federated cross-tenant memory (NO RLS)
//
// PII-stripped, globally readable by design. Federation promoter is the
// only writer. No tenant_id column — tenant provenance collapses into
// source_tenant_count.
// ============================================================================

export const platformMemoryCells = pgTable(
  'platform_memory_cells',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    contentText: text('content_text').notNull(),
    embedding: vector1536('embedding'),
    sourceTenantCount: integer('source_tenant_count').notNull(),
    promotionStatus: text('promotion_status').notNull().default('observed'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    kindStatusIdx: index('idx_pmc_kind_status').on(t.kind, t.promotionStatus),
  }),
);

export type PlatformMemoryCellRow = typeof platformMemoryCells.$inferSelect;
export type PlatformMemoryCellInsert = typeof platformMemoryCells.$inferInsert;
