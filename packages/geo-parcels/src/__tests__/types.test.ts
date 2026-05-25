import { describe, expect, it } from 'vitest';

import {
  ActivityEventKindSchema,
  ActivityLogRowSchema,
  BoundingBoxSchema,
  CaptureViaSchema,
  ColorTagSchema,
  ContactMethodSchema,
  EvidenceKindSchema,
  GeoParcelsError,
  InquiryStatusSchema,
  LandAreaSchema,
  ListingKindSchema,
  ListingStatusSchema,
  MarketplaceInquirySchema,
  MarketplaceListingSchema,
  MarketplaceSearchFiltersSchema,
  MetadataValueKindSchema,
  ParcelEvidenceSchema,
  ParcelMetadataSchema,
  ParcelSchema,
  ParcelStatusSchema,
  ParcelZoningSchema,
  PointCoordsSchema,
  PointSchema,
  PolygonSchema,
} from '../types.js';

describe('zod schemas', () => {
  it('PointCoordsSchema rejects out-of-range longitude', () => {
    expect(PointCoordsSchema.safeParse([200, 0]).success).toBe(false);
  });
  it('PointCoordsSchema accepts (39.27, -6.82)', () => {
    expect(PointCoordsSchema.safeParse([39.27, -6.82]).success).toBe(true);
  });

  it('PolygonSchema rejects fewer than 4 ring points', () => {
    expect(
      PolygonSchema.safeParse({
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [0, 1]]],
      }).success,
    ).toBe(false);
  });

  it('PointSchema rejects malformed coordinates', () => {
    expect(PointSchema.safeParse({ type: 'Point', coordinates: [999, 0] }).success).toBe(
      false,
    );
  });

  it('CaptureViaSchema allows all defined values', () => {
    for (const v of ['manual_draw', 'gps_walk', 'gis_import', 'satellite_trace']) {
      expect(CaptureViaSchema.safeParse(v).success).toBe(true);
    }
    expect(CaptureViaSchema.safeParse('drone').success).toBe(false);
  });

  it('ParcelStatusSchema allows all defined values', () => {
    for (const v of ['available', 'reserved', 'leased', 'sold', 'disputed', 'unavailable']) {
      expect(ParcelStatusSchema.safeParse(v).success).toBe(true);
    }
  });

  it('ParcelZoningSchema accepts defined zoning', () => {
    expect(ParcelZoningSchema.safeParse('residential').success).toBe(true);
    expect(ParcelZoningSchema.safeParse('hyperloop').success).toBe(false);
  });

  it('ListingKindSchema enforces enum', () => {
    expect(ListingKindSchema.safeParse('sale').success).toBe(true);
    expect(ListingKindSchema.safeParse('barter').success).toBe(false);
  });

  it('ListingStatusSchema enforces enum', () => {
    expect(ListingStatusSchema.safeParse('draft').success).toBe(true);
    expect(ListingStatusSchema.safeParse('rejected').success).toBe(false);
  });

  it('ContactMethodSchema enforces enum', () => {
    expect(ContactMethodSchema.safeParse('whatsapp').success).toBe(true);
    expect(ContactMethodSchema.safeParse('sms').success).toBe(false);
  });

  it('EvidenceKindSchema enforces enum', () => {
    expect(EvidenceKindSchema.safeParse('title_deed').success).toBe(true);
  });

  it('MetadataValueKindSchema enforces enum', () => {
    expect(MetadataValueKindSchema.safeParse('text').success).toBe(true);
  });

  it('ActivityEventKindSchema enforces enum', () => {
    expect(ActivityEventKindSchema.safeParse('created').success).toBe(true);
  });

  it('InquiryStatusSchema enforces enum', () => {
    expect(InquiryStatusSchema.safeParse('open').success).toBe(true);
  });

  it('BoundingBoxSchema enforces lat/lng ranges', () => {
    expect(
      BoundingBoxSchema.safeParse({
        min_lng: -1,
        min_lat: -1,
        max_lng: 1,
        max_lat: 1,
      }).success,
    ).toBe(true);
    expect(
      BoundingBoxSchema.safeParse({
        min_lng: -200,
        min_lat: 0,
        max_lng: 1,
        max_lat: 1,
      }).success,
    ).toBe(false);
  });

  it('LandAreaSchema accepts a minimal valid object', () => {
    const result = LandAreaSchema.safeParse({
      id: 'la1',
      tenant_id: 't1',
      display_name: 'X',
      boundary_polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      center_point: { type: 'Point', coordinates: [0.5, 0.5] },
      jurisdiction: 'TZ',
      captured_via: 'gps_walk',
      captured_by_user_id: 'u1',
    });
    expect(result.success).toBe(true);
  });

  it('ParcelSchema accepts minimal + rejects bad color_hex', () => {
    const baseParcel = {
      id: 'p1',
      tenant_id: 't1',
      land_area_id: 'la1',
      display_name: 'A',
      boundary_polygon: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
      center_point: { type: 'Point', coordinates: [0.5, 0.5] },
      status: 'available' as const,
    };
    expect(ParcelSchema.safeParse(baseParcel).success).toBe(true);
    expect(
      ParcelSchema.safeParse({ ...baseParcel, color_hex: 'bad' }).success,
    ).toBe(false);
  });

  it('ParcelMetadataSchema requires snake_case key', () => {
    const ok = ParcelMetadataSchema.safeParse({
      id: 'm1',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'soil_type',
      value_kind: 'text',
      value_jsonb: { value: 'loam' },
    });
    expect(ok.success).toBe(true);
    const bad = ParcelMetadataSchema.safeParse({
      id: 'm1',
      tenant_id: 't1',
      parcel_id: 'p1',
      key: 'Soil-Type',
      value_kind: 'text',
      value_jsonb: { value: 'loam' },
    });
    expect(bad.success).toBe(false);
  });

  it('ParcelEvidenceSchema enforces trust_score range', () => {
    expect(
      ParcelEvidenceSchema.safeParse({
        id: 'e1',
        tenant_id: 't1',
        parcel_id: 'p1',
        evidence_kind: 'title_deed',
        trust_score: 2,
      }).success,
    ).toBe(false);
  });

  it('MarketplaceListingSchema enforces 3-char currency_code', () => {
    expect(
      MarketplaceListingSchema.safeParse({
        id: 'l1',
        tenant_id: 't1',
        listed_by_user_id: 'u1',
        listing_kind: 'sale',
        title: 'X',
        description: 'X',
        currency_code: 'KES',
      }).success,
    ).toBe(true);
    expect(
      MarketplaceListingSchema.safeParse({
        id: 'l1',
        tenant_id: 't1',
        listed_by_user_id: 'u1',
        listing_kind: 'sale',
        title: 'X',
        description: 'X',
        currency_code: 'XX',
      }).success,
    ).toBe(false);
  });

  it('MarketplaceInquirySchema accepts cross-tenant inquirer', () => {
    expect(
      MarketplaceInquirySchema.safeParse({
        id: 'i1',
        tenant_id: 'tA',
        listing_id: 'l1',
        inquirer_user_id: 'u1',
        inquirer_tenant_id: 'tB',
      }).success,
    ).toBe(true);
  });

  it('ActivityLogRowSchema requires hash', () => {
    expect(
      ActivityLogRowSchema.safeParse({
        id: 'a1',
        tenant_id: 't1',
        parcel_id: 'p1',
        event_kind: 'created',
        hash: 'abc',
      }).success,
    ).toBe(true);
    expect(
      ActivityLogRowSchema.safeParse({
        id: 'a1',
        tenant_id: 't1',
        parcel_id: 'p1',
        event_kind: 'created',
      }).success,
    ).toBe(false);
  });

  it('ColorTagSchema enforces hex + slug', () => {
    expect(
      ColorTagSchema.safeParse({
        id: 'c1',
        tenant_id: 't1',
        slug: 'in_negotiation',
        display_name: 'In negotiation',
        color_hex: '#FF5722',
      }).success,
    ).toBe(true);
    expect(
      ColorTagSchema.safeParse({
        id: 'c1',
        tenant_id: 't1',
        slug: 'BAD-SLUG',
        display_name: 'x',
        color_hex: '#FF5722',
      }).success,
    ).toBe(false);
  });

  it('MarketplaceSearchFiltersSchema applies defaults for limit/offset', () => {
    const result = MarketplaceSearchFiltersSchema.parse({});
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('MarketplaceSearchFiltersSchema caps limit at 100', () => {
    expect(
      MarketplaceSearchFiltersSchema.safeParse({ limit: 200 }).success,
    ).toBe(false);
  });
});

describe('GeoParcelsError', () => {
  it('carries a code', () => {
    const err = new GeoParcelsError('SOME_CODE', 'a message');
    expect(err.code).toBe('SOME_CODE');
    expect(err.message).toBe('a message');
    expect(err.name).toBe('GeoParcelsError');
    expect(err).toBeInstanceOf(Error);
  });
});
