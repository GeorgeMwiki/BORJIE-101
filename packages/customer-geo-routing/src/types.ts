/**
 * Customer Geo Routing + Scope Login — value types (Wave 18Z).
 *
 * Companion to Docs/DESIGN/CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN.md.
 *
 * Everything in this module is value-types only (no side effects, no I/O).
 * Behavioural code lives under `geo/`, `routing/`, `scope/`, `audit/`.
 */

import { z } from 'zod';

// =============================================================================
// Customer location
// =============================================================================

export const LOCATION_SOURCES = [
  'gps',
  'postal_code',
  'self_declared',
  'admin_override',
] as const;

export type CustomerLocationSource = (typeof LOCATION_SOURCES)[number];

export const CustomerLocationSourceSchema = z.enum(LOCATION_SOURCES);

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

export const LatLngSchema = z.object({
  lat: z.number().gte(-90).lte(90),
  lng: z.number().gte(-180).lte(180),
});

export interface CustomerLocation {
  readonly customer_id: string;
  readonly tenant_id: string;
  readonly source: CustomerLocationSource;
  readonly coordinates?: LatLng;
  readonly postal_code?: string;
  readonly administrative_code?: string;
  readonly city?: string;
  readonly recorded_at: string;
}

export const CustomerLocationSchema = z.object({
  customer_id: z.string().min(1),
  tenant_id: z.string().min(1),
  source: CustomerLocationSourceSchema,
  coordinates: LatLngSchema.optional(),
  postal_code: z.string().min(1).optional(),
  administrative_code: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  recorded_at: z.string().min(1),
});

// =============================================================================
// Org unit service area
// =============================================================================

export const SERVICE_AREA_KINDS = [
  'polygon',
  'postal_codes',
  'station_radius',
  'administrative_codes',
] as const;

export type ServiceAreaKind = (typeof SERVICE_AREA_KINDS)[number];

export const ServiceAreaKindSchema = z.enum(SERVICE_AREA_KINDS);

/**
 * GeoJSON polygon ring — minimum 4 coordinates (closed ring). Each coord
 * is [lng, lat] per GeoJSON convention.
 */
export type GeoJsonPolygonRing = ReadonlyArray<readonly [number, number]>;

/**
 * GeoJSON polygon with optional holes — first ring is the outer ring,
 * subsequent rings are holes.
 */
export interface GeoJsonPolygon {
  readonly type: 'Polygon';
  readonly coordinates: ReadonlyArray<GeoJsonPolygonRing>;
}

export const GeoJsonPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(
    z.array(z.tuple([z.number(), z.number()])).min(4),
  ),
});

export interface OrgUnitServiceArea {
  readonly org_unit_id: string;
  readonly tenant_id: string;
  readonly area_kind: ServiceAreaKind;
  readonly polygon?: GeoJsonPolygon;
  readonly postal_codes?: ReadonlyArray<string>;
  readonly station_coords?: LatLng;
  readonly station_radius_km?: number;
  readonly administrative_codes?: ReadonlyArray<string>;
  readonly priority: number;
}

export const OrgUnitServiceAreaSchema = z.object({
  org_unit_id: z.string().min(1),
  tenant_id: z.string().min(1),
  area_kind: ServiceAreaKindSchema,
  polygon: GeoJsonPolygonSchema.optional(),
  postal_codes: z.array(z.string().min(1)).readonly().optional(),
  station_coords: LatLngSchema.optional(),
  station_radius_km: z.number().positive().optional(),
  administrative_codes: z.array(z.string().min(1)).readonly().optional(),
  priority: z.number().int(),
});

// =============================================================================
// Customer district assignment
// =============================================================================

export const ASSIGNMENT_KINDS = [
  'auto_geo',
  'customer_override',
  'admin_override',
  'manual_unassigned',
] as const;

export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

export const AssignmentKindSchema = z.enum(ASSIGNMENT_KINDS);

