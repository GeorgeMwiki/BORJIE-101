/**
 * tenant_schema_extensions (migration 0188) — typed custom-field
 * definitions per (tenant, module, entity_type, field_name).
 *
 * The single source of truth for what tenants may write into
 * `core_entity.custom_fields`. The repository validates incoming
 * JSONB against the rehydrated Zod schema on every write.
 */

import {
  pgTable,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';

/**
 * Allowed primitive shapes for a custom field. Stored as TEXT in the
 * DB for forward-compat.
 */
export const TENANT_SCHEMA_FIELD_KINDS = [
  'text',
  'number',
  'money',
  'date',
  'datetime',
  'boolean',
  'enum',
  'ref',
  'jsonb',
  'vector',
] as const;

export type TenantSchemaFieldKind = (typeof TENANT_SCHEMA_FIELD_KINDS)[number];

export const TENANT_SCHEMA_INDEX_STRATEGIES = [
  'gin_path',
  'btree_path',
] as const;

export type TenantSchemaIndexStrategy =
  (typeof TENANT_SCHEMA_INDEX_STRATEGIES)[number];

export const tenantSchemaExtensions = pgTable(
  'tenant_schema_extensions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    moduleId: text('module_id'),
    entityType: text('entity_type').notNull(),
    fieldName: text('field_name').notNull(),
    fieldKind: text('field_kind').notNull(),
    /**
     * Zod schema serialized via @borjie/domain-models zodToJson
     * helper. The repository rehydrates the validator at write time.
     */
    zodJsonb: jsonb('zod_jsonb').notNull(),
    required: boolean('required').notNull().default(false),
    /** 'gin_path' | 'btree_path' | NULL */
    indexStrategy: text('index_strategy'),
    /** Array of constraint objects (regex, min/max, enum values). */
    validationsJsonb: jsonb('validations_jsonb').notNull().default([]),
    displayOrder: integer('display_order'),
    displayLabelEn: text('display_label_en'),
    displayLabelSw: text('display_label_sw'),
    helpText: text('help_text'),
    placeholder: text('placeholder'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by'),
  },
  (t) => ({
    tenantIdx: index('tenant_schema_extensions_tenant_idx').on(t.tenantId),
    typeIdx: index('tenant_schema_extensions_type_idx').on(
      t.tenantId,
      t.entityType,
    ),
  }),
);

export type TenantSchemaExtensionRow =
  typeof tenantSchemaExtensions.$inferSelect;
export type TenantSchemaExtensionInsert =
  typeof tenantSchemaExtensions.$inferInsert;
