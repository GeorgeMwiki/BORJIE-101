/**
 * Manager Dispatch — Escalations + Approval Queue.
 *
 * Per `Docs/research/manager-dispatch-sota.md` §9. Two domain tables that
 * carry the manager-dispatch UX:
 *
 *   - `miningEscalations`   — directed escalation chain (worker ->
 *                             manager -> owner) with severity-tiered
 *                             status (info / warning / critical).
 *
 *   - `miningApprovalItems` — unified Linear-Triage-style approval
 *                             queue across leave / advance / reassign /
 *                             fuel / expense / other request kinds.
 *
 * Both tables are tenant-scoped via the `app.tenant_id` GUC RLS pattern
 * (FORCE-enabled in migration 0081). The api-gateway routers operate
 * on these tables through the tenant-scoped db client; no app-level
 * filtering on `tenant_id` is needed but the routers add it defensively.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { provenanceColumn } from '../helpers/provenance-column.js';

// ============================================================================
// mining_escalations — manager-up + worker-up escalation chain
// ============================================================================

export const miningEscalations = pgTable(
  'mining_escalations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** RLS-scoping column. */
    tenantId: text('tenant_id').notNull(),
    /** User who raised the escalation. */
    raisedByUserId: text('raised_by_user_id').notNull(),
    /** Specific addressee (null when broadcast to a role). */
    toUserId: text('to_user_id'),
    /** Role-wide broadcast (manager|owner|safety_officer|...). */
    toRole: text('to_role'),
    /** incident|task|crew|production|safety. */
    sourceKind: text('source_kind').notNull(),
    /** Originating domain object id when known. */
    sourceId: text('source_id'),
    /** Swahili-first narrative (English may follow). */
    contextSw: text('context_sw').notNull(),
    /** info|warning|critical. */
    severity: text('severity').notNull().default('warning'),
    /** open|acknowledged|resolved. */
    status: text('status').notNull().default('open'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hash-chained audit-trail link (audit-trail package writes this on transition). */
    hashChainId: text('hash_chain_id'),
    /** Chat-as-OS bidirectional parity. See migration 0101. */
    provenance: provenanceColumn(),
  },
  (t) => ({
    tenantStatusCreatedIdx: index('idx_mining_escalations_tenant_status_created').on(
      t.tenantId,
      t.status,
      t.createdAt,
    ),
    tenantToUserIdx: index('idx_mining_escalations_tenant_to_user').on(
      t.tenantId,
      t.toUserId,
      t.status,
    ),
    tenantRaisedByIdx: index('idx_mining_escalations_tenant_raised_by').on(
      t.tenantId,
      t.raisedByUserId,
      t.status,
    ),
    tenantToRoleIdx: index('idx_mining_escalations_tenant_to_role').on(
      t.tenantId,
      t.toRole,
      t.status,
    ),
  }),
);

export type MiningEscalation = typeof miningEscalations.$inferSelect;
export type NewMiningEscalation = typeof miningEscalations.$inferInsert;

// ============================================================================
// mining_approval_items — unified Linear-Triage approval queue
// ============================================================================

export const miningApprovalItems = pgTable(
  'mining_approval_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    /** Approver (manager / owner / safety officer). */
    approverUserId: text('approver_user_id').notNull(),
    /** leave|advance|reassign|fuel|expense|other. */
    requestKind: text('request_kind').notNull(),
    /** Free-form structured payload. */
    requestPayload: jsonb('request_payload').notNull().default({}),
    /** User who submitted the request. */
    requestedByUserId: text('requested_by_user_id').notNull(),
    /** pending|approved|rejected|deferred|expired. */
    status: text('status').notNull().default('pending'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Mandatory on reject; optional on approve / defer. */
    decisionReason: text('decision_reason'),
    /** Auto-expiry timestamp (defer-24h, defer-week, ...). */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    hashChainId: text('hash_chain_id'),
    /** Chat-as-OS bidirectional parity. See migration 0101. */
    provenance: provenanceColumn(),
  },
  (t) => ({
    tenantStatusCreatedIdx: index(
      'idx_mining_approval_items_tenant_status_created',
    ).on(t.tenantId, t.status, t.createdAt),
    tenantApproverIdx: index('idx_mining_approval_items_tenant_approver').on(
      t.tenantId,
      t.approverUserId,
      t.status,
    ),
    tenantRequestedByIdx: index(
      'idx_mining_approval_items_tenant_requested_by',
    ).on(t.tenantId, t.requestedByUserId, t.status),
  }),
);

export type MiningApprovalItem = typeof miningApprovalItems.$inferSelect;
export type NewMiningApprovalItem = typeof miningApprovalItems.$inferInsert;
