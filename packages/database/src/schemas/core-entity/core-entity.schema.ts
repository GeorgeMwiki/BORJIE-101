/**
 * core_entity (migration 0186) — Piece A universal asset & entity model.
 *
 * The single polymorphic row-store for every tangible or intangible
 * asset / actor a tenant owns or manages. Type-specific attributes
 * live in `entity_ext_*` sibling tables; truly tenant-bespoke fields
 * live in {@link CoreEntityRow.customFields} JSONB validated against
 * `tenant_schema_extensions`.
 *
 * Subdivision via {@link CoreEntityRow.parentEntityId} self-reference
 * (LAND_PARCEL → LAND_PARCEL, BUILDING → SUB_UNIT, ...). Hybrid
 * retrieval combines BM25 (`tsv`) + dense (`embedding`) + geo
 * (`geoGeog`) + JSONB containment (`customFields`).
 *
 * Tenant-scoped via RLS (gold-standard pattern; see migration 0186).
 */

import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { tenants } from '../tenant.schema.js';

// ---------------------------------------------------------------------
// Custom column types — pgvector and PostGIS geography. We declare them
// inline so the schema compiles without optional Drizzle helper packages.
// ---------------------------------------------------------------------

const vector = (dim: number) =>
  customType<{ data: number[] | null; driverData: string }>({
    dataType() {
      return `vector(${dim})`;
    },
    toDriver(value) {
      if (value === null || value === undefined) {
        return '';
      }
      return `[${value.join(',')}]`;
    },
    fromDriver(value) {
      if (value === null || value === undefined) return [];
      const inner = String(value).replace(/^\[|\]$/g, '');
      return inner
        .split(',')
        .filter(Boolean)
        .map((n) => Number(n));
    },
  });

/**
 * PostGIS geography column. Stored as the underlying serialised text
 * the driver emits; consumers parse via PostGIS server-side functions
 * (`ST_AsGeoJSON`, etc.) in their queries rather than at the row layer.
 */
const geography = customType<{ data: string | null }>({
  dataType() {
    return 'geography(GEOMETRY, 4326)';
  },
});

/**
 * Tsvector column — opaque shape at the TS layer. The 0186 trigger
 * populates this automatically on every insert/update.
 */
const tsvector = customType<{ data: string | null }>({
  dataType() {
    return 'tsvector';
  },
});

export const CORE_ENTITY_EMBEDDING_DIM = 1536;

// ---------------------------------------------------------------------
// Lifecycle states — open enumeration. The DB column stores TEXT so new
// states can be added without a migration.
// ---------------------------------------------------------------------

export const CORE_ENTITY_LIFECYCLE_STATES = [
  'active',
  'archived',
  'in_review',
  'terminated',
] as const;

export type CoreEntityLifecycleState =
  (typeof CORE_ENTITY_LIFECYCLE_STATES)[number];

// ---------------------------------------------------------------------
// Table definition.
// ---------------------------------------------------------------------

export const coreEntity = pgTable(
  'core_entity',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * NULL during Wave 16; required once Piece B (Module Registry)
     * lands. Indicates which @borjie module owns this entity.
     */
    moduleId: text('module_id'),
    /**
     * Slug from {@link entityTypeDefinition.slug} — TEXT FK enforced
     * at the trigger layer (see migration 0187 because the slug FK
     * spans two partial unique indexes).
     */
    entityType: text('entity_type').notNull(),
    /**
     * Self-reference for subdivisions. ON DELETE CASCADE so deleting
     * a parent recursively removes its children.
     */
    parentEntityId: text('parent_entity_id'),
    /**
     * Secondary classification within entity_type. Surfaced to the
     * brain as a hint. Free-form TEXT for forward-compat.
     */
    discriminator: text('discriminator'),
    displayName: text('display_name').notNull(),
    lifecycleState: text('lifecycle_state').notNull().default('active'),
    /**
     * PostGIS geography(GEOMETRY, 4326). NULL on PostGIS-less
     * environments (migration 0186 falls back to JSONB).
     */
    geoGeog: geography('geo_geog'),
    /**
     * Tenant-defined custom fields. Validated by the repository
     * against tenant_schema_extensions on every write.
     */
    customFields: jsonb('custom_fields').notNull().default({}),
    /**
     * 1536-dim dense vector for ANN search. NULL until the
     * consolidation worker populates it.
     */
    embedding: vector(CORE_ENTITY_EMBEDDING_DIM)('embedding'),
    /**
     * BM25-style tsvector, maintained by the core_entity_tsv_trigger
     * defined in migration 0186. Read-only from app code.
     */
    tsv: tsvector('tsv'),
    /**
     * Optional anchor into ai_audit_chain — root_hash of the chain
     * segment that authorised this entity's creation when written
     * via a sovereign / four-eye action.
     */
    auditChainRootHash: text('audit_chain_root_hash'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdBy: text('created_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('core_entity_tenant_idx').on(t.tenantId),
    typeIdx: index('core_entity_type_idx').on(t.tenantId, t.entityType),
    parentIdx: index('core_entity_parent_idx').on(t.parentEntityId),
    lifecycleIdx: index('core_entity_lifecycle_idx').on(
      t.tenantId,
      t.lifecycleState,
    ),
    tsvIdx: index('core_entity_tsv_idx').on(t.tsv),
    customFieldsIdx: index('core_entity_custom_fields_idx').on(t.customFields),
  }),
);

export type CoreEntityRow = typeof coreEntity.$inferSelect;
export type CoreEntityInsert = typeof coreEntity.$inferInsert;
