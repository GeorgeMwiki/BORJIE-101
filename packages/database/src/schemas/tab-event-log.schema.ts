/**
 * tab_event_log (migration 0232) — Piece L brain-tab loop event log.
 *
 * Append-only audit of every state transition a proposal undergoes.
 * Pairs with `ai_audit_chain` (which hash-chains AI turns) on the
 * tab side: an auditor can reconstruct the full brain↔tab handshake
 * from either side.
 *
 * Event kinds:
 *   capture_emitted | proposal_created | proposal_auto_applied |
 *   proposal_pending_hitl | proposal_approved | proposal_declined |
 *   proposal_edited | proposal_expired | proposal_failed |
 *   proactive_nudge
 *
 * Tenant-scoped via RLS.
 */

import {
  pgTable,
  text,
  bigint,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const tabEventLog = pgTable(
  'tab_event_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Capture row this event chains back to. NULL only for out-of-band
     *  proactive nudges that didn't originate in a capture. */
    captureId: text('capture_id'),
    /** Proposal id when the event is proposal-level. */
    proposalId: text('proposal_id'),
    /** Soft FK to modules (Piece B). */
    moduleTemplateId: text('module_template_id'),
    /** Persona that authored. */
    personaId: text('persona_id').notNull(),
    /** Event kind — see header comment. */
    eventKind: text('event_kind').notNull(),
    /** Actor: 'system' | 'user:<user_id>' | 'cron'. */
    actor: text('actor').notNull(),
    /** Transport: 'chat' | 'api' | 'realtime' | 'cron'. */
    transport: text('transport').notNull().default('api'),
    /** Snapshot of proposal state at this moment. */
    snapshot: jsonb('snapshot').notNull().default({}),
    /** Notes from actor (decline reason, edit summary). */
    notes: text('notes'),
    /** Sequence within a proposal_id timeline. */
    sequence: bigint('sequence', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('tab_event_log_tenant_created_idx').on(
      t.tenantId,
      t.createdAt,
    ),
    proposalIdx: index('tab_event_log_proposal_idx').on(
      t.proposalId,
      t.sequence,
    ),
    kindIdx: index('tab_event_log_kind_idx').on(t.tenantId, t.eventKind),
    captureIdx: index('tab_event_log_capture_idx').on(t.captureId),
  }),
);

export type TabEventLogRow = typeof tabEventLog.$inferSelect;
export type TabEventLogInsert = typeof tabEventLog.$inferInsert;
