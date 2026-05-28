/**
 * Undo Journal - Wave SUPERPOWERS (migration 0112).
 *
 * Companion to:
 *   - packages/database/src/migrations/0112_undo_journal.sql
 *   - services/api-gateway/src/routes/owner/undo-journal.hono.ts
 *
 * Generic, transient undo ledger. Every WRITE brain tool appends a
 * row here with `before_state` / `after_state` snapshots so the owner
 * gets a 5-minute "Undo" chip on every chat-initiated write. NOT a
 * replacement for the immutable AI audit chain (which still records
 * the write); this table just stores enough to reverse.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS is enabled per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  integer,
  index,
} from 'drizzle-orm/pg-core';

export const UNDO_ACTION_KINDS = [
  'create',
  'update',
  'delete',
  'snooze',
  'archive',
  'acknowledge',
  'complete',
  'withdraw',
  'pin',
  'unpin',
  'share',
  'revoke_share',
  'prefill',
  'bulk_update',
] as const;
export type UndoActionKind = (typeof UNDO_ACTION_KINDS)[number];

/** Default rolling-window for the undo chip in seconds (5 min). */
export const DEFAULT_UNDO_WINDOW_SECONDS = 300;

export const undoJournal = pgTable(
  'undo_journal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    actorId: text('actor_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    actionKind: text('action_kind').notNull(),
    toolId: text('tool_id'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    windowSeconds: integer('window_seconds')
      .notNull()
      .default(DEFAULT_UNDO_WINDOW_SECONDS),
    performedAt: timestamp('performed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
    undoneById: text('undone_by_id'),
    undoReason: text('undo_reason'),
    provenance: jsonb('provenance').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    actorRecentIdx: index('undo_journal_actor_recent_idx').on(
      table.tenantId,
      table.actorId,
      table.performedAt,
    ),
    entityRecentIdx: index('undo_journal_entity_recent_idx').on(
      table.tenantId,
      table.entityType,
      table.entityId,
      table.performedAt,
    ),
    windowIdx: index('undo_journal_window_idx').on(
      table.tenantId,
      table.performedAt,
    ),
  }),
);

export type UndoJournalEntry = typeof undoJournal.$inferSelect;
export type NewUndoJournalEntry = typeof undoJournal.$inferInsert;
