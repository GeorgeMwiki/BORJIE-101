/**
 * Piece N — Geo + Parcels + Marketplace type definitions.
 *
 * All polygons are GeoJSON POLYGON shapes (rings of [lng, lat] pairs).
 * SRID 4326 (WGS84) is implicit — the database stores
 * `geography(POLYGON, 4326)`.
 *
 * Zod schemas are exported alongside TypeScript types so callers can
 * runtime-validate inputs at trust boundaries (HTTP handlers, message
 * consumers).
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────
// GeoJSON-ish primitives (we keep them local — no external dep).
// ────────────────────────────────────────────────────────────────────

/** A [longitude, latitude] coordinate. */
export const PointCoordsSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export type PointCoords = z.infer<typeof PointCoordsSchema>;

/**
 * A GeoJSON POLYGON: array of linear rings. The first ring is the
 * outer boundary; subsequent rings are holes. Each ring is a closed
 * line (first point == last point) of at least 4 points.
 */
export const PolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(
      z
        .array(PointCoordsSchema)
        .min(4, 'a ring must have at least 4 points (first == last)'),
    )
    .min(1, 'a polygon must have at least the outer ring'),
});
export type Polygon = z.infer<typeof PolygonSchema>;

export const PointSchema = z.object({
  type: z.literal('Point'),
  coordinates: PointCoordsSchema,
});
export type Point = z.infer<typeof PointSchema>;

// ────────────────────────────────────────────────────────────────────
// Capture mechanisms — matches 0252_land_areas.captured_via CHECK.
// ────────────────────────────────────────────────────────────────────

export const CaptureViaSchema = z.enum([
  'manual_draw',
  'gps_walk',
  'gis_import',
  'satellite_trace',
]);
export type CaptureVia = z.infer<typeof CaptureViaSchema>;

// ────────────────────────────────────────────────────────────────────
// Parcel status — matches 0253_parcels.status CHECK.
// ────────────────────────────────────────────────────────────────────

export const ParcelStatusSchema = z.enum([
  'available',
  'reserved',
  'leased',
  'sold',
  'disputed',
  'unavailable',
]);
export type ParcelStatus = z.infer<typeof ParcelStatusSchema>;

export const ParcelZoningSchema = z.enum([
  'residential',
  'commercial',
  'industrial',
  'mixed',
  'undeveloped',
  'special',
]);
export type ParcelZoning = z.infer<typeof ParcelZoningSchema>;

// ────────────────────────────────────────────────────────────────────
// Listing — matches 0256.
// ────────────────────────────────────────────────────────────────────

export const ListingKindSchema = z.enum([
  'sale',
  'lease',
  'shared_use',
  'investment_partnership',
]);
export type ListingKind = z.infer<typeof ListingKindSchema>;

export const ListingStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'sold',
  'expired',
]);
export type ListingStatus = z.infer<typeof ListingStatusSchema>;

export const ContactMethodSchema = z.enum(['in_app', 'whatsapp', 'phone', 'email']);
export type ContactMethod = z.infer<typeof ContactMethodSchema>;

// ────────────────────────────────────────────────────────────────────
// Evidence — matches 0255.
// ────────────────────────────────────────────────────────────────────

export const EvidenceKindSchema = z.enum([
  'title_deed',
  'lease_agreement',
  'survey_diagram',
  'photo',
  'video',
  'court_ruling',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

// ────────────────────────────────────────────────────────────────────
// Metadata — matches 0254.
// ────────────────────────────────────────────────────────────────────

export const MetadataValueKindSchema = z.enum([
  'text',
  'number',
  'boolean',
  'date',
  'enum',
  'jsonb',
]);
export type MetadataValueKind = z.infer<typeof MetadataValueKindSchema>;

// ────────────────────────────────────────────────────────────────────
// Activity-log event kinds — matches 0257.
// ────────────────────────────────────────────────────────────────────

export const ActivityEventKindSchema = z.enum([
  'created',
  'subdivided',
  'status_changed',
  'metadata_changed',
  'evidence_attached',
  'listed',
  'sold',
  'leased',
  'price_changed',
  'photo_added',
  'tag_changed',
  'color_changed',
]);
export type ActivityEventKind = z.infer<typeof ActivityEventKindSchema>;

// ────────────────────────────────────────────────────────────────────
// Inquiry — matches 0259.
// ────────────────────────────────────────────────────────────────────

export const InquiryStatusSchema = z.enum([
  'open',
  'replied',
  'closed_no_interest',
  'closed_deal',
]);
export type InquiryStatus = z.infer<typeof InquiryStatusSchema>;

// ────────────────────────────────────────────────────────────────────
// Domain row shapes.
// ────────────────────────────────────────────────────────────────────

export const LandAreaSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  core_entity_id: z.string().nullable().optional(),
  display_name: z.string().min(1),
  description: z.string().nullable().optional(),
  boundary_polygon: PolygonSchema,
  center_point: PointSchema,
  area_sqm: z.number().nullable().optional(),
  jurisdiction: z.string().length(2),
  region: z.string().nullable().optional(),
  ward: z.string().nullable().optional(),
  plot_number: z.string().nullable().optional(),
  captured_via: CaptureViaSchema,
  captured_by_user_id: z.string().min(1),
  created_at: z.string().or(z.date()).optional(),
  updated_at: z.string().or(z.date()).optional(),
  deleted_at: z.string().or(z.date()).nullable().optional(),
});
export type LandArea = z.infer<typeof LandAreaSchema>;

