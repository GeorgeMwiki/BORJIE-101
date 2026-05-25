/**
 * entity_type_definition (migration 0187) — type catalog for the universal
 * asset model.
 *
 * Two-layer:
 *   * Platform built-ins (`tenant_id IS NULL`, `is_built_in = TRUE`).
 *   * Tenant-defined (`tenant_id IS NOT NULL`).
 *
 * The (slug, tenant_id) uniqueness is enforced by two partial unique
 * indexes (one for the NULL-tenant platform row, one for the
 * tenant-tier rows).
 */

import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';

export const entityTypeDefinition = pgTable(
  'entity_type_definition',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    displayNameEn: text('display_name_en').notNull(),
    displayNameSw: text('display_name_sw'),
    description: text('description'),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    allowedParentTypes: text('allowed_parent_types')
      .array()
      .notNull()
      .default([]),
    icon: text('icon'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('entity_type_definition_tenant_idx').on(t.tenantId),
    builtInIdx: index('entity_type_definition_built_in_idx').on(t.isBuiltIn),
  }),
);

export type EntityTypeDefinitionRow = typeof entityTypeDefinition.$inferSelect;
export type EntityTypeDefinitionInsert =
  typeof entityTypeDefinition.$inferInsert;

/**
 * Canonical platform built-in slugs. Mirrors the seeds in migration 0187.
 * The repository uses this as a quick `Set<string>` for validation
 * without round-tripping the DB.
 */
export const PLATFORM_BUILT_IN_ENTITY_TYPES = [
  'LAND_PARCEL',
  'BUILDING',
  'SUB_UNIT',
  'WAREHOUSE',
  'GODOWN',
  'HOTEL',
  'PLOT',
  'BARELAND',
  'VEHICLE',
  'LOCOMOTIVE',
  'MACHINERY',
  'IT_ASSET',
  'INTANGIBLE',
  'PERSON',
  'ORG_UNIT',
  'VENDOR',
  'CONTRACT',
] as const;

export type PlatformBuiltInEntityType =
  (typeof PLATFORM_BUILT_IN_ENTITY_TYPES)[number];
