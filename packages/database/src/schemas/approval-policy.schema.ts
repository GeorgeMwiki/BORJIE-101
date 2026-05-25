/**
 * Approval Policy Schema
 *
 * Two tables, two distinct surfaces:
 *
 *   `approval_policies` — the original business-action overrides table
 *     (maintenance_cost, refund, discount, lease_exception, payment_flexibility).
 *     Composite primary key (tenantId, type). Defaults live in
 *     `services/domain-services/src/approvals/default-policies.ts` and remain
 *     the source-of-truth floor.
 *
 *   `approval_policy_actions` — K5 parity addition (migration 0128). Declarative
 *     policy for SOVEREIGN-tier kernel tool actions (eviction.propose,
 *     owner_payout.disburse, kra.file_mri_return, etc.). Carries role-group
 *     quorum, max-stale-minutes, recall-window, and re-auth requirements.
 *     NULL `tenant_id` rows are platform defaults; per-tenant rows override.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';
import { tenants } from './tenant.schema.js';

export const approvalPolicies = pgTable(
  'approval_policies',
  {
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // One of: 'maintenance_cost' | 'refund' | 'discount' | 'lease_exception' | 'payment_flexibility'
    type: text('type').notNull(),
    // Full ApprovalPolicy shape (thresholds, autoApproveRules, approvalChain,
    // defaultTimeoutHours, autoEscalateToRole) serialized as JSON.
    policyJson: jsonb('policy_json').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.type] }),
    tenantIdx: index('approval_policies_tenant_idx').on(table.tenantId),
  })
);

export const approvalPoliciesRelations = relations(approvalPolicies, ({ one }) => ({
  tenant: one(tenants, {
    fields: [approvalPolicies.tenantId],
    references: [tenants.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────
// K5 parity — sovereign-action approval policy table (migration 0128).
//
// JSON shape of `roleGroups`:
//   [
//     { "name": "compliance",      "minApprovers": 1 },
//     { "name": "ops",             "minApprovers": 1 },
//     { "name": "owner-relations", "minApprovers": 1 }
//   ]
//
// Service-layer invariant: SUM(roleGroups[*].minApprovers) === minTotalApprovers.
// ─────────────────────────────────────────────────────────────────────

export interface ApprovalPolicyRoleGroup {
  readonly name: string;
  readonly minApprovers: number;
}

export const approvalPolicyActions = pgTable(
  'approval_policy_actions',
  {
    id: text('id').primaryKey(),
    /**
     * NULL = platform-wide default. Per-tenant rows of the same `actionType`
     * override the platform default in the service-layer resolver.
     */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** Kernel `tool_name` this policy governs. */
    actionType: text('action_type').notNull(),
    /** Sum of roleGroups[*].minApprovers — bounded 1..5. */
    minTotalApprovers: integer('min_total_approvers').notNull(),
    /** JSONB array of ApprovalPolicyRoleGroup. */
    roleGroups: jsonb('role_groups')
      .notNull()
      .$type<ReadonlyArray<ApprovalPolicyRoleGroup>>()
      .default(sql`'[]'::jsonb`),
    /** Stale-window in minutes (LITFIN autoRejectAfterHours analogue). */
    maxStaleMinutes: integer('max_stale_minutes').notNull().default(1440),
    /** Recall window in minutes; zero = not recallable. */
    recallWindowMinutes: integer('recall_window_minutes').notNull().default(0),
    /** Whether approvers must re-authenticate before signing. */
    reAuthRequired: boolean('re_auth_required').notNull().default(false),
    /** Max age in seconds for the re-auth proof carried alongside `sign()`. */
    reAuthMaxAgeSeconds: integer('re_auth_max_age_seconds').notNull().default(300),
    /** When TRUE the proposer can count as one of the approvers. */
    allowProposerSignature: boolean('allow_proposer_signature')
      .notNull()
      .default(false),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text('updated_by'),
  },
  (t) => ({
    uniqTenantAction: uniqueIndex('uq_approval_policy_actions_tenant_action').on(
      t.tenantId,
      t.actionType,
    ),
    actionIdx: index('idx_approval_policy_actions_action').on(t.actionType),
    tenantIdx: index('idx_approval_policy_actions_tenant').on(t.tenantId),
    minTotalCheck: check(
      'approval_policy_actions_min_total_chk',
      sql`${t.minTotalApprovers} >= 1 AND ${t.minTotalApprovers} <= 5`,
    ),
    maxStaleCheck: check(
      'approval_policy_actions_max_stale_chk',
      sql`${t.maxStaleMinutes} > 0`,
    ),
    recallCheck: check(
      'approval_policy_actions_recall_chk',
      sql`${t.recallWindowMinutes} >= 0`,
    ),
    reAuthAgeCheck: check(
      'approval_policy_actions_re_auth_age_chk',
      sql`${t.reAuthMaxAgeSeconds} > 0`,
    ),
  }),
);

export const approvalPolicyActionsRelations = relations(
  approvalPolicyActions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [approvalPolicyActions.tenantId],
      references: [tenants.id],
    }),
  }),
);
