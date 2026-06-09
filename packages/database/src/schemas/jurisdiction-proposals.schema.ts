/**
 * Jurisdiction-change proposals — durable store for the JC-7 four-eye
 * admin override flow (migration 0322_jurisdiction_proposals.sql).
 *
 * Companion to the `JurisdictionProposalStore` port in
 * `services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts`
 * (createAdminTenantJurisdictionRouter). A tenant CANNOT self-change its
 * jurisdiction (locked at signup, migration 0149); only Borjie internal
 * admin (SUPER_ADMIN / ADMIN / SUPPORT) can re-assign — through a
 * PROPOSE -> APPROVE four-eye flow where the approver is a DIFFERENT
 * admin (per CLAUDE.md inviolable). Each proposed change is one row.
 *
 * Tenant-scoped, RLS (canonical `app.current_tenant_id` GUC +
 * service-role bypass — the admin override adapters run under
 * service-role context per the router doc). NULL-tenant rows are never
 * written. The `status` lifecycle is pending -> approved | rejected; the
 * proposer + decider are both captured so the route enforces four-eye
 * (approver MUST differ from proposer) and the audit chain records BOTH
 * actors.
 */

import {
  pgTable,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// ============================================================================
// jurisdiction_proposals — the per-tenant JC-7 four-eye proposal store.
// ============================================================================

export const jurisdictionProposals = pgTable(
  'jurisdiction_proposals',
  {
    /** Opaque proposal id (PK) minted at PROPOSE time. */
    proposalId: text('proposal_id').notNull().primaryKey(),
    /** The tenant whose jurisdiction is being changed. */
    tenantId: text('tenant_id').notNull(),
    /** ISO-3166 alpha-2 the tenant is moving FROM (captured at propose). */
    fromCountryCode: text('from_country_code').notNull(),
    /** ISO-3166 alpha-2 the tenant is moving TO. */
    toCountryCode: text('to_country_code').notNull(),
    /** Admin-supplied justification (audited). */
    reason: text('reason').notNull(),
    /** Out-of-band verification attestation (phone / ticket / in-person). */
    verifiedWith: text('verified_with').notNull(),
    /** Supabase user id of the proposing admin. */
    proposedByUserId: text('proposed_by_user_id').notNull(),
    proposedAt: timestamp('proposed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** pending | approved | rejected. */
    status: text('status').notNull().default('pending'),
    /** Supabase user id of the deciding admin (four-eye: != proposer). */
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Optional free-form note captured at decision time. */
    decisionNote: text('decision_note'),
  },
  (t) => ({
    /** List-by-tenant is the GET read (pending + history for a tenant). */
    tenantIdx: index('idx_jurisdiction_proposals_tenant').on(t.tenantId),
    /** Pending-first split support for the LIST endpoint. */
    tenantStatusIdx: index('idx_jurisdiction_proposals_tenant_status').on(
      t.tenantId,
      t.status,
    ),
  }),
);

export type JurisdictionProposalRow = typeof jurisdictionProposals.$inferSelect;
export type NewJurisdictionProposalRow =
  typeof jurisdictionProposals.$inferInsert;
