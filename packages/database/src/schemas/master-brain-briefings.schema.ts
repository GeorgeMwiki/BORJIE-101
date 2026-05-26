/**
 * Master Brain autonomous-loops persistence (Wave 17).
 *
 * Companion to docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md and
 * docs/DESIGN/AUTONOMOUS_LOOPS_SPEC.md. Drizzle types for the 4 tables
 * created by migration 0016_master_brain_briefings.sql:
 *
 *   - masterBrainBriefings  → citation-anchored morning briefings +
 *                              overnight draft plans.
 *   - spawnProposals        → Anticipatory UX next-3-moves predictions.
 *   - passiveCaptureEvents  → per-turn entity-extraction trace.
 *   - dailyResearchCache    → per-source rate-limited fetch cache.
 *
 * All tenant-scoped; RLS enforced at the database layer.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ============================================================================
// master_brain_briefings — citation-anchored daily briefings
// ============================================================================

export const masterBrainBriefings = pgTable(
  'master_brain_briefings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** draft | final | superseded. */
    status: text('status').notNull().default('final'),
    /** Markdown body rendered by the brain kernel. */
    summaryMd: text('summary_md').notNull(),
    /** Evidence-chain IDs (corpus chunks + research artifacts). */
    evidenceIds: text('evidence_ids').array().notNull().default([]),
    /** Array of proposed-action payloads (kind, payload, citation). */
    actionsProposed: jsonb('actions_proposed').notNull().default([]),
    ownerSeenAt: timestamp('owner_seen_at', { withTimezone: true }),
    ownerActionedAt: timestamp('owner_actioned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantGeneratedIdx: index('master_brain_briefings_tenant_generated_idx').on(
      t.tenantId,
      t.generatedAt,
    ),
    statusIdx: index('master_brain_briefings_status_idx').on(t.tenantId, t.status),
  }),
);

// ============================================================================
// spawn_proposals — Anticipatory UX next-move suggestions
// ============================================================================

export const spawnProposals = pgTable(
  'spawn_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** chat-turn / voice-turn identifier this proposal was derived from. */
    sourceTurnId: text('source_turn_id').notNull(),
    /** site | licence | doc | buyer | parcel | sale | … */
    entityKind: text('entity_kind').notNull(),
    /** Full entity reference + extracted context for the target tab. */
    entityPayload: jsonb('entity_payload').notNull(),
    /** chat-ui route id (mutually exclusive with target_form_id). */
    targetTab: text('target_tab'),
    /** form-engine id (mutually exclusive with target_tab). */
    targetFormId: text('target_form_id'),
    /** Pre-fill payload — accepting becomes one click. */
    prefill: jsonb('prefill').notNull().default({}),
    /** 0.000 .. 1.000 — scoring confidence. */
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    /** proposed | accepted | dismissed | expired. */
    status: text('status').notNull().default('proposed'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    tenantStatusIdx: index('spawn_proposals_tenant_status_created_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    sourceTurnIdx: index('spawn_proposals_source_turn_idx').on(t.sourceTurnId),
    entityKindIdx: index('spawn_proposals_entity_kind_idx').on(t.tenantId, t.entityKind),
  }),
);

// ============================================================================
// passive_capture_events — entity-extraction trace per chat/voice turn
// ============================================================================

export const passiveCaptureEvents = pgTable(
  'passive_capture_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** chat | voice | upload. */
    source: text('source').notNull(),
    /** Array of extracted Entity objects (typed in the extractor). */
    entities: jsonb('entities').notNull(),
    /** FK to spawn_proposals.id (the proposal this capture seeded). */
    draftStateRef: uuid('draft_state_ref').references(() => spawnProposals.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    tenantSessionIdx: index('passive_capture_events_tenant_session_idx').on(
      t.tenantId,
      t.sessionId,
      t.capturedAt,
    ),
    sourceIdx: index('passive_capture_events_source_idx').on(t.tenantId, t.source),
    draftStateIdx: index('passive_capture_events_draft_state_idx').on(t.draftStateRef),
  }),
);

// ============================================================================
// daily_research_cache — per-source rate-limited fetch cache
// ============================================================================

export const dailyResearchCache = pgTable(
  'daily_research_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    fetchedAt: timestamp('fetched_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** lme | kitco | tra | nemc | tumemadini | bot-gold-window | web. */
    source: text('source').notNull(),
    payload: jsonb('payload').notNull(),
    ttlUntil: timestamp('ttl_until', { withTimezone: true }).notNull(),
  },
  (t) => ({
    tenantSourceTtlIdx: index('daily_research_cache_tenant_source_ttl_idx').on(
      t.tenantId,
      t.source,
      t.ttlUntil,
    ),
    fetchedAtIdx: index('daily_research_cache_fetched_at_idx').on(
      t.tenantId,
      t.fetchedAt,
    ),
  }),
);

export type MasterBrainBriefing = typeof masterBrainBriefings.$inferSelect;
export type NewMasterBrainBriefing = typeof masterBrainBriefings.$inferInsert;
export type SpawnProposal = typeof spawnProposals.$inferSelect;
export type NewSpawnProposal = typeof spawnProposals.$inferInsert;
export type PassiveCaptureEvent = typeof passiveCaptureEvents.$inferSelect;
export type NewPassiveCaptureEvent = typeof passiveCaptureEvents.$inferInsert;
export type DailyResearchCache = typeof dailyResearchCache.$inferSelect;
export type NewDailyResearchCache = typeof dailyResearchCache.$inferInsert;
