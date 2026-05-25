/**
 * Compliance watchers — fire at 90/30/7 day boundaries; jurisdiction
 * gating for TZ-only checks.
 */
import { describe, it, expect } from 'vitest';
import {
  scanInsuranceExpiries,
  scanRoadworthinessExpiries,
  scanRoadLicenceExpiries,
  scanNitInspectionExpiries,
  scanAllVehicleCompliance,
  type VehicleComplianceRecord,
} from '../compliance/expiry-watchers.js';

const TENANT = 'tnt-1';

describe('compliance / insurance', () => {
  it('emits critical when already expired', () => {
    const records: VehicleComplianceRecord[] = [
      { vehicleId: 'v1', tenantId: TENANT, insuranceExpiresAt: '2026-04-01' },
    ];
    const alerts = scanInsuranceExpiries(records, '2026-05-24');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('critical');
    expect(alerts[0]?.daysUntilExpiry).toBeLessThan(0);
  });

  it('emits warn at 30-day threshold', () => {
    const records: VehicleComplianceRecord[] = [
      { vehicleId: 'v1', tenantId: TENANT, insuranceExpiresAt: '2026-06-15' },
    ];
    const alerts = scanInsuranceExpiries(records, '2026-05-24');
    expect(alerts[0]?.severity).toBe('warn');
  });

  it('emits info at 90-day threshold', () => {
    const records: VehicleComplianceRecord[] = [
      { vehicleId: 'v1', tenantId: TENANT, insuranceExpiresAt: '2026-08-20' },
    ];
    const alerts = scanInsuranceExpiries(records, '2026-05-24');
    expect(alerts[0]?.severity).toBe('info');
  });

  it('no alert further than 90 days out', () => {
    const records: VehicleComplianceRecord[] = [
      { vehicleId: 'v1', tenantId: TENANT, insuranceExpiresAt: '2027-01-01' },
    ];
    expect(scanInsuranceExpiries(records, '2026-05-24')).toHaveLength(0);
  });
});

describe('compliance / roadworthiness', () => {
  it('honours warn threshold', () => {
    const records: VehicleComplianceRecord[] = [
      { vehicleId: 'v1', tenantId: TENANT, roadworthinessExpiresAt: '2026-06-15' },
    ];
    expect(scanRoadworthinessExpiries(records, '2026-05-24')[0]?.severity).toBe('warn');
  });
});

describe('compliance / road licence (TZ TRA)', () => {
  it('only emits for TZ/KE/UG/RW jurisdictions', () => {
    const records: VehicleComplianceRecord[] = [
      { vehicleId: 'v1', tenantId: TENANT, roadLicenceExpiresAt: '2026-06-01', jurisdiction: 'TZ' },
      { vehicleId: 'v2', tenantId: TENANT, roadLicenceExpiresAt: '2026-06-01', jurisdiction: 'GB' },
    ];
    const alerts = scanRoadLicenceExpiries(records, '2026-05-24');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.subjectId).toBe('v1');
    expect(alerts[0]?.jurisdiction).toBe('TZ');
  });
});

describe('compliance / NIT inspection', () => {
  it('only emits in TZ', () => {
    const records: VehicleComplianceRecord[] = [
      { vehicleId: 'v1', tenantId: TENANT, nitInspectionExpiresAt: '2026-06-01', jurisdiction: 'TZ' },
      { vehicleId: 'v2', tenantId: TENANT, nitInspectionExpiresAt: '2026-06-01', jurisdiction: 'KE' },
    ];
    const alerts = scanNitInspectionExpiries(records, '2026-05-24');
    expect(alerts).toHaveLength(1);
  });
});

describe('compliance / scanAll combines all watchers', () => {
  it('returns alerts across every kind', () => {
    const records: VehicleComplianceRecord[] = [
      {
        vehicleId: 'v1', tenantId: TENANT, jurisdiction: 'TZ',
        insuranceExpiresAt: '2026-06-01',
        roadworthinessExpiresAt: '2026-06-01',
        roadLicenceExpiresAt: '2026-06-01',
        nitInspectionExpiresAt: '2026-06-01',
      },
    ];
    const alerts = scanAllVehicleCompliance(records, '2026-05-24');
    const kinds = new Set(alerts.map((a) => a.kind));
    expect(kinds.size).toBe(4);
  });
});
