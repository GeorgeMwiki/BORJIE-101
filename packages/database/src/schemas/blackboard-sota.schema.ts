/**
 * Blackboard SOTA persistence (Wave BLACKBOARD-CORE).
 *
 * Companion to Docs/DESIGN/BLACKBOARD_SOTA_2026.md. Drizzle types for
 * the 5 tables created by migration 0073_blackboard_sota.sql:
 *
 *   - blackboardRegions             → per-namespace problem-solving
 *                                     scope. region_kind enumeration:
 *                                     incident-investigation,
 *                                     royalty-filing-prep,
 *                                     buyer-deal-room, shift-planning,
 *                                     regulator-correspondence,
 *                                     deep-research-session,
 *                                     dashboard-composition. Tenant-
 *                                     scoped composite PK (tenant_id,
 *                                     id). Per-region audit chain.
 *
 *   - blackboardKnowledgeSources    → KS registry. ks_kind in
 *                                     {junior, connector, tool, user,
 *                                     external-feed}. region_filter
 *                                     text[]. priority real in [0, 1].
 *                                     UNIQUE on (tenant_id, ks_kind,
 *                                     ks_name).
 *
 *   - blackboardPostsV2             → threaded posts with embeddings.
 *                                     FK to regions + KSes. content
 *                                     text + vector(1536). parent_post_id
 *                                     supports shallow threading.
 *                                     Hash-chains into the region's
 *                                     chain.
 *
 *   - blackboardCrossReferences     → detected post-to-post links.
 *                                     ref_kind in {cites, contradicts,
 *                                     answers, supersedes, elaborates}.
 *                                     UNIQUE on (tenant_id,
 *                                     src_post_id, dst_post_id,
 *                                     ref_kind) keeps the table
 *                                     deduplicated.
 *
 *   - blackboardSummaries           → rolling / final / digest
 *                                     summaries. covers_from /
 *                                     covers_to fence the window.
 *                                     Hash-chains into the region's
 *                                     chain.
 *
 * All five tables are tenant-scoped and use the canonical
 * `app.tenant_id` GUC RLS policy (migration 0003 pattern).
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  uuid,
  real,
  customType,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * Custom drizzle column wrapping pgvector at 1536 dimensions
 * (OpenAI `text-embedding-3-large`). Mirrors the helper used in
 * cognitive-memory.schema.ts so both consumers share the same
 * embedding port.
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
// blackboard_regions — per-namespace problem-solving scope
// ============================================================================

export const blackboardRegions = pgTable(
  'blackboard_regions',
  {
    /** Stable text identifier, e.g. 'incident-investigation:KAH-088'. */
    id: text('id').notNull(),
    tenantId: text('tenant_id').notNull(),
    scopeId: text('scope_id'),
    /**
     * incident-investigation | royalty-filing-prep | buyer-deal-room |
     * shift-planning | regulator-correspondence | deep-research-session |
     * dashboard-composition. See spec §3.3.
     */
    regionKind: text('region_kind').notNull(),
    /** open | active | closed */
    status: text('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    prevHash: text('prev_hash').notNull().default(''),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.id] }),
    kindStatusIdx: index('idx_bbr_tenant_kind_status').on(
      table.tenantId,
      table.regionKind,
      table.status,
    ),
    openedIdx: index('idx_bbr_tenant_opened').on(
      table.tenantId,
      table.openedAt,
    ),
  }),
);

export type BlackboardRegionRow = typeof blackboardRegions.$inferSelect;
export type NewBlackboardRegionRow = typeof blackboardRegions.$inferInsert;

// ============================================================================
// blackboard_knowledge_sources — KS registry
// ============================================================================

