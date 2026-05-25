/**
 * Field-level encryption audit (migration 0143) — Phase D D1.
 *
 * Drizzle schema for `field_encryption_audit`. One row per encrypted
 * field write. Powers the rotation-coverage report ("how many
 * customers.kra_pin rows are still on v1?") and SOC 2 evidence
 * (CC6.7 — protection of data at rest).
 *
 * Append-only by convention. The DELETE path is reserved for the
 * GDPR right-to-be-forgotten orchestrator. See
 * `Docs/SECURITY/ENCRYPTION_AT_REST.md` for the rotation runbook.
 */

import {
  pgTable,
  text,
  integer,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const fieldEncryptionAudit = pgTable(
  'field_encryption_audit',
  {
    id: text('id').primaryKey(),
    /** NULL = platform-tier (audit_events.actor_email etc.). */
    tenantId: text('tenant_id'),
    tableName: text('table_name').notNull(),
    columnName: text('column_name').notNull(),
    /** Logical row id (typically the PK). NULLABLE for batch operations. */
    rowId: text('row_id'),
    /** Master-key generation that derived the DEK. */
    keyVersion: integer('key_version').notNull(),
    encryptedAt: timestamp('encrypted_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Stamped by the rotation script after re-encryption. */
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (t) => ({
    scopeIdx: index('idx_field_encryption_audit_scope').on(
      t.tenantId,
      t.tableName,
      t.columnName,
      t.keyVersion,
    ),
    rowIdx: index('idx_field_encryption_audit_row').on(
      t.tableName,
      t.rowId,
      t.encryptedAt.desc(),
    ),
    timeIdx: index('idx_field_encryption_audit_time').on(
      t.encryptedAt.desc(),
    ),
  }),
);

export type FieldEncryptionAuditRow = typeof fieldEncryptionAudit.$inferSelect;
export type NewFieldEncryptionAuditRow =
  typeof fieldEncryptionAudit.$inferInsert;
