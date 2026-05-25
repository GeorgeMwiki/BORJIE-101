/**
 * Persistent memory layer — three-table Drizzle schema (migration 0181).
 *
 * Closes the LITFIN parity gap: the kernel ports in
 * `packages/central-intelligence/src/kernel/memory/types.ts` describe
 * an episodic / semantic / procedural / reflective hierarchy, but the
 * `memory_blocks` (Letta-style core blocks), `episodic_notes` (A-Mem
 * style notes with vector embedding + parent links), and
 * `anchor_summaries` (auto-condensed summaries written when the prompt
 * window crosses ~70% of the model's context budget) tables were never
 * shipped.
 *
 * Three tables:
 *
 *   - memory_blocks    : per-(tenant, session) durable key/value blocks
 *                        with a `kind` discriminator (persona, human,
 *                        preferences, project, ...). Read at every turn
 *                        and re-injected at the top of the system
 *                        prompt; rewritten by the consolidation cycle.
 *   - episodic_notes   : per-event notes with importance score, vector
 *                        embedding (TEXT-stored JSON to stay
 *                        pgvector-optional), access counters for the
 *                        FadeMem eviction decay, and a `parents` array
 *                        of related-note IDs created at cosine >= 0.8.
 *   - anchor_summaries : window-anchored condensations. One row per
 *                        contiguous turn range that was summarised when
 *                        the conversation window approached the context
 *                        budget. Re-injected as a single bullet block
 *                        instead of the full earlier-turn transcript.
 *
 * All three tables are tenant-scoped via a nullable `tenantId` (NULL =
 * platform-tier). The migration 0181 SQL enables RLS and forces the
 * standard `app.current_tenant_id` GUC isolation.
 *
 * Embeddings stored as TEXT (JSON-serialised number array) so the
 * schema is portable across deployments without pgvector. Adapters
 * that have pgvector cast at read time.
 */

import {
  pgTable,
  text,
  doublePrecision,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ─────────────────────────────────────────────────────────────────────
// memory_blocks — Letta-style persistent key/value self-summary blocks.
// ─────────────────────────────────────────────────────────────────────

export const memoryBlocks = pgTable(
  'memory_blocks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    sessionId: text('session_id').notNull(),
    /** Discriminator: 'persona' | 'human' | 'preferences' | 'project' | ... */
    kind: text('kind').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantSessionKindIdx: index('idx_memory_blocks_tenant_session_kind').on(
      t.tenantId,
      t.sessionId,
      t.kind,
    ),
    tenantSessionUpdatedIdx: index(
      'idx_memory_blocks_tenant_session_updated',
    ).on(t.tenantId, t.sessionId, t.updatedAt.desc()),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// episodic_notes — A-Mem (Agent-Memory) style note ledger.
// ─────────────────────────────────────────────────────────────────────

export const episodicNotes = pgTable(
  'episodic_notes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    sessionId: text('session_id').notNull(),
    /** Turn index inside the session (0-based). */
    turnIdx: integer('turn_idx').notNull(),
    /** Structured event payload (chat turn, tool call, observation, ...). */
    event: jsonb('event').notNull().default({}),
    /**
     * Extracted atomic facts (strings) — joined for FTS search and used
     * by `recall(query, k)` as the candidate text for BM25 scoring.
     */
    facts: jsonb('facts').notNull().default([]),
    /**
     * Embedding of `facts.join(' ')` as JSON-serialised number array.
     * TEXT to stay pgvector-optional; adapters that have pgvector cast.
     */
    embedding: text('embedding'),
    /**
     * FadeMem importance score in [0, 1]. Set on write by
     * `clamp(0.4 + 0.1 * linkCount + (containsMoney ? 0.2 : 0), 0, 1)`.
     */
    importanceScore: doublePrecision('importance_score').notNull().default(0.4),
    /** IDs of parent notes linked at cosine similarity >= 0.8. */
    parents: jsonb('parents').notNull().default([]),
    /** Read-count for the LFU side of the eviction effective-score. */
    accessCount: integer('access_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Soft-delete marker — set by the eviction sweep when the
     * effective score falls below the 0.1 floor. Rows are hard-deleted
     * 90 days after this stamp.
     */
    softDeletedAt: timestamp('soft_deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantSessionTurnIdx: index('idx_episodic_notes_tenant_session_turn').on(
      t.tenantId,
      t.sessionId,
      t.turnIdx,
    ),
    tenantCreatedIdx: index('idx_episodic_notes_tenant_created').on(
      t.tenantId,
      t.createdAt.desc(),
    ),
    softDeletedIdx: index('idx_episodic_notes_soft_deleted').on(
      t.softDeletedAt,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// anchor_summaries — window-anchored conversation condensations.
// ─────────────────────────────────────────────────────────────────────

export const anchorSummaries = pgTable(
  'anchor_summaries',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    sessionId: text('session_id').notNull(),
    /** Inclusive turn index where the summarised window starts. */
    startTurnIdx: integer('start_turn_idx').notNull(),
    /** Inclusive turn index where the summarised window ends. */
    endTurnIdx: integer('end_turn_idx').notNull(),
    summary: text('summary').notNull(),
    /** Approximate token count of the original window before summarisation. */
    originalTokens: integer('original_tokens').notNull().default(0),
    /** Approximate token count of the summary. */
    summaryTokens: integer('summary_tokens').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantSessionRangeIdx: index(
      'idx_anchor_summaries_tenant_session_range',
    ).on(t.tenantId, t.sessionId, t.startTurnIdx, t.endTurnIdx),
    tenantSessionCreatedIdx: index(
      'idx_anchor_summaries_tenant_session_created',
    ).on(t.tenantId, t.sessionId, t.createdAt.desc()),
  }),
);
