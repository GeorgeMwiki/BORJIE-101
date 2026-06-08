/**
 * Break-glass operator-access spine (INV-A / FIRE-1, FIRE-2).
 *
 * INV-A (admin/owner control-plane vs data-plane wall) mandates that Borjie
 * staff support access to a tenant's business data is BREAK-GLASS ONLY:
 * explicit request + tenant CONSENT + TIME-BOXED grant + every access
 * hash-chain AUDITED + tenant-VISIBLE. These two tables are the durable
 * backing for that spine (migration 0318).
 *
 *   - operator_access_grants — the consent + time-box record. Default DENY:
 *     a request lands `pending`; the owning tenant must CONSENT to flip it
 *     `active`; it carries a machine-readable justification code (mirrors
 *     Google Key Access Justifications), is scoped to ONE tenant + a closed
 *     scope list, and self-expires at `expiresAt`.
 *   - operator_access_log — append-only, SHA-256 hash-chained
 *     Access-Transparency record of every business-data access under an
 *     active grant. `seq` is monotonic per tenant; `prevHash` → `thisHash`
 *     chains the tenant's records so any mutation breaks verify().
 *
 * Security model (CLAUDE.md hard rule): tenant-VISIBLE governance records
 * (not opaque platform metadata). Migration 0318 FORCE-enables RLS with a
 * tenant-isolation policy on the canonical `app.current_tenant_id` GUC (bare
 * compare, no cast; NEVER the legacy `app.tenant_id`) so owner-web reads its
 * OWN grants + log, PLUS a service-role bypass so the platform break-glass
 * middleware (withServiceRoleContext) creates requests + appends log rows.
 *
 * Companion files:
 *   - migration 0318_break_glass_operator_access.sql
 *   - services/api-gateway/src/break-glass/operator-access-store.ts
 *   - services/api-gateway/src/middleware/break-glass.ts
 */

import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── operator_access_grants ─────────────────────────────────────────────────

export const operatorAccessGrants = pgTable(
  'operator_access_grants',
  {
    /** Grant id (`grant_…`). */
    id: text('id').primaryKey(),
    /** The single tenant this grant is scoped to — drives RLS isolation. */
    tenantId: text('tenant_id').notNull(),
    /** Requesting Borjie staff principal (userId from the platform JWT). */
    operatorId: text('operator_id').notNull(),
    /** Operator email at request time (audit convenience; nullable). */
    operatorEmail: text('operator_email'),
    /**
     * Machine-readable justification class (mirrors Google KAJ). The tenant
     * can auto-deny justification classes. e.g. `incident_response`,
     * `support_request`, `legal_hold`, `rtbf_execution`.
     */
    justificationCode: text('justification_code').notNull(),
    /** Human-readable reason (ticket id, incident ref, free text). */
    reason: text('reason').notNull(),
    /** Closed list of business-data scopes this grant unlocks. */
    scopes: jsonb('scopes').notNull().default([]),
    /** pending | active | expired | revoked | denied. Default-DENY = pending. */
    status: text('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When the tenant CONSENTED (null until active). */
    consentedAt: timestamp('consented_at', { withTimezone: true }),
    /** The tenant principal (owner user id) who consented. */
    consentedBy: text('consented_by'),
    /** Hard time-box — the grant is unusable after this instant. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('idx_operator_access_grants_tenant').on(
      t.tenantId,
      t.requestedAt,
    ),
    operatorIdx: index('idx_operator_access_grants_operator').on(
      t.operatorId,
      t.requestedAt,
    ),
    activeIdx: index('idx_operator_access_grants_active').on(
      t.tenantId,
      t.operatorId,
      t.status,
      t.expiresAt,
    ),
  }),
);

export type OperatorAccessGrantRow = typeof operatorAccessGrants.$inferSelect;
export type NewOperatorAccessGrantRow =
  typeof operatorAccessGrants.$inferInsert;

// ─── operator_access_log ────────────────────────────────────────────────────

export const operatorAccessLog = pgTable(
  'operator_access_log',
  {
    /** Log-entry id (`oal_…`). */
    id: text('id').primaryKey(),
    /** Tenant whose business data was accessed — drives RLS isolation. */
    tenantId: text('tenant_id').notNull(),
    /** The active grant this access was performed under. */
    grantId: text('grant_id').notNull(),
    /** Borjie staff principal who performed the access. */
    operatorId: text('operator_id').notNull(),
    /** Monotonic per-tenant sequence — anchors the hash chain. */
    seq: bigint('seq', { mode: 'number' }).notNull(),
    /** The gateway route / surface that served the business data. */
    route: text('route').notNull(),
    /** The specific scope exercised (one of the grant's scopes). */
    scope: text('scope').notNull(),
    /** How many business rows the access surfaced. */
    rowCount: integer('row_count').notNull().default(0),
    /** Structured, redaction-safe context (never raw business content). */
    metadata: jsonb('metadata').notNull().default({}),
    /** Hash of the prior entry for this tenant (chain link). */
    prevHash: text('prev_hash').notNull(),
    /** SHA-256 over (prevHash + canonical entry) — breaks on any mutation. */
    thisHash: text('this_hash').notNull(),
    accessedAt: timestamp('accessed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantSeqIdx: index('idx_operator_access_log_tenant_seq').on(
      t.tenantId,
      t.seq,
    ),
    grantIdx: index('idx_operator_access_log_grant').on(
      t.grantId,
      t.accessedAt,
    ),
    uniqTenantSeq: uniqueIndex('uq_operator_access_log_tenant_seq').on(
      t.tenantId,
      t.seq,
    ),
  }),
);

export type OperatorAccessLogRow = typeof operatorAccessLog.$inferSelect;
export type NewOperatorAccessLogRow = typeof operatorAccessLog.$inferInsert;