export interface CustomerDistrictAssignment {
  readonly customer_id: string;
  readonly tenant_id: string;
  readonly assigned_org_unit_id: string | null;
  readonly assignment_kind: AssignmentKind;
  readonly distance_km?: number;
  readonly reasoning: string;
  readonly assigned_at: string;
  readonly audit_hash: string;
}

export const CustomerDistrictAssignmentSchema = z.object({
  customer_id: z.string().min(1),
  tenant_id: z.string().min(1),
  assigned_org_unit_id: z.string().min(1).nullable(),
  assignment_kind: AssignmentKindSchema,
  distance_km: z.number().nonnegative().optional(),
  reasoning: z.string().min(1),
  assigned_at: z.string().min(1),
  audit_hash: z.string().min(1),
});

// =============================================================================
// Session scope (login-time picker + mid-session switcher)
// =============================================================================

export const AUTHORITY_TIERS = [0, 1, 2] as const;
export type AuthorityTier = (typeof AUTHORITY_TIERS)[number];

export const SESSION_SCOPE_ORIGINS = [
  'auto_single_binding',
  'picker_selection',
  'mid_session_switch',
  'remembered_default',
] as const;

export type SessionScopeOrigin = (typeof SESSION_SCOPE_ORIGINS)[number];

export interface SessionScope {
  readonly session_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  /** null = tenant_root (general admin / all districts). */
  readonly active_scope_id: string | null;
  readonly role_at_active_scope: string;
  readonly authority_tier_max: AuthorityTier;
  readonly origin: SessionScopeOrigin;
  readonly switched_from_scope_id?: string | null;
  readonly switched_at?: string;
  readonly audit_hash: string;
  readonly established_at: string;
  readonly expires_at: string;
}

export const SessionScopeSchema = z.object({
  session_id: z.string().min(1),
  tenant_id: z.string().min(1),
  user_id: z.string().min(1),
  active_scope_id: z.string().min(1).nullable(),
  role_at_active_scope: z.string().min(1),
  authority_tier_max: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  origin: z.enum(SESSION_SCOPE_ORIGINS),
  switched_from_scope_id: z.string().min(1).nullable().optional(),
  switched_at: z.string().min(1).optional(),
  audit_hash: z.string().min(1),
  established_at: z.string().min(1),
  expires_at: z.string().min(1),
});

// =============================================================================
// Scope picker contract (login flow)
// =============================================================================

export interface ScopePickerOption {
  /** null = tenant_root option ("General (all districts)"). */
  readonly scope_id: string | null;
  readonly display_name: string;
  readonly role: string;
  readonly authority_tier_max: AuthorityTier;
  readonly last_used_at?: string;
  /** True when this is the user's saved default (Wave 18W home prefs). */
  readonly is_default: boolean;
}

export interface ScopePickerInput {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly options: ReadonlyArray<ScopePickerOption>;
  readonly remembered_default_scope_id?: string | null;
}

export interface ScopePickerOutcome {
  /** False when the user has only one binding — picker is auto-resolved. */
  readonly requires_picker: boolean;
  readonly resolved_option?: ScopePickerOption;
  readonly origin: SessionScopeOrigin;
}

// =============================================================================
// Minimal user-binding shape (mirrors @borjie/org-scope's UserScopeBinding)
// =============================================================================

/**
 * Minimal shape we read from `user_scope_bindings`. Mirrors
 * `@borjie/org-scope`'s `UserScopeBinding` but kept structurally so we
 * don't have to take a hard dependency until Wave 18Y lands.
 */
export interface UserBindingLike {
  readonly id: string;
  readonly user_id: string;
  readonly tenant_id: string;
  readonly scope_kind: 'tenant_root' | 'org_unit';
  readonly org_unit_id: string | null;
  readonly role: string;
  readonly authority_tier_max: AuthorityTier;
  readonly granted_at: string;
  readonly revoked_at: string | null;
  /** Optional last-used stamp from session_scopes (most-recent first sort). */
  readonly last_used_at?: string;
  /** Optional display name from org_units. */
  readonly display_name?: string;
}
