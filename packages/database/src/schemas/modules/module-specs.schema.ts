/**
 * module_specs — the per-module versioned spec + generated-DDL ledger.
 *
 * One row per version of a `modules` row's compiled spec. The orchestrator
 * compiles a module spec into a `generated_migration_sql` string (the runtime
 * tenant-table DDL) plus `generated_zod_validators` (the runtime input shapes),
 * then the executor applies the migration and stamps `applied_migration_filename`
 * + `applied_at` + flips `status` to 'applied'. A CHECK enforces the honest
 * lifecycle: a row whose `status = 'applied'` MUST carry an
 * `applied_migration_filename` (mirrors 0321's done-proof CHECK on confirmed_at).
 *
 * Companion to migration 0323_module_spawning_registry.sql. Tenant-scoped
 * (tenant_id TEXT, no FK). FORCE-enables RLS in 0323 with a tenant-isolation
 * policy on the canonical `app.current_tenant_id` GUC + a service-role bypass
 * (so the out-of-band module executor can persist the apply result under the
 * service-role connection while RLS FORCE isolates every request path).
 */

import {
  pgTable,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ============================================================================
// module_specs — per-module versioned compiled spec + apply result.
// ============================================================================

export const moduleSpecs = pgTable(
  'module_specs',
  {
    id: text('id').primaryKey(),
    /** Parent modules.id this spec version belongs to. */
    moduleId: text('module_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** Monotonic spec version within a module. */
    version: integer('version').notNull().default(1),
    /** The compiled module spec document. */
    specJsonb: jsonb('spec_jsonb')
      .$type<Record<string, unknown>>()
      .notNull(),
    /** The compiled runtime tenant-table DDL the executor applies. */
    generatedMigrationSql: text('generated_migration_sql').notNull(),
    /** The compiled runtime input validators (JSONB-encoded zod shapes). */
    generatedZodValidators: jsonb('generated_zod_validators')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Lifecycle: draft | applied | failed (see status CHECK). */
    status: text('status').notNull().default('draft'),
    /** The migration filename the executor stamped on apply (NULL until applied). */
    appliedMigrationFilename: text('applied_migration_filename'),
    /** Non-leaking failure reason when status = 'failed'. */
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Set only on a successful apply. */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (t) => ({
    /** Reconcile read: every spec version for a tenant's module. */
    tenantModuleIdx: index('idx_module_specs_tenant_module').on(
      t.tenantId,
      t.moduleId,
    ),
    /**
     * Honest apply-proof: an 'applied' spec MUST carry the filename it landed
     * as. Mirrors 0321's done-proof CHECK on confirmed_at.
     */
    appliedProofCheck: check(
      'module_specs_applied_proof_chk',
      sql`${t.status} <> 'applied' OR ${t.appliedMigrationFilename} IS NOT NULL`,
    ),
  }),
);

export type ModuleSpecRow = typeof moduleSpecs.$inferSelect;
export type ModuleSpecInsert = typeof moduleSpecs.$inferInsert;
