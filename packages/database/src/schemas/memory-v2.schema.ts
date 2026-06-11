/**
 * Memory-v2 persistence (MEM-01 — six-layer cognitive memory durability).
 *
 * Companion to `@borjie/memory-v2`. Drizzle types for the 6 tables created
 * by migration 0312_memory_v2_durable_stores.sql:
 *
 *   - memoryV2Episodes        → episodic layer (bi-temporal facts; one row
 *                               per episode). pgvector embedding (1536-dim,
 *                               OpenAI text-embedding-3-large). Tenant-scoped,
 *                               RLS.
 *   - memoryV2EpisodeFacts    → subject/predicate/object facts attached to an
 *                               episode (bi-temporal). Tenant-scoped via the
 *                               parent episode; carries tenant_id for RLS.
 *   - memoryV2NarrativeArcs   → multi-episode arcs. Tenant-scoped, RLS.
 *   - memoryV2ProceduralSkills→ Voyager-style recurring skills. Tenant-scoped,
 *                               RLS.
 *   - memoryV2ReflectiveNotes → Reflexion-style periodic notes. Tenant-scoped,
 *                               RLS.
 *   - memoryV2TopicFiles      → topic-scoped memory shards. Tenant-scoped, RLS.
 *   - memoryV2CohortCache     → per-tenant + per-jurisdiction cache layer.
 *                               Tenant-scoped, RLS.
 *
 * The volatile in-memory reference impls live in `@borjie/memory-v2`. These
 * Drizzle tables back the durable counterpart selected at the composition
 * root (service-registry) when a live DB handle is available — so the
 * six-layer substrate SURVIVES a process restart (MEM-01).
 *
 * Every tenant-scoped table uses the canonical `app.current_tenant_id` GUC
 * RLS policy (migration 0309 pattern). NULL-tenant rows are never written by
 * these stores.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  numeric,
  customType,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Custom drizzle column wrapping pgvector at 1536 dimensions (OpenAI
 * text-embedding-3-large). Mirrors `cognitive-memory.schema.ts`. Migration
 * 0312 ensures the `vector` extension exists.
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
// memory_v2_episodes — episodic layer (bi-temporal episodes)
// ============================================================================

export const memoryV2Episodes = pgTable(
  'memory_v2_episodes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** owner_portal | estate_manager | … | general. */
    surface: text('surface').notNull(),
    subject: text('subject'),
    title: text('title'),
    summary: text('summary'),
    /** Real-world start of the event. */
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    /** Real-world end of the event (null = ongoing). */
    validTo: timestamp('valid_to', { withTimezone: true }),
    /** When the system recorded the episode. */
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    embedding: vector1536('embedding'),
    tags: text('tags').array().notNull().default([]),
  },
  (t) => ({
    tenantSurfaceIdx: index('idx_mv2_ep_tenant_surface').on(
      t.tenantId,
      t.surface,
      t.recordedAt,
    ),
    tenantSubjectIdx: index('idx_mv2_ep_tenant_subject').on(
      t.tenantId,
      t.subject,
    ),
    tenantUserIdx: index('idx_mv2_ep_tenant_user').on(t.tenantId, t.userId),
  }),
);

export type MemoryV2EpisodeRow = typeof memoryV2Episodes.$inferSelect;
export type MemoryV2EpisodeInsert = typeof memoryV2Episodes.$inferInsert;

// ============================================================================
// memory_v2_episode_facts — bi-temporal facts attached to an episode
// ============================================================================

export const memoryV2EpisodeFacts = pgTable(
  'memory_v2_episode_facts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    episodeId: text('episode_id').notNull(),
    subject: text('subject').notNull(),
    predicate: text('predicate').notNull(),
    object: text('object').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 })
      .notNull()
      .default('0.500'),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    episodeIdx: index('idx_mv2_fact_episode').on(t.episodeId, t.recordedAt),
    tenantIdx: index('idx_mv2_fact_tenant').on(t.tenantId),
  }),
);

export type MemoryV2EpisodeFactRow = typeof memoryV2EpisodeFacts.$inferSelect;
export type MemoryV2EpisodeFactInsert =
  typeof memoryV2EpisodeFacts.$inferInsert;

// ============================================================================
// memory_v2_narrative_arcs — multi-episode arcs
// ============================================================================

