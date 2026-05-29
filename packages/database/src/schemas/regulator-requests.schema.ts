/**
 * regulator_requests — regulator-originated request inbox.
 *
 * Companion to:
 *   - packages/database/src/migrations/0135_regulator_requests.sql
 *   - services/api-gateway/src/routes/regulator/requests.hono.ts
 *   - services/api-gateway/src/services/regulator/request-service.ts
 *
 * One row per inbound request from PCCB / NEMC / EITI / TMAA. The
 * state machine is enforced both at the SQL CHECK level and (more
 * tightly) by the `RegulatorRequestService` — see
 * Docs/RESEARCH/REGULATOR_SOTA_2026-05-29.md §1 §5.
 *
 * Tenant scope: enforced via PostgreSQL RLS (FORCE) using
 * `app.current_tenant_id`. The Drizzle layer NEVER bypasses RLS —
 * every query inherits the tenant GUC bound by api-gateway middleware.
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  bigint,
  index,
} from 'drizzle-orm/pg-core';

// ----------------------------------------------------------------------------
// Enum-style string-literal unions (kept in lockstep with SQL CHECK
// constraints; native PG enums avoided to keep migrations forward-only).
// ----------------------------------------------------------------------------

export const REGULATOR_KINDS = [
  'pccb',
  'nemc',
  'eiti',
  'tmaa',
  'other',
] as const;
export type RegulatorKind = (typeof REGULATOR_KINDS)[number];

export const REGULATOR_REQUEST_SUBJECT_KINDS = [
  'worker',
  'site',
  'licence',
  'tenant',
  'company',
  'shipment',
] as const;
export type RegulatorRequestSubjectKind =
  (typeof REGULATOR_REQUEST_SUBJECT_KINDS)[number];

export const REGULATOR_REQUEST_STATUSES = [
  'received',
  'parsed',
  'owner_review',
  'disclosure_approved',
  'exporting',
  'exported',
  'delivered',
  'rejected',
  'expired',
] as const;
export type RegulatorRequestStatus =
  (typeof REGULATOR_REQUEST_STATUSES)[number];

// ----------------------------------------------------------------------------
// Table
// ----------------------------------------------------------------------------

export const regulatorRequests = pgTable(
  'regulator_requests',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** pccb | nemc | eiti | tmaa | other. */
    regulator: text('regulator').notNull(),
    /** Reference no. assigned by the regulator (optional on receipt). */
    regulatorRef: text('regulator_ref'),
    /** worker | site | licence | tenant | company | shipment. */
    subjectKind: text('subject_kind').notNull(),
    /** Subject identifier — usually the row id of the matching table. */
    subjectRef: text('subject_ref').notNull(),
    /** State-machine status — see migration 0135 for transitions. */
    status: text('status').notNull().default('received'),
    summarySw: text('summary_sw'),
    summaryEn: text('summary_en'),
    /** Owner-approved scope JSON. */
    approvedScope: jsonb('approved_scope').notNull().default({}),
    rawRequest: text('raw_request'),
    /** Signed URL — short-TTL; callers may refresh. */
    responseDocUrl: text('response_doc_url'),
    responseDocKey: text('response_doc_key'),
    responseDocSha256: text('response_doc_sha256'),
    /** ai_audit_chain.sequenceNumber — anchored on first WRITE. */
    auditChainSeq: bigint('audit_chain_seq', { mode: 'number' }),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** SLA — 30d PDPC default; tighter for NEMC. */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    ownerReviewedAt: timestamp('owner_reviewed_at', { withTimezone: true }),
    ownerReviewedBy: text('owner_reviewed_by'),
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('regulator_requests_tenant_idx').on(
      t.tenantId,
      t.requestedAt,
    ),
    statusIdx: index('regulator_requests_status_idx').on(t.tenantId, t.status),
    regulatorIdx: index('regulator_requests_regulator_idx').on(
      t.tenantId,
      t.regulator,
      t.requestedAt,
    ),
    dueIdx: index('regulator_requests_due_idx').on(t.tenantId, t.dueAt),
  }),
);

// ----------------------------------------------------------------------------
// Type re-exports
// ----------------------------------------------------------------------------

export type RegulatorRequestRow = typeof regulatorRequests.$inferSelect;
export type NewRegulatorRequestRow = typeof regulatorRequests.$inferInsert;
