/**
 * Admin Superpower Pending Approvals — four-eye gate (migration 0278).
 *
 * Ported from the BossNyumba admin-superpowers stack (BN migration 0301),
 * retargeted real-estate → mining. Holds the PENDING half of the two-phase
 * admin superpower ledger so the generic propose → approve → reject →
 * list_pending bulk-action queue has a dedicated, queryable home (the
 * pre-existing Borjie path only stamped `provenance.requires_four_eye` on
 * `undo_journal`, with no reject / list-pending surface and no same-actor
 * CHECK constraint).
 *
 *   Phase 1 (POST /admin/superpowers/bulk-action with a HIGH verb):
 *     Insert one row PER (target licence-holder / target entity) with
 *     status='pending'. The proposing admin's actor_id is pinned. No
 *     side effects fire yet.
 *
 *   Phase 2 (POST /admin/superpowers/approve/:journalId):
 *     A SECOND distinct admin actor approves. The row transitions to
 *     status='applied' and the approving actor_id is pinned. Approval is
 *     REJECTED if the approver is the same actor as the proposer
 *     (FOUR_EYE_SAME_ACTOR error). The DB CHECK constraint
 *     `admin_four_eye_distinct_actors_chk` is the canonical safety net;
 *     the route handler enforces it earlier with a structured 409.
 *
 * HIGH-risk admin verbs (require four-eye), mining-retargeted:
 *   - suspend_licence_holder              — soft-suspend a licence holder
 *   - reactivate_licence_holder           — reverse a prior suspension
 *   - export_regulator_pack               — full regulator dump (PCCB)
 *   - force_supply_agreement_termination  — admin override of an agreement
 *   - force_password_reset                — operator-initiated reset
 *   - bulk_archive_inspection_cases (>50) — mass archive of inspections
 *
 * MEDIUM-risk admin verbs (audit-logged, single actor sufficient):
 *   - bulk_send_announcement              — broadcast to operators
 *   - bulk_archive_old_royalty_invoices   — housekeeping
 *   - bulk_re_tag_sites                   — taxonomy reorg
 *
 * The MEDIUM verbs DO NOT use this table; they append directly to
 * `undo_journal` with provenance.status='applied'.
 *
 * RLS: tenant-scoped FORCE RLS on the canonical `app.current_tenant_id`
 * GUC (the GUC the api-gateway databaseMiddleware binds). The proposing
 * admin's tenant scope owns the row; the approving admin acts from the
 * same admin tenant scope. NEVER the legacy `app.tenant_id`.
 *
 * Companion files:
 *   - packages/database/src/migrations/0278_admin_four_eye_pending.sql
 *   - services/api-gateway/src/routes/admin/superpowers.hono.ts
 *   - services/api-gateway/src/composition/brain-tools/
 *     admin-superpowers-tools.ts
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';

/**
 * Admin HIGH-risk verbs that require four-eye approval. These verbs
 * land as pending rows; the second admin's POST
 * /admin/superpowers/approve/:journalId fires the actual mutation.
 */
export const ADMIN_HIGH_RISK_ACTIONS = [
  'suspend_licence_holder',
  'reactivate_licence_holder',
  'export_regulator_pack',
  'force_supply_agreement_termination',
  'force_password_reset',
  'bulk_archive_inspection_cases',
] as const;
export type AdminHighRiskAction = (typeof ADMIN_HIGH_RISK_ACTIONS)[number];

/**
 * Admin MEDIUM-risk verbs that audit-log but do NOT require four-eye.
 * These verbs append directly to undo_journal with status='applied'
 * and bypass this table entirely.
 */
export const ADMIN_MEDIUM_RISK_ACTIONS = [
  'bulk_send_announcement',
  'bulk_archive_old_royalty_invoices',
  'bulk_re_tag_sites',
] as const;
export type AdminMediumRiskAction = (typeof ADMIN_MEDIUM_RISK_ACTIONS)[number];

export type AdminSuperpowerAction =
  | AdminHighRiskAction
  | AdminMediumRiskAction;

export const ADMIN_ALL_ACTIONS: ReadonlyArray<AdminSuperpowerAction> = [
  ...ADMIN_HIGH_RISK_ACTIONS,
  ...ADMIN_MEDIUM_RISK_ACTIONS,
];

/** Threshold above which bulk_archive_inspection_cases is HIGH-risk. */
export const ADMIN_BULK_ARCHIVE_HIGH_THRESHOLD = 50;

export const ADMIN_PENDING_STATUSES = [
  'pending',
  'applied',
  'rejected',
  'expired',
] as const;
export type AdminPendingStatus = (typeof ADMIN_PENDING_STATUSES)[number];

/**
 * Entity types an admin bulk verb can target (mining-retargeted). The
 * per-entity verb whitelist lives in the route's zod schema; this enum
 * is the column-level contract shared by the schema, route, and tools.
 */
export const ADMIN_QUEUE_ENTITY_TYPES = [
  'licence_holder',
  'supply_agreement',
  'user',
  'inspection_case',
  'royalty_invoice',
  'site',
  'announcement_target',
] as const;
export type AdminQueueEntityType =
  (typeof ADMIN_QUEUE_ENTITY_TYPES)[number];

export const adminSuperpowerPendingApprovals = pgTable(
  'admin_superpower_pending_approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    journalId: uuid('journal_id').notNull(),
    /**
     * Tenant scope that owns the pending row — the proposing admin's
     * tenant. The canonical `app.current_tenant_id` RLS policy gates
     * visibility on THIS column.
     */
    proposedByTenantId: text('proposed_by_tenant_id').notNull(),
    /**
     * Target licence-holder (or other tenant) the proposed action acts
     * on. NULL for cross-tenant actions like bulk_send_announcement.
     */
    targetTenantId: text('target_tenant_id'),
    /** Free-form descriptor, e.g. 'licence_holder:lh-acme'. */
    targetEntityRef: text('target_entity_ref').notNull(),
    action: text('action').notNull(),
    payload: jsonb('payload').notNull().default({}),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('pending'),
    proposedByActorId: text('proposed_by_actor_id').notNull(),
    proposedByRole: text('proposed_by_role').notNull(),
    approvedByActorId: text('approved_by_actor_id'),
    approvedByRole: text('approved_by_role'),
    approverNote: text('approver_note'),
    rejectedByActorId: text('rejected_by_actor_id'),
    rejectedByRole: text('rejected_by_role'),
    rejectionReason: text('rejection_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    auditChainIds: jsonb('audit_chain_ids').notNull().default([]),
  },
  (t) => ({
    tenantStatusCreatedIdx: index('admin_four_eye_tenant_status_created_idx').on(
      t.proposedByTenantId,
      t.status,
      t.createdAt,
    ),
    journalIdx: index('admin_four_eye_journal_idx').on(t.journalId),
    expiresIdx: index('admin_four_eye_expires_idx').on(t.expiresAt),
  }),
);

export type AdminPendingApprovalRow =
  typeof adminSuperpowerPendingApprovals.$inferSelect;
export type AdminPendingApprovalInsert =
  typeof adminSuperpowerPendingApprovals.$inferInsert;