export const blackboardKnowledgeSources = pgTable(
  'blackboard_knowledge_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** junior | connector | tool | user | external-feed */
    ksKind: text('ks_kind').notNull(),
    ksName: text('ks_name').notNull(),
    /** region_kind values this KS claims competence on. Empty = all. */
    regionFilter: text('region_filter')
      .array()
      .notNull()
      .default([]),
    priority: real('priority').notNull().default(0.5),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    uniquePerTenant: uniqueIndex('blackboard_ks_unique_per_tenant').on(
      table.tenantId,
      table.ksKind,
      table.ksName,
    ),
    kindIdx: index('idx_bbks_tenant_kind').on(table.tenantId, table.ksKind),
  }),
);

export type BlackboardKnowledgeSourceRow =
  typeof blackboardKnowledgeSources.$inferSelect;
export type NewBlackboardKnowledgeSourceRow =
  typeof blackboardKnowledgeSources.$inferInsert;

// ============================================================================
// blackboard_posts_v2 — threaded posts with embeddings
// ============================================================================

export const blackboardPostsV2 = pgTable(
  'blackboard_posts_v2',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    regionId: text('region_id').notNull(),
    ksId: uuid('ks_id').notNull(),
    parentPostId: uuid('parent_post_id'),
    content: text('content').notNull(),
    contentEmbedding: vector1536('content_embedding'),
    structured: jsonb('structured').notNull().default({}),
    postedAt: timestamp('posted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    editCount: integer('edit_count').notNull().default(0),
    prevHash: text('prev_hash').notNull().default(''),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    regionPostedIdx: index('idx_bbp_v2_tenant_region_posted').on(
      table.tenantId,
      table.regionId,
      table.postedAt,
    ),
    parentIdx: index('idx_bbp_v2_parent').on(
      table.tenantId,
      table.parentPostId,
    ),
    ksIdx: index('idx_bbp_v2_ks').on(
      table.tenantId,
      table.ksId,
      table.postedAt,
    ),
  }),
);

export type BlackboardPostV2Row = typeof blackboardPostsV2.$inferSelect;
export type NewBlackboardPostV2Row = typeof blackboardPostsV2.$inferInsert;

// ============================================================================
// blackboard_cross_references — detected post-to-post links
// ============================================================================

export const blackboardCrossReferences = pgTable(
  'blackboard_cross_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    srcPostId: uuid('src_post_id').notNull(),
    dstPostId: uuid('dst_post_id').notNull(),
    /** cites | contradicts | answers | supersedes | elaborates */
    refKind: text('ref_kind').notNull(),
    confidence: real('confidence').notNull().default(1.0),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    uniqueXref: uniqueIndex('blackboard_xref_unique').on(
      table.tenantId,
      table.srcPostId,
      table.dstPostId,
      table.refKind,
    ),
    srcIdx: index('idx_bbxref_tenant_src').on(table.tenantId, table.srcPostId),
    dstIdx: index('idx_bbxref_tenant_dst').on(table.tenantId, table.dstPostId),
  }),
);

export type BlackboardCrossReferenceRow =
  typeof blackboardCrossReferences.$inferSelect;
export type NewBlackboardCrossReferenceRow =
  typeof blackboardCrossReferences.$inferInsert;

// ============================================================================
// blackboard_summaries — rolling / final / digest summaries
// ============================================================================

export const blackboardSummaries = pgTable(
  'blackboard_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    regionId: text('region_id').notNull(),
    /** rolling | final | digest */
    summaryKind: text('summary_kind').notNull(),
    summaryText: text('summary_text').notNull(),
    tokenCount: integer('token_count').notNull().default(0),
    coversFrom: timestamp('covers_from', { withTimezone: true }).notNull(),
    coversTo: timestamp('covers_to', { withTimezone: true }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (table) => ({
    regionGeneratedIdx: index('idx_bbsum_tenant_region_generated').on(
      table.tenantId,
      table.regionId,
      table.generatedAt,
    ),
    kindIdx: index('idx_bbsum_tenant_kind').on(
      table.tenantId,
      table.summaryKind,
      table.generatedAt,
    ),
  }),
);

export type BlackboardSummaryRow = typeof blackboardSummaries.$inferSelect;
export type NewBlackboardSummaryRow = typeof blackboardSummaries.$inferInsert;
