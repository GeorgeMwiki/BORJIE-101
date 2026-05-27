/**
 * Customer Geo Routing + Session Scopes persistence (Wave 18Z).
 *
 * Companion to `Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md`.
 * Drizzle types for the 4 tables created by
 * `0026_geo_routing_session_scopes.sql`:
 *
 *   - customerLocations              → versioned location snapshot per
 *                                      customer.
 *   - orgUnitServiceAreas            → geographic territory per
 *                                      org_unit.
 *   - customerDistrictAssignments    → current routing assignment per
 *                                      customer (soft-versioned).
 *   - sessionScopes                  → companion to JWT/cookie for
 *                                      every authenticated session.
 *
 * All four tables are tenant-scoped via the canonical `app.tenant_id`
 * GUC RLS policy (migration 0003 pattern).
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================================================
// customer_locations — versioned location snapshot per customer
// ============================================================================

export const customerLocations = pgTable(
  'customer_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: text('customer_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** gps | postal_code | self_declared | admin_override */
    source: text('source').notNull(),
    coordinatesLat: numeric('coordinates_lat', { precision: 9, scale: 6 }),
    coordinatesLng: numeric('coordinates_lng', { precision: 9, scale: 6 }),
    postalCode: text('postal_code'),
    administrativeCode: text('administrative_code'),
    city: text('city'),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    tenantIdx: index('customer_locations_tenant_idx').on(t.tenantId),
    customerRecentIdx: index('customer_locations_customer_idx').on(
      t.tenantId,
      t.customerId,
      t.recordedAt,
    ),
  }),
);

// ============================================================================
// org_unit_service_areas — geographic territory per org_unit
// ============================================================================

export const orgUnitServiceAreas = pgTable(
  'org_unit_service_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgUnitId: uuid('org_unit_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** polygon | postal_codes | station_radius | administrative_codes */
    areaKind: text('area_kind').notNull(),
    polygonGeojson: jsonb('polygon_geojson'),
    postalCodes: text('postal_codes').array(),
    stationLat: numeric('station_lat', { precision: 9, scale: 6 }),
    stationLng: numeric('station_lng', { precision: 9, scale: 6 }),
    stationRadiusKm: numeric('station_radius_km', { precision: 8, scale: 2 }),
    administrativeCodes: text('administrative_codes').array(),
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('org_unit_service_areas_tenant_idx').on(t.tenantId),
    orgUnitIdx: index('org_unit_service_areas_org_unit_idx').on(t.orgUnitId),
  }),
);

// ============================================================================
// customer_district_assignments — current routing per customer
// ============================================================================

export const customerDistrictAssignments = pgTable(
  'customer_district_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: text('customer_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    /** null = tenant_root fallback */
    assignedOrgUnitId: uuid('assigned_org_unit_id'),
    /** auto_geo | customer_override | admin_override | manual_unassigned */
    assignmentKind: text('assignment_kind').notNull(),
    distanceKm: numeric('distance_km', { precision: 8, scale: 2 }),
    reasoning: text('reasoning').notNull(),
    active: boolean('active').notNull().default(true),
    assignedAt: timestamp('assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
  },
  (t) => ({
    activeIdx: index('customer_district_assignments_active_idx').on(
      t.tenantId,
      t.customerId,
    ),
    orgUnitIdx: index('customer_district_assignments_org_unit_idx').on(
      t.tenantId,
      t.assignedOrgUnitId,
    ),
  }),
);

// ============================================================================
// session_scopes — companion to JWT/cookie for every session
// ============================================================================

export const sessionScopes = pgTable(
  'session_scopes',
  {
    sessionId: uuid('session_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    /** null = tenant_root (general admin / all districts) */
    activeScopeId: uuid('active_scope_id'),
    roleAtActiveScope: text('role_at_active_scope').notNull(),
    authorityTierMax: smallint('authority_tier_max').notNull(),
    /** auto_single_binding | picker_selection | mid_session_switch | remembered_default */
    origin: text('origin').notNull(),
    switchedFromScopeId: uuid('switched_from_scope_id'),
    switchedAt: timestamp('switched_at', { withTimezone: true }),
    auditHash: text('audit_hash').notNull(),
    establishedAt: timestamp('established_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    userActiveIdx: index('session_scopes_user_active_idx').on(
      t.tenantId,
      t.userId,
      t.expiresAt,
    ),
    orgUnitIdx: index('session_scopes_org_unit_idx').on(
      t.tenantId,
      t.activeScopeId,
    ),
  }),
);

export type CustomerLocationRow = typeof customerLocations.$inferSelect;
export type NewCustomerLocation = typeof customerLocations.$inferInsert;
export type OrgUnitServiceAreaRow = typeof orgUnitServiceAreas.$inferSelect;
export type NewOrgUnitServiceArea = typeof orgUnitServiceAreas.$inferInsert;
export type CustomerDistrictAssignmentRow =
  typeof customerDistrictAssignments.$inferSelect;
export type NewCustomerDistrictAssignment =
  typeof customerDistrictAssignments.$inferInsert;
export type SessionScopeRow = typeof sessionScopes.$inferSelect;
export type NewSessionScope = typeof sessionScopes.$inferInsert;
