/**
 * TZ_LAND_ACT Export Formatter
 *
 * Tanzania Land Act (Cap. 113) compliance fields — periodic register of
 * leases and occupancy information for the Commissioner for Lands. Output
 * is JSON (one root object with the period + entries array) so the schema
 * is self-describing.
 */

export interface TzLandActLeaseEntry {
  readonly leaseId: string;
  readonly titleDeedNumber: string | null;
  readonly plotNumber: string;
  readonly district: string;
  readonly region: string;
  readonly landlordName: string;
  readonly landlordTin: string;
  readonly tenantName: string;
  readonly tenantIdNumber: string;
  readonly leaseType: 'residential' | 'commercial' | 'mixed';
  readonly startDate: string;
  readonly endDate: string;
  /** Gross annual rent, minor units (TZS cents). */
  readonly annualRentMinor: number;
  readonly registeredWithLandsOffice: boolean;
  readonly stampDutyPaid: boolean;
}

export interface TzLandActExportContext {
  readonly filingEntity: string;
  readonly filingEntityTin: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface TzLandActExportEntry {
  readonly leaseId: string;
  readonly titleDeedNumber: string | null;
  readonly plotNumber: string;
  readonly district: string;
  readonly region: string;
  readonly landlordName: string;
  readonly landlordTin: string;
  readonly tenantName: string;
  readonly tenantIdNumber: string;
  readonly leaseType: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly annualRentTzs: number;
  readonly registeredWithLandsOffice: boolean;
  readonly stampDutyPaid: boolean;
  readonly complianceFlag: 'compliant' | 'requires_follow_up';
}

export interface TzLandActExportPayload {
  readonly schemaVersion: string;
  readonly filingEntity: string;
  readonly filingEntityTin: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
  readonly entryCount: number;
  readonly entries: readonly TzLandActExportEntry[];
}

function toMajor(minor: number): number {
  return Math.round(minor) / 100;
}

export function buildTzLandActEntry(
  entry: TzLandActLeaseEntry,
): TzLandActExportEntry {
  const compliant =
    entry.registeredWithLandsOffice &&
    entry.stampDutyPaid &&
    entry.titleDeedNumber != null;
  return {
    leaseId: entry.leaseId,
    titleDeedNumber: entry.titleDeedNumber,
    plotNumber: entry.plotNumber,
    district: entry.district,
    region: entry.region,
    landlordName: entry.landlordName,
    landlordTin: entry.landlordTin,
    tenantName: entry.tenantName,
    tenantIdNumber: entry.tenantIdNumber,
    leaseType: entry.leaseType,
    startDate: entry.startDate,
    endDate: entry.endDate,
    annualRentTzs: toMajor(entry.annualRentMinor),
    registeredWithLandsOffice: entry.registeredWithLandsOffice,
    stampDutyPaid: entry.stampDutyPaid,
    complianceFlag: compliant ? 'compliant' : 'requires_follow_up',
  };
}

export function formatTzLandActJson(
  entries: readonly TzLandActLeaseEntry[],
  context: TzLandActExportContext,
): string {
  const payload: TzLandActExportPayload = {
    schemaVersion: '1.0',
    filingEntity: context.filingEntity,
    filingEntityTin: context.filingEntityTin,
    periodStart: context.periodStart,
    periodEnd: context.periodEnd,
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries: entries.map(buildTzLandActEntry),
  };
  return JSON.stringify(payload, null, 2);
}

export const TZ_LAND_ACT_FORMATTER = {
  id: 'tz_land_act' as const,
  format: formatTzLandActJson,
  buildEntry: buildTzLandActEntry,
};
