/**
 * Four-Eye Approval Requests — Wave FOUR-EYE-APPROVAL.
 *
 * Companion to:
 *   - packages/database/src/migrations/0099_four_eye_requests.sql
 *   - services/api-gateway/src/routes/owner/four-eye-approvals.hono.ts
 *
 * Every high-stakes owner action (payment > 5M TZS, regulator filing,
 * contract signature, asset disposition, workforce termination) is
 * gated through a tokenised second-approver flow. The token is
 * stored hashed and bound to the requesting tenant; the approver
 * resolves the token via a public endpoint that requires a fresh
 * Supabase session before flipping status.
 *
 * Tenant-scoped via the canonical `app.tenant_id` GUC RLS policy.
 * FORCE RLS is enabled on the table per CLAUDE.md hard rule.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const FOUR_EYE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'executed',
] as const;
export type FourEyeStatus = (typeof FOUR_EYE_STATUSES)[number];

export const FOUR_EYE_ACTION_TYPES = [
  'payment',
  'regulator_filing',
  'contract_signature',
  'asset_disposition',
  'workforce_termination',
  'other',
] as const;
export type FourEyeActionType = (typeof FOUR_EYE_ACTION_TYPES)[number];

export const fourEyeRequests = pgTable(
  'four_eye_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    requesterId: text('requester_id').notNull(),
    secondApproverId: text('second_approver_id'),
    actionType: text('action_type').notNull(),
    payload: jsonb('payload').notNull(),
    approvalToken: text('approval_token').notNull(),
    status: text('status').notNull().default('pending'),
    decisionNote: text('decision_note'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    executionResult: jsonb('execution_result'),
    auditCreateId: uuid('audit_create_id'),
    auditDecideId: uuid('audit_decide_id'),
    auditExecuteId: uuid('audit_execute_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tokenUniq: uniqueIndex('four_eye_requests_token_uniq').on(
      table.approvalToken,
    ),
    tenantIdx: index('four_eye_requests_tenant_idx').on(
      table.tenantId,
      table.status,
      table.expiresAt,
    ),
    requesterIdx: index('four_eye_requests_requester_idx').on(
      table.tenantId,
      table.requesterId,
      table.createdAt,
    ),
  }),
);

export type FourEyeRequestRow = typeof fourEyeRequests.$inferSelect;
export type NewFourEyeRequestRow = typeof fourEyeRequests.$inferInsert;
