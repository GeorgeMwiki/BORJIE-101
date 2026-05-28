/**
 * UI Redesign Audit — Wave BRAIN-UI-CONTROL.
 *
 * Companion to:
 *   - packages/database/src/migrations/0097_brain_ui_control.sql
 *   - services/api-gateway/src/services/ui-redesign/audit-chain.ts
 *
 * Hash-chained append-only audit of every brain redesign proposal +
 * owner Accept / Reject. Mirrors the ai_audit_chain pattern (CLAUDE.md
 * hard rule: hash-chained, append-only, no mutation). Tenant-scoped via
 * `app.tenant_id` GUC RLS. FORCE RLS per CLAUDE.md.
 */

import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const uiRedesignAudit = pgTable('ui_redesign_audit', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: text('tenant_id').notNull(),
  /** Supabase user id of the owner. */
  userId: text('user_id').notNull(),
  /** tab_redesign | dashboard_compose | nav_rearrange. */
  kind: text('kind').notNull(),
  /** proposed | accepted | rejected | expired. */
  stage: text('stage').notNull(),
  /** Full validated brain payload. */
  payload: jsonb('payload').notNull().default({}),
  /** Brain's plain-text rationale. */
  reason: text('reason'),
  /** Optional ttl in seconds (tab_redesign only). */
  ttlSeconds: integer('ttl_seconds'),
  /** Optional client session id for correlation. */
  sessionId: text('session_id'),
  /** Optional reference to a chat message that triggered this row. */
  messageId: text('message_id'),
  /** SHA-256 hex of the previous row's hash + this row's canonical
   *  payload. Chain head carries the literal 'GENESIS'. */
  prevHash: text('prev_hash').notNull(),
  /** SHA-256 hex of this row's canonical content. */
  rowHash: text('row_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type UiRedesignAuditRow = typeof uiRedesignAudit.$inferSelect;
export type UiRedesignAuditInsert = typeof uiRedesignAudit.$inferInsert;
