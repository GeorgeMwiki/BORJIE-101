/**
 * Mining-domain worker tasks + pre-shift toolbox talks.
 *
 * Backing migration: `0080_mining_tasks_toolbox.sql`.
 *
 * Two tenant-scoped tables consumed by the workforce mobile home-screen
 * task queue and the pre-shift safety briefing flow (see
 * `Docs/research/worker-guidance-sota.md` §9 — "New endpoints required").
 *
 *   miningTasks         — manager-assigned units of work. Lifecycle:
 *                          pending → in_progress → done | blocked | cancelled.
 *                          Bilingual title/description (sw required, en optional)
 *                          per the CLAUDE.md "Swahili-first" hard rule.
 *
 *   miningToolboxTalks  — one row per (site, scheduled_for) briefing.
 *                          `acknowledgedByUserIds` accumulates the worker
 *                          user ids that have signed off the briefing.
 *
 * Both tables are RLS FORCE-enabled in the migration. The api-gateway
 * database middleware sets `app.current_tenant_id` on every authenticated
 * request — DO NOT double-filter from app code (per CLAUDE.md).
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  date,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { provenanceColumn } from '../helpers/provenance-column.js';

// ============================================================================
// mining_tasks — worker task queue + manager assignment substrate
// ============================================================================

export const miningTasks = pgTable(
  'mining_tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    /** Optional — cross-site tasks (e.g. parts pickup at HQ) leave this NULL. */
    siteId: uuid('site_id'),
    /** Worker the task is delegated to. NULL = unassigned (manager queue). */
    assignedToUserId: uuid('assigned_to_user_id'),
    /** Manager who created the task. NULL only for system-generated tasks. */
    assignedByUserId: uuid('assigned_by_user_id'),
    /** Bilingual title — Swahili required, English optional. */
    titleSw: text('title_sw').notNull(),
    titleEn: text('title_en'),
    descriptionSw: text('description_sw'),
    descriptionEn: text('description_en'),
    /** low | normal | high | urgent. */
    priority: text('priority').notNull().default('normal'),
    /** pending | in_progress | done | blocked | cancelled. */
    status: text('status').notNull().default('pending'),
    /** Self-FK — task chains (this task must complete before that one). */
    sequencedAfterTaskId: uuid('sequenced_after_task_id').references(
      (): AnyPgColumn => miningTasks.id,
      { onDelete: 'set null' },
    ),
    dueAt: timestamp('due_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    blockedReason: text('blocked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Pointer into ai_audit_chain for forensic replay (hash-chained audit). */
    hashChainId: uuid('hash_chain_id'),
    /** Chat-as-OS bidirectional parity. See migration 0101. */
    provenance: provenanceColumn(),
    /**
     * Task kind. `rfb_fulfill` tasks were dispatched by an owner from a
     * buyer's RFB; the worker fulfilment flow joins back to the buyer
     * notification + settlement orchestrator via `parentRfbId`. See
     * migration 0131.
     */
    kind: text('kind').notNull().default('standard'),
    /**
     * When `kind='rfb_fulfill'`, points back to the originating
     * `request_for_bids` row. NULL for standard / inspection /
     * maintenance kinds.
     */
    parentRfbId: uuid('parent_rfb_id'),
  },
  (t) => ({
    tenantAssigneeStatusIdx: index('idx_mining_tasks_tenant_assignee_status').on(
      t.tenantId,
      t.assignedToUserId,
      t.status,
    ),
    tenantSiteStatusIdx: index('idx_mining_tasks_tenant_site_status').on(
      t.tenantId,
      t.siteId,
      t.status,
    ),
    tenantCreatedIdx: index('idx_mining_tasks_tenant_created').on(
      t.tenantId,
      t.createdAt,
    ),
  }),
);

// ============================================================================
// mining_toolbox_talks — pre-shift safety briefings (digital sign-off)
// ============================================================================

export const miningToolboxTalks = pgTable(
  'mining_toolbox_talks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    siteId: uuid('site_id').notNull(),
    topicSw: text('topic_sw').notNull(),
    topicEn: text('topic_en'),
    scheduledFor: date('scheduled_for').notNull(),
    ledByUserId: uuid('led_by_user_id'),
    /** Array of worker user_ids that have signed off the briefing. */
    acknowledgedByUserIds: jsonb('acknowledged_by_user_ids')
      .$type<string[]>()
      .notNull()
      .default([]),
    briefingNotesSw: text('briefing_notes_sw'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantSiteDateIdx: index('idx_mining_toolbox_talks_tenant_site_date').on(
      t.tenantId,
      t.siteId,
      t.scheduledFor,
    ),
    tenantDateIdx: index('idx_mining_toolbox_talks_tenant_date').on(
      t.tenantId,
      t.scheduledFor,
    ),
  }),
);

export type MiningTask = typeof miningTasks.$inferSelect;
export type MiningTaskInsert = typeof miningTasks.$inferInsert;
export type MiningToolboxTalk = typeof miningToolboxTalks.$inferSelect;
export type MiningToolboxTalkInsert = typeof miningToolboxTalks.$inferInsert;
