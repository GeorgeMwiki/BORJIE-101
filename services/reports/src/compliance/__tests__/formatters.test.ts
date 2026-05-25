/**
 * Unit tests for compliance export formatters.
 *
 * Verifies:
 *   - TZ_TRA: 10% WHT + 18% VAT math + stable CSV header order
 *   - KE_KRA: 7.5% MRI + 16% VAT math + stable CSV header order
 *   - KE_DPA: each JSON-Lines record parseable + controller metadata joined
 *   - TZ_LAND_ACT: compliance flag set correctly
 */

import { describe, it, expect } from 'vitest';
import {
  buildTzTraRow,
  formatTzTraCsv,
  TZ_TRA_FORMATTER,
} from '../tz-tra-formatter.js';
import {
  buildKeKraRow,
  formatKeKraCsv,
  KE_KRA_FORMATTER,
} from '../ke-kra-formatter.js';
import { formatKeDpaJsonLines } from '../ke-dpa-formatter.js';
import {
  buildTzLandActEntry,
  formatTzLandActJson,
} from '../tz-land-act-formatter.js';

describe('TZ_TRA formatter', () => {
  it('applies 10% WHT and 18% VAT correctly', () => {
    const row = buildTzTraRow(
      {
        leaseId: 'L1',
        landlordTin: 'TZ123',
        landlordName: 'ACME Co',
        tenantTin: 'TZ456',
        tenantName: 'Jane',
        propertyAddress: 'Dar-es-Salaam',
        grossRentMinor: 100_000_00, // 100,000.00 TZS
        isCommercial: true,
        paymentDate: '2026-04-01',
      },
      {
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        tenantTin: 'TZ456',
        currency: 'TZS',
      },
    );
    expect(row.grossRent).toBe(100000);
    expect(row.whtAmount).toBe(10000); // 10%
    expect(row.vatAmount).toBe(18000); // 18%
    expect(row.netPayable).toBe(100000 - 10000 + 18000);
  });

  it('skips VAT for residential leases', () => {
    const row = buildTzTraRow(
      {
        leaseId: 'L1',
        landlordTin: 'TZ123',
        landlordName: 'ACME Co',
        tenantTin: 'TZ456',
        tenantName: 'Jane',
        propertyAddress: 'Dar-es-Salaam',
        grossRentMinor: 100_000_00,
        isCommercial: false,
        paymentDate: '2026-04-01',
      },
      {
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        tenantTin: 'TZ456',
        currency: 'TZS',
      },
    );
    expect(row.vatAmount).toBe(0);
  });

  it('emits stable CSV header order', () => {
    const csv = formatTzTraCsv([], {
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      tenantTin: 'TZ456',
      currency: 'TZS',
    });
    expect(csv.split('\n')[0]).toBe(TZ_TRA_FORMATTER.headers.join(','));
  });
});

describe('KE_KRA formatter', () => {
  it('applies 7.5% MRI and 16% VAT correctly', () => {
    const row = buildKeKraRow(
      {
        leaseId: 'L1',
        landlordPin: 'A1',
        landlordName: 'ACME',
        tenantPin: 'A2',
        tenantName: 'Jane',
        propertyAddress: 'Nairobi',
        grossRentMinor: 50_000_00,
        isCommercial: true,
        paymentDate: '2026-04-01',
      },
      {
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
        filerPin: 'A2',
        currency: 'KES',
      },
    );
    expect(row.grossRent).toBe(50000);
    expect(row.mriTax).toBe(3750);
    expect(row.vatAmount).toBe(8000);
    expect(row.netPayable).toBe(50000 - 3750 + 8000);
  });

  it('stable CSV header order', () => {
    const csv = formatKeKraCsv([], {
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
      filerPin: 'A2',
      currency: 'KES',
    });
    expect(csv.split('\n')[0]).toBe(KE_KRA_FORMATTER.headers.join(','));
  });
});

describe('KE_DPA formatter', () => {
  it('each JSON-Lines record is independently parseable', () => {
    const output = formatKeDpaJsonLines(
      [
        {
          recordId: 'r1',
          dataSubjectId: 'cust_1',
          dataSubjectCategory: 'tenant',
          dataCategories: ['name', 'email'],
          purpose: 'Tenant management',
          processingBasis: 'contract',
          consentGiven: true,
          consentGivenAt: '2026-01-01T00:00:00Z',
          retentionPeriodDays: 2555,
          crossBorderTransfers: [],
          processorName: 'internal',
          actionTimestamp: '2026-04-01T00:00:00Z',
          dpiaReference: null,
        },
      ],
      {
        controllerName: 'ACME Ltd',
        controllerRegistrationNumber: 'DPC-12345',
        dpoContactEmail: 'dpo@acme.com',
        periodStart: '2026-04-01',
        periodEnd: '2026-04-30',
      },
    );
    const lines = output.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.controllerName).toBe('ACME Ltd');
    expect(parsed.recordId).toBe('r1');
  });
});

describe('TZ_LAND_ACT formatter', () => {
  it('compliance flag is compliant when all boxes ticked', () => {
    const entry = buildTzLandActEntry({
      leaseId: 'L1',
      titleDeedNumber: 'TD-001',
      plotNumber: 'PLT-42',
      district: 'Kinondoni',
      region: 'Dar-es-Salaam',
      landlordName: 'ACME',
      landlordTin: 'TZ-X',
      tenantName: 'Jane',
      tenantIdNumber: 'NID-1',
      leaseType: 'residential',
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      annualRentMinor: 12_000_000_00,
      registeredWithLandsOffice: true,
      stampDutyPaid: true,
    });
    expect(entry.complianceFlag).toBe('compliant');
    expect(entry.annualRentTzs).toBe(12_000_000);
  });

  it('compliance flag is requires_follow_up when stamp duty unpaid', () => {
    const entry = buildTzLandActEntry({
      leaseId: 'L1',
      titleDeedNumber: 'TD-001',
      plotNumber: 'PLT-42',
      district: 'Kinondoni',
      region: 'Dar-es-Salaam',
      landlordName: 'ACME',
      landlordTin: 'TZ-X',
      tenantName: 'Jane',
      tenantIdNumber: 'NID-1',
      leaseType: 'residential',
      startDate: '2026-01-01',
      endDate: '2027-01-01',
      annualRentMinor: 12_000_000_00,
      registeredWithLandsOffice: true,
      stampDutyPaid: false,
    });
    expect(entry.complianceFlag).toBe('requires_follow_up');
  });

  it('JSON output includes schema version + entries', () => {
    const output = formatTzLandActJson([], {
      filingEntity: 'ACME',
      filingEntityTin: 'TZ-X',
      periodStart: '2026-04-01',
      periodEnd: '2026-04-30',
    });
    const parsed = JSON.parse(output);
    expect(parsed.schemaVersion).toBe('1.0');
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entryCount).toBe(0);
  });
});