export const ParcelSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  land_area_id: z.string().min(1),
  parent_parcel_id: z.string().nullable().optional(),
  core_entity_id: z.string().nullable().optional(),
  display_name: z.string().min(1),
  boundary_polygon: PolygonSchema,
  center_point: PointSchema,
  area_sqm: z.number().nullable().optional(),
  parcel_number: z.string().nullable().optional(),
  status: ParcelStatusSchema.default('available'),
  status_changed_at: z.string().or(z.date()).optional(),
  color_hex: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'color_hex must be a 6-digit hex')
    .nullable()
    .optional(),
  label: z.string().nullable().optional(),
  zoning: ParcelZoningSchema.nullable().optional(),
  land_use: z.string().nullable().optional(),
  road_frontage_m: z.number().nullable().optional(),
  created_at: z.string().or(z.date()).optional(),
  updated_at: z.string().or(z.date()).optional(),
  deleted_at: z.string().or(z.date()).nullable().optional(),
});
export type Parcel = z.infer<typeof ParcelSchema>;

export const ParcelMetadataSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  parcel_id: z.string().min(1),
  key: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'metadata key must be lowercase snake_case'),
  value_kind: MetadataValueKindSchema,
  value_jsonb: z.unknown(),
  created_at: z.string().or(z.date()).optional(),
  created_by_user_id: z.string().nullable().optional(),
});
export type ParcelMetadata = z.infer<typeof ParcelMetadataSchema>;

export const ParcelEvidenceSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  parcel_id: z.string().min(1),
  document_id: z.string().nullable().optional(),
  evidence_kind: EvidenceKindSchema,
  trust_score: z.number().min(0).max(1).nullable().optional(),
  verified_by_user_id: z.string().nullable().optional(),
  verified_at: z.string().or(z.date()).nullable().optional(),
  storage_path: z.string().nullable().optional(),
  public_visible: z.boolean().default(false),
  created_at: z.string().or(z.date()).optional(),
});
export type ParcelEvidence = z.infer<typeof ParcelEvidenceSchema>;

export const MarketplaceListingSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  listed_by_user_id: z.string().min(1),
  parcel_id: z.string().nullable().optional(),
  land_area_id: z.string().nullable().optional(),
  listing_kind: ListingKindSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  asking_price_minor_units: z.number().int().nonnegative().nullable().optional(),
  currency_code: z.string().length(3).nullable().optional(),
  listing_status: ListingStatusSchema.default('draft'),
  listing_visible_publicly: z.boolean().default(true),
  listing_visible_to_tenant_ids: z.array(z.string()).default([]),
  features_jsonb: z.record(z.unknown()).default({}),
  image_urls: z.array(z.string()).default([]),
  contact_method: ContactMethodSchema.default('in_app'),
  created_at: z.string().or(z.date()).optional(),
  updated_at: z.string().or(z.date()).optional(),
  expires_at: z.string().or(z.date()).nullable().optional(),
  sold_at: z.string().or(z.date()).nullable().optional(),
  sold_to_user_id: z.string().nullable().optional(),
});
export type MarketplaceListing = z.infer<typeof MarketplaceListingSchema>;

export const MarketplaceInquirySchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  listing_id: z.string().min(1),
  inquirer_user_id: z.string().min(1),
  inquirer_tenant_id: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
  status: InquiryStatusSchema.default('open'),
  contact_phone: z.string().nullable().optional(),
  created_at: z.string().or(z.date()).optional(),
  replied_at: z.string().or(z.date()).nullable().optional(),
});
export type MarketplaceInquiry = z.infer<typeof MarketplaceInquirySchema>;

export const ActivityLogRowSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  parcel_id: z.string().min(1),
  event_kind: ActivityEventKindSchema,
  event_payload_jsonb: z.record(z.unknown()).default({}),
  actor_user_id: z.string().nullable().optional(),
  actor_persona_id: z.string().nullable().optional(),
  prev_hash: z.string().nullable().optional(),
  hash: z.string().min(1),
  created_at: z.string().or(z.date()).optional(),
});
export type ActivityLogRow = z.infer<typeof ActivityLogRowSchema>;

export const ColorTagSchema = z.object({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9_]*$/, 'tag slug must be lowercase snake_case'),
  display_name: z.string().min(1),
  color_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  meaning: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  created_at: z.string().or(z.date()).optional(),
});
export type ColorTag = z.infer<typeof ColorTagSchema>;

// ────────────────────────────────────────────────────────────────────
// Search filters.
// ────────────────────────────────────────────────────────────────────

export const BoundingBoxSchema = z.object({
  min_lng: z.number().min(-180).max(180),
  min_lat: z.number().min(-90).max(90),
  max_lng: z.number().min(-180).max(180),
  max_lat: z.number().min(-90).max(90),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const MarketplaceSearchFiltersSchema = z.object({
  jurisdiction: z.string().length(2).optional(),
  region: z.string().optional(),
  listing_kind: ListingKindSchema.optional(),
  min_price_minor_units: z.number().int().nonnegative().optional(),
  max_price_minor_units: z.number().int().nonnegative().optional(),
  currency_code: z.string().length(3).optional(),
  min_area_sqm: z.number().nonnegative().optional(),
  max_area_sqm: z.number().nonnegative().optional(),
  zoning: ParcelZoningSchema.optional(),
  bounding_box: BoundingBoxSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});
export type MarketplaceSearchFilters = z.infer<typeof MarketplaceSearchFiltersSchema>;

// ────────────────────────────────────────────────────────────────────
// Errors.
// ────────────────────────────────────────────────────────────────────

export class GeoParcelsError extends Error {
  public override readonly name = 'GeoParcelsError';
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
