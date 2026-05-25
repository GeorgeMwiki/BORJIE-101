/**
 * Per-Organization Geo-Hierarchy Schema
 *
 * Materializes the GeoNode/GeoLabelType/GeoAssignment domain model (see
 * packages/domain-models/src/geo/geo-node.ts) into Postgres tables.
 *
 * Design notes:
 *  - Each organization defines its OWN label vocabulary and nesting direction
 *    (e.g. a multi-district public-sector estate client: Districts > Regions
 *    > Stations). `geo_label_types.depth` is ORDINAL; it carries no cross-org
 *    semantic meaning.
 *  - Arbitrary depth supported via `geo_nodes.parent_id`.
 *  - `geo_node_closure` is a classic closure table: one row per
 *    (ancestor, descendant) pair, including depth=0 self-pairs.
 *  - Polygon storage uses JSONB (GeoJSON RFC 7946) for portability.
 *    A future migration can swap in PostGIS geometry columns without
 *    changing domain-model types.
 *  - `geo_assignments` binds users (or worker tags) to a node with a
 *    responsibility; `inherits` controls cascade to descendants.
 *
 * All data is scoped by `organization_id`; there is no cross-org joining.
 */

import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { organizations, users } from './tenant.schema.js';

// ============================================================================
// Label Types — per-org classification of hierarchy levels
// ============================================================================

export const geoLabelTypes = pgTable(
  'geo_label_types',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // 0 = direct child of root. Increases deeper in tree.
    depth: integer('depth').notNull(),
    singular: text('singular').notNull(),
    plural: text('plural').notNull(),
    color: text('color'),
    allowsPolygon: boolean('allows_polygon').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdx: index('geo_label_types_org_idx').on(table.organizationId),
    orgDepthIdx: uniqueIndex('geo_label_types_org_depth_idx').on(
      table.organizationId,
      table.depth,
    ),
  }),
);

// ============================================================================
// Geo Nodes — the per-org tree
// ============================================================================

export const geoNodes = pgTable(
  'geo_nodes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    labelTypeId: text('label_type_id')
      .notNull()
      .references(() => geoLabelTypes.id),
    name: text('name').notNull(),
    code: text('code'),

    // GeoJSON polygon/multipolygon. Coordinates are [lng, lat] per RFC 7946.
    polygon: jsonb('polygon'),

    // Cached centroid for zoom-to/labeling. { lat, lng } convention.
    centroid: jsonb('centroid'),

    colorOverride: text('color_override'),
    orderIndex: integer('order_index').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdx: index('geo_nodes_org_idx').on(table.organizationId),
    parentIdx: index('geo_nodes_parent_idx').on(table.parentId),
    labelTypeIdx: index('geo_nodes_label_type_idx').on(table.labelTypeId),
    // Natural key within an org: (parent, name). Enables idempotent seeding.
    orgParentNameIdx: uniqueIndex('geo_nodes_org_parent_name_idx').on(
      table.organizationId,
      table.parentId,
      table.name,
    ),
  }),
);

// ============================================================================
// Closure Table — O(1) ancestor/descendant lookups
// ============================================================================

export const geoNodeClosure = pgTable(
  'geo_node_closure',
  {
    ancestorId: text('ancestor_id')
      .notNull()
      .references(() => geoNodes.id, { onDelete: 'cascade' }),
    descendantId: text('descendant_id')
      .notNull()
      .references(() => geoNodes.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.ancestorId, table.descendantId] }),
    descendantIdx: index('geo_node_closure_descendant_idx').on(
      table.descendantId,
    ),
  }),
);

// ============================================================================
// Geo Assignments — bind users/tags to nodes
// ============================================================================

export const geoAssignments = pgTable(
  'geo_assignments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    geoNodeId: text('geo_node_id')
      .notNull()
      .references(() => geoNodes.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    workerTagKey: text('worker_tag_key'),
    // 'station_master' | 'surveyor' | 'manager' | 'worker'
    responsibility: text('responsibility').notNull(),
    inherits: boolean('inherits').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    orgIdx: index('geo_assignments_org_idx').on(table.organizationId),
    nodeIdx: index('geo_assignments_node_idx').on(table.geoNodeId),
    userIdx: index('geo_assignments_user_idx').on(table.userId),
  }),
);

// ============================================================================
// Relations
// ============================================================================

export const geoLabelTypesRelations = relations(geoLabelTypes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [geoLabelTypes.organizationId],
    references: [organizations.id],
  }),
  nodes: many(geoNodes),
}));

export const geoNodesRelations = relations(geoNodes, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [geoNodes.organizationId],
    references: [organizations.id],
  }),
  labelType: one(geoLabelTypes, {
    fields: [geoNodes.labelTypeId],
    references: [geoLabelTypes.id],
  }),
  parent: one(geoNodes, {
    fields: [geoNodes.parentId],
    references: [geoNodes.id],
  }),
  assignments: many(geoAssignments),
}));

export const geoAssignmentsRelations = relations(geoAssignments, ({ one }) => ({
  organization: one(organizations, {
    fields: [geoAssignments.organizationId],
    references: [organizations.id],
  }),
  node: one(geoNodes, {
    fields: [geoAssignments.geoNodeId],
    references: [geoNodes.id],
  }),
  user: one(users, {
    fields: [geoAssignments.userId],
    references: [users.id],
  }),
}));
