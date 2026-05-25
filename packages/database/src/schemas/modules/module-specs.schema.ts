/**
 * module_specs (migration 0217) — versioned DSL specs for modules.
 *
 * One row per spec version. spec_jsonb conforms to the locked grammar
 * in @borjie/module-spec-engine; LLM never emits SQL/JSX/DDL. The
 * spec compiler GENERATES safe migration text + Zod validators from
 * the JSON. compile_status progresses pending → compiled → applied;
 * `failed` is terminal for the row (a re-compile creates a new row).
 *
 * RLS: tenant_id = current_app_tenant_id() on SELECT and modify.
 */

import {
  pgTable,
  text,
  smallint,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from '../tenant.schema.js';
import { modules } from './modules.schema.js';

export const MODULE_SPEC_COMPILE_STATUSES = [
  'pending',
  'compiled',
  'applied',
  'failed',
] as const;

export type ModuleSpecCompileStatus =
  (typeof MODULE_SPEC_COMPILE_STATUSES)[number];

export const moduleSpecs = pgTable(
  'module_specs',
  {
    id: text('id').primaryKey(),
    moduleId: text('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    version: smallint('version').notNull(),
    specJsonb: jsonb('spec_jsonb')
      .$type<Record<string, unknown>>()
      .notNull(),
    generatedMigrationSql: text('generated_migration_sql'),
    generatedZodValidators: jsonb('generated_zod_validators')
      .$type<Record<string, unknown>>(),
    compileStatus: text('compile_status')
      .$type<ModuleSpecCompileStatus>()
      .notNull()
      .default('pending'),
    compileError: text('compile_error'),
    appliedMigrationFilename: text('applied_migration_filename'),
    hitlApprovalId: text('hitl_approval_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    moduleVersionUnique: uniqueIndex('uq_module_specs_module_version').on(
      t.moduleId,
      t.version,
    ),
    tenantIdx: index('module_specs_tenant_idx').on(t.tenantId),
    moduleVersionIdx: index('module_specs_module_version_idx').on(
      t.moduleId,
      t.version,
    ),
    compileStatusIdx: index('module_specs_compile_status_idx').on(
      t.tenantId,
      t.compileStatus,
    ),
    statusCheck: check(
      'module_specs_compile_status_check',
      sql`compile_status IN ('pending', 'compiled', 'applied', 'failed')`,
    ),
    versionCheck: check(
      'module_specs_version_check',
      sql`version >= 1`,
    ),
  }),
);

export type ModuleSpecRow = typeof moduleSpecs.$inferSelect;
export type ModuleSpecInsert = typeof moduleSpecs.$inferInsert;
