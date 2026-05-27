import { describe, expect, it } from 'vitest';
import { resolveCustomerDistrict } from '../routing/district-resolver.js';
import type { CustomerLocation, OrgUnitServiceArea } from '../types.js';

const DSM_DISTRICT: OrgUnitServiceArea = {
  org_unit_id: 'unit-dsm',
  tenant_id: 't1',
  area_kind: 'station_radius',
  station_coords: { lat: -6.7924, lng: 39.2083 },
  station_radius_km: 50,
  administrative_codes: ['TZ-DSM'],
  priority: 10,
};

const ARUSHA_DISTRICT: OrgUnitServiceArea = {
  org_unit_id: 'unit-arusha',
  tenant_id: 't1',
  area_kind: 'station_radius',
  station_coords: { lat: -3.3869, lng: 36.683 },
  station_radius_km: 80,
  administrative_codes: ['TZ-AR'],
  priority: 10,
};

const MWANZA_DISTRICT: OrgUnitServiceArea = {
  org_unit_id: 'unit-mwanza',
  tenant_id: 't1',
  area_kind: 'station_radius',
  station_coords: { lat: -2.5164, lng: 32.9175 },
  station_radius_km: 80,
  administrative_codes: ['TZ-MW'],
  priority: 10,
};

const ALL_DISTRICTS = [DSM_DISTRICT, ARUSHA_DISTRICT, MWANZA_DISTRICT];

const NOW = '2026-05-26T12:00:00.000Z';

describe('resolveCustomerDistrict', () => {
  it('routes a Dar es Salaam customer to the DSM district', () => {
    const customer: CustomerLocation = {
      customer_id: 'c-1',
      tenant_id: 't1',
      source: 'gps',
      coordinates: { lat: -6.8, lng: 39.25 },
      recorded_at: NOW,
    };
    const a = resolveCustomerDistrict(customer, ALL_DISTRICTS, { nowIso: NOW });
    expect(a.assigned_org_unit_id).toBe('unit-dsm');
    expect(a.assignment_kind).toBe('auto_geo');
    expect(a.distance_km).toBeDefined();
    expect(a.audit_hash.length).toBeGreaterThan(10);
  });

  it('routes an Arusha customer to the Arusha district', () => {
    const customer: CustomerLocation = {
      customer_id: 'c-2',
      tenant_id: 't1',
      source: 'gps',
      coordinates: { lat: -3.39, lng: 36.69 },
      recorded_at: NOW,
    };
    const a = resolveCustomerDistrict(customer, ALL_DISTRICTS, { nowIso: NOW });
    expect(a.assigned_org_unit_id).toBe('unit-arusha');
  });

  it('falls back to manual_unassigned for a customer outside all service areas', () => {
    const customer: CustomerLocation = {
      customer_id: 'c-3',
      tenant_id: 't1',
      source: 'gps',
      coordinates: { lat: -1.286, lng: 36.817 }, // Nairobi, Kenya
      recorded_at: NOW,
    };
    const a = resolveCustomerDistrict(customer, ALL_DISTRICTS, { nowIso: NOW });
    expect(a.assigned_org_unit_id).toBeNull();
    expect(a.assignment_kind).toBe('manual_unassigned');
    expect(a.reasoning).toContain('no district');
  });

  it('matches via administrative code when coords are absent', () => {
    const customer: CustomerLocation = {
      customer_id: 'c-4',
      tenant_id: 't1',
      source: 'self_declared',
      administrative_code: 'TZ-MW',
      recorded_at: NOW,
    };
    const a = resolveCustomerDistrict(customer, ALL_DISTRICTS, { nowIso: NOW });
    expect(a.assigned_org_unit_id).toBe('unit-mwanza');
    expect(a.distance_km).toBeUndefined();
  });

  it('produces a deterministic audit hash for identical inputs', () => {
    const customer: CustomerLocation = {
      customer_id: 'c-5',
      tenant_id: 't1',
      source: 'gps',
      coordinates: { lat: -6.8, lng: 39.25 },
      recorded_at: NOW,
    };
    const a = resolveCustomerDistrict(customer, ALL_DISTRICTS, { nowIso: NOW });
    const b = resolveCustomerDistrict(customer, ALL_DISTRICTS, { nowIso: NOW });
    expect(a.audit_hash).toBe(b.audit_hash);
  });
});
