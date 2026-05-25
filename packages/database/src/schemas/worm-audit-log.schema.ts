/**
 * worm_audit_log — Drizzle schema (migration 0165).
 *
 * Persistent backing for the `WormAuditStore` port declared in
 * `packages/document-studio/src/signing/worm-audit.ts`. Every document
 * that leaves `@borjie/document-studio` appends one append-only
 * row carrying:
 *
 *   - actor + tenant + document identity
 *   - sha256 of the rendered bytes
 *   - sha256 of the citation set
 *   - sha256 of the previous chain entry (per-tenant chain)
 *   - sha256 over (entryId || tenantId || ... || previousEntryHash) —
 *     the chain hash. Any post-hoc mutation breaks the chain.
 *
 * Chain shape matches the in-memory store so a tenant can be re-hydrated
 * from either store and `verify(tenantId)` returns the same verdict.
 *
 * SOC 2 / GDPR Art. 30 rationale:
 *   - Each row is a tamper-evident audit record of personal-data export.
 *   - INSERT-only by convention (no update path). Operator-level retention
 *     sweeps live behind a separate role; the service surface here is
 *     purely append + read.
 *   - tenant_id is mandatory ⇒ cross-tenant joins are impossible without
 *     a deliberate role-elevation; pairs cleanly with RLS migration 0155.
 */

import {
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const wormAuditLog = pgTable(
  'worm_audit_log',
  {
    /** Stable entry id (`worm-<ts>-<seq>` or randomUUID). Primary key. */
    entryId: text('entry_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    actorId: text('actor_id').notNull(),
    documentKind: text('document_kind').notNull(),
    documentId: text('document_id').notNull(),
    renderedAtIso: text('rendered_at_iso').notNull(),
    renderedSha256: text('rendered_sha256').notNull(),
    citationsSha256: text('citations_sha256').notNull(),
    /** Per-tenant chain link. NULL only on the genesis row of a tenant. */
    previousEntryHash: text('previous_entry_hash'),
    chainHash: text('chain_hash').notNull(),
    /** Strictly monotonic per tenant; used to enforce traversal order. */
    sequenceNumber: integer('sequence_number').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    /** (tenant, sequence) uniqueness ⇒ no two rows share a slot. */
    tenantSeqUniq: uniqueIndex('uniq_worm_audit_tenant_sequence').on(
      t.tenantId,
      t.sequenceNumber,
    ),
    tenantSeqIdx: index('idx_worm_audit_tenant_sequence').on(
      t.tenantId,
      t.sequenceNumber,
    ),
    chainHashIdx: index('idx_worm_audit_chain_hash').on(t.chainHash),
  }),
);

export type WormAuditLogRow = typeof wormAuditLog.$inferSelect;
export type NewWormAuditLogRow = typeof wormAuditLog.$inferInsert;
