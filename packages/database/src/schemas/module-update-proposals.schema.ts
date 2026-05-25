/**
 * module_update_proposals (migration 0230) — Piece L brain-tab loop.
 *
 * The dispatcher's output: "brain thinks tab X should take action Y
 * with payload Z". HITL-gated when confidence below threshold or when
 * the routing matrix flags the action as high-risk.
 *
 * Tenant-scoped via RLS. Status field carries transitions.
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';
import { conversationCapture } from './conversation-capture.schema.js';

export const moduleUpdateProposals = pgTable(
  'module_update_proposals',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    captureId: text('capture_id')
      .notNull()
      .references(() => conversationCapture.id, { onDelete: 'cascade' }),
    /** Soft FK to modules table from Piece B (claude/piece-b). */
    moduleTemplateId: text('module_template_id').notNull(),
    /** Action name from routing matrix, e.g. 'create_lease_application'. */
    action: text('action').notNull(),
    /** Persona that authored the capture. */
    personaId: text('persona_id').notNull(),
    /**
     * Status: pending_hitl | auto_applying | accepted | declined |
     * edited | expired | failed.
     */
    status: text('status').notNull().default('pending_hitl'),
    /** Inherited capture confidence. */
    confidence: doublePrecision('confidence').notNull(),
    /** Whether HITL is required (matrix flag). */
    hitlRequired: boolean('hitl_required').notNull().default(true),
    /** Priority bucket: critical | high | medium | low. */
    priority: text('priority').notNull().default('medium'),
    /** Candidate action payload — what the handler would execute. */
    payload: jsonb('payload').notNull().default({}),
    /** Resolved canonical entity references (copy from capture). */
    entityRefs: jsonb('entity_refs').notNull().default([]),
    /** Routing matrix row id (FK to default matrix or tenant override). */
    matrixRowId: text('matrix_row_id'),
    /** Persona tier of the approver (1..5). */
    approverTier: integer('approver_tier'),
    /** Approver user id when accepted/declined/edited. */
    approverUserId: text('approver_user_id'),
    /** Decline reason (set when status='declined'). */
    declineReason: text('decline_reason'),
    /** When this proposal supersedes another via edit, link back. */
    editedFromId: text('edited_from_id'),
    /** Failure detail when handler call rejects. */
    failureReason: text('failure_reason'),
    /** When the proposal was acted on. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** TTL — older proposals flip to 'expired' via cron. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('module_update_proposals_tenant_status_idx').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    tenantModuleIdx: index('module_update_proposals_tenant_module_idx').on(
      t.tenantId,
      t.moduleTemplateId,
    ),
    captureIdx: index('module_update_proposals_capture_idx').on(t.captureId),
    tenantPersonaIdx: index('module_update_proposals_tenant_persona_idx').on(
      t.tenantId,
      t.personaId,
    ),
  }),
);

export type ModuleUpdateProposalRow =
  typeof moduleUpdateProposals.$inferSelect;
export type ModuleUpdateProposalInsert =
  typeof moduleUpdateProposals.$inferInsert;
