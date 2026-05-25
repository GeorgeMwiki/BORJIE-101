/**
 * Temporal entity graph — Zep / Graphiti-style bi-temporal KG.
 *
 * B4 (Central Command Phase B). The brain's semantic layer is currently
 * a flat (key, value, confidence) store at `kernel_memory_semantic`.
 * That works for "Tenant John's preferred language is Swahili" but
 * collapses on questions like "who was living in 4B in March?" because
 * relations have validity windows ("LIVES_IN unit-4B from 2026-01-15 to
 * 2026-03-30") that the flat store cannot represent without lossy
 * key-encoding.
 *
 * Three tables (idempotent CREATE IF NOT EXISTS, migration 0140):
 *
 *   - `temporal_entities`       — typed nodes (tenant | unit | lease |
 *                                 payment | maintenance-ticket | ...).
 *                                 (tenant_id, entity_type, entity_key,
 *                                 valid_from) is unique so the same
 *                                 business entity can have multiple
 *                                 versioned rows (one per validity
 *                                 window) without dedup conflicts.
 *   - `temporal_relationships`  — typed edges (LIVES_IN | PAYS | OWNS
 *                                 | REPORTS_FAULT_IN | ...). Carries
 *                                 its own bi-temporal validity window.
 *   - `temporal_communities`    — output of nightly community detection
 *                                 (Louvain modularity-maximisation, see
 *                                 https://arxiv.org/abs/0803.0476).
 *                                 `community_id` is back-referenced
 *                                 from entities + relationships.
 *
 * Bi-temporal model (Graphiti):
 *   - `valid_from` / `valid_to`        — true-in-the-world window
 *   - `recorded_at`                    — when the brain learned it
 *   - `invalidated_at`                 — soft-invalidation marker
 *
 * Rows are NEVER deleted: the consolidation worker sets `invalidated_at`
 * and writes a new row with a fresh validity window when the world
 * changes. This is how "Tenant X moved out of 4B on 2026-03-30" becomes
 * queryable retroactively.
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const temporalEntities = pgTable(
  'temporal_entities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** 'tenant' | 'unit' | 'lease' | 'payment' | 'maintenance-ticket' | ... */
    entityType: text('entity_type').notNull(),
    /** Stable business key (e.g. lease.id, unit.code, tenant.email). */
    entityKey: text('entity_key').notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    /** NULL ⇒ currently valid. */
    validTo: timestamp('valid_to', { withTimezone: true }),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Never deleted; logically invalidated by the worker. */
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    /** Latest community-detection output (back-ref to temporal_communities.id). */
    communityId: text('community_id'),
    /** 0.00-1.00 confidence in this fact (Borjie mining-domain). */
    confidence: numeric('confidence', { precision: 3, scale: 2 })
      .notNull()
      .default('1.00'),
    /** Source document / sample / sensor IDs proving this fact. */
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    /** source label: doc:UUID | agent:NAME | sensor:ID | user:UUID. */
    source: text('source').notNull().default('user:unknown'),
  },
  (t) => ({
    bizKeyUniq: uniqueIndex('uniq_temporal_entities_biz_key').on(
      t.tenantId,
      t.entityType,
      t.entityKey,
      t.validFrom,
    ),
    typeIdx: index('idx_temporal_entities_tenant_type').on(
      t.tenantId,
      t.entityType,
    ),
    communityIdx: index('idx_temporal_entities_community').on(
      t.tenantId,
      t.communityId,
    ),
    validIdx: index('idx_temporal_entities_valid_window').on(
      t.tenantId,
      t.validFrom,
      t.validTo,
    ),
  }),
);

export const temporalRelationships = pgTable(
  'temporal_relationships',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fromEntityId: text('from_entity_id')
      .notNull()
      .references(() => temporalEntities.id, { onDelete: 'cascade' }),
    toEntityId: text('to_entity_id')
      .notNull()
      .references(() => temporalEntities.id, { onDelete: 'cascade' }),
    /** 'LIVES_IN' | 'PAYS' | 'OWNS' | 'REPORTS_FAULT_IN' | ... */
    relationship: text('relationship').notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    communityId: text('community_id'),
  },
  (t) => ({
    fromIdx: index('idx_temporal_relationships_from').on(
      t.tenantId,
      t.fromEntityId,
    ),
    toIdx: index('idx_temporal_relationships_to').on(
      t.tenantId,
      t.toEntityId,
    ),
    relIdx: index('idx_temporal_relationships_rel').on(
      t.tenantId,
      t.relationship,
    ),
    communityIdx: index('idx_temporal_relationships_community').on(
      t.tenantId,
      t.communityId,
    ),
  }),
);

export const temporalCommunities = pgTable(
  'temporal_communities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    size: integer('size').notNull().default(0),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** 'louvain' | 'label-propagation' */
    algorithm: text('algorithm').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => ({
    tenantSizeIdx: index('idx_temporal_communities_tenant_size').on(
      t.tenantId,
      t.size,
    ),
  }),
);