export const memoryV2NarrativeArcs = pgTable(
  'memory_v2_narrative_arcs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    /** Ordered list of episode ids composing the arc. */
    episodeIds: text('episode_ids').array().notNull().default([]),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    tags: text('tags').array().notNull().default([]),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_mv2_arc_tenant').on(t.tenantId, t.recordedAt),
  }),
);

export type MemoryV2NarrativeArcRow = typeof memoryV2NarrativeArcs.$inferSelect;
export type MemoryV2NarrativeArcInsert =
  typeof memoryV2NarrativeArcs.$inferInsert;

// ============================================================================
// memory_v2_procedural_skills — Voyager-style recurring skills
// ============================================================================

export const memoryV2ProceduralSkills = pgTable(
  'memory_v2_procedural_skills',
  {
    /** Synthetic id `${tenantId}:${name}` so upsert dedupes per (tenant,name). */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    triggerPattern: text('trigger_pattern').notNull(),
    /** Array of action descriptors (Record<string, unknown>[]). */
    actionSequence: jsonb('action_sequence').notNull().default([]),
    observedCount: integer('observed_count').notNull().default(1),
    successRate: numeric('success_rate', { precision: 4, scale: 3 })
      .notNull()
      .default('0.000'),
    promoted: text('promoted').notNull().default('false'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPromotedIdx: index('idx_mv2_skill_tenant_promoted').on(
      t.tenantId,
      t.promoted,
      t.lastSeenAt,
    ),
  }),
);

export type MemoryV2ProceduralSkillRow =
  typeof memoryV2ProceduralSkills.$inferSelect;
export type MemoryV2ProceduralSkillInsert =
  typeof memoryV2ProceduralSkills.$inferInsert;

// ============================================================================
// memory_v2_reflective_notes — Reflexion-style periodic notes
// ============================================================================

export const memoryV2ReflectiveNotes = pgTable(
  'memory_v2_reflective_notes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id'),
    insight: text('insight').notNull(),
    adjustments: text('adjustments').array().notNull().default([]),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    selfScore: numeric('self_score', { precision: 4, scale: 3 })
      .notNull()
      .default('0.500'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantPeriodIdx: index('idx_mv2_note_tenant_period').on(
      t.tenantId,
      t.periodEnd,
    ),
  }),
);

export type MemoryV2ReflectiveNoteRow =
  typeof memoryV2ReflectiveNotes.$inferSelect;
export type MemoryV2ReflectiveNoteInsert =
  typeof memoryV2ReflectiveNotes.$inferInsert;

// ============================================================================
// memory_v2_topic_files — topic-scoped memory shards
// ============================================================================

export const memoryV2TopicFiles = pgTable(
  'memory_v2_topic_files',
  {
    /** Synthetic id `${tenantId}:${topic}` so upsert dedupes per (tenant,topic). */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    topic: text('topic').notNull(),
    summary: text('summary').notNull(),
    /** EpisodeFact[] snapshot folded into the topic. */
    facts: jsonb('facts').notNull().default([]),
    episodeIds: text('episode_ids').array().notNull().default([]),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantTopicIdx: index('idx_mv2_topic_tenant_topic').on(
      t.tenantId,
      t.topic,
    ),
  }),
);

export type MemoryV2TopicFileRow = typeof memoryV2TopicFiles.$inferSelect;
export type MemoryV2TopicFileInsert = typeof memoryV2TopicFiles.$inferInsert;

// ============================================================================
// memory_v2_cohort_cache — per-tenant + per-jurisdiction cache layer
// ============================================================================

export const memoryV2CohortCache = pgTable(
  'memory_v2_cohort_cache',
  {
    /** Synthetic id `${tenantId}:${jurisdiction}:${key}`. */
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** ISO-3166-1 alpha-2 or the literal '_global_' sentinel for null. */
    jurisdiction: text('jurisdiction').notNull().default('_global_'),
    cacheKey: text('cache_key').notNull(),
    value: jsonb('value').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => ({
    tenantJurisIdx: index('idx_mv2_cohort_tenant_juris').on(
      t.tenantId,
      t.jurisdiction,
      t.cacheKey,
    ),
  }),
);

export type MemoryV2CohortCacheRow = typeof memoryV2CohortCache.$inferSelect;
export type MemoryV2CohortCacheInsert =
  typeof memoryV2CohortCache.$inferInsert;
