/**
 * sovereign_approvals — four-eye approval gate for sovereign-tier
 * write actions proposed by the Nyumba Mind brain kernel.
 *
 * Each row is a ProposedAction + the audit trail of approval
 * signatures. The kernel's ApprovalGate is storage-agnostic; this is
 * the production adapter.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

export const sovereignApprovalStatusEnum = pgEnum('sovereign_approval_status', [
  'pending',
  'one-eye',
  'approved',
  'rejected',
  'expired',
]);

export const sovereignApprovalStakesEnum = pgEnum('sovereign_approval_stakes', [
  'medium',
  'high',
  'critical',
]);

export const sovereignApprovals = pgTable(
  'sovereign_approvals',
  {
    actionId: text('action_id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    proposerUserId: text('proposer_user_id').notNull(),
    thoughtId: text('thought_id').notNull(),
    summary: text('summary').notNull(),
    toolName: text('tool_name').notNull(),
    payload: jsonb('payload').notNull().default({}),
    stakes: sovereignApprovalStakesEnum('stakes').notNull(),
    status: sovereignApprovalStatusEnum('status').notNull(),
    signatures: jsonb('signatures').notNull().default([]),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('idx_sovereign_approvals_tenant_status').on(
      t.tenantId,
      t.status,
    ),
    proposerIdx: index('idx_sovereign_approvals_proposer').on(t.proposerUserId),
    expiresIdx: index('idx_sovereign_approvals_expires').on(t.expiresAt),
  }),
);
