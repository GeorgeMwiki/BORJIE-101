/**
 * Generic expiry watchers — vehicle insurance, vehicle roadworthiness,
 * TZ road licence (TRA), TZ NIT inspection certificate.
 *
 * Each watcher takes an array of vehicle compliance records + the
 * `asOfIso` date and returns `ComplianceAlert`s at the 90/30/7-day
 * threshold (matching the driver-license watcher).
 *
 * The watchers are jurisdiction-aware via the optional `jurisdiction`
 * field on every alert; downstream renderers (notifications, dashboard)
 * can localise the message accordingly.
 */

import { type ComplianceAlert, type ComplianceKind, type IsoDate } from '../types.js';

export interface VehicleComplianceRecord {
  readonly vehicleId: string;
  readonly tenantId: string;
  readonly insuranceExpiresAt?: IsoDate;
  readonly roadworthinessExpiresAt?: IsoDate;
  readonly roadLicenceExpiresAt?: IsoDate;       // TZ TRA / KE NTSA
  readonly nitInspectionExpiresAt?: IsoDate;     // TZ National Institute of Transport
  readonly jurisdiction?: string;                // ISO country code
}

export const DEFAULT_REMINDERS_DAYS = Object.freeze([90, 30, 7] as const);

function daysBetween(fromIso: string, toIso: string): number {
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new Error(`Invalid date(s): from=${fromIso} to=${toIso}`);
  }
  return Math.floor((toMs - fromMs) / (24 * 3_600_000));
}

function severity(daysUntil: number): 'info' | 'warn' | 'critical' {
  if (daysUntil < 0) return 'critical';
  if (daysUntil <= 7) return 'critical';
  if (daysUntil <= 30) return 'warn';
  return 'info';
}

function maybeAlert(
  kind: ComplianceKind,
  record: VehicleComplianceRecord,
  expiresAt: IsoDate | undefined,
  asOfIso: string,
  thresholds: ReadonlyArray<number>,
  label: string,
): ComplianceAlert | null {
  if (!expiresAt) return null;
  const days = daysBetween(asOfIso, expiresAt);
  if (days >= 0) {
    const matched = thresholds.find((t) => days <= t);
    if (matched === undefined) return null;
  }
  const sev = severity(days);
  const message = days < 0
    ? `Vehicle ${record.vehicleId} ${label} expired ${Math.abs(days)} day(s) ago`
    : `Vehicle ${record.vehicleId} ${label} expires in ${days} day(s)`;
  return {
    kind,
    subjectId: record.vehicleId,
    subjectKind: 'vehicle',
    tenantId: record.tenantId,
    expiresOn: expiresAt,
    daysUntilExpiry: days,
    severity: sev,
    message,
    ...(record.jurisdiction ? { jurisdiction: record.jurisdiction } : {}),
  };
}

export function scanInsuranceExpiries(
  records: ReadonlyArray<VehicleComplianceRecord>,
  asOfIso: string,
  thresholds: ReadonlyArray<number> = DEFAULT_REMINDERS_DAYS,
): ReadonlyArray<ComplianceAlert> {
  const alerts: ComplianceAlert[] = [];
  for (const r of records) {
    const a = maybeAlert('vehicle_insurance_expiry', r, r.insuranceExpiresAt, asOfIso, thresholds, 'insurance');
    if (a) alerts.push(a);
  }
  return alerts;
}

export function scanRoadworthinessExpiries(
  records: ReadonlyArray<VehicleComplianceRecord>,
  asOfIso: string,
  thresholds: ReadonlyArray<number> = DEFAULT_REMINDERS_DAYS,
): ReadonlyArray<ComplianceAlert> {
  const alerts: ComplianceAlert[] = [];
  for (const r of records) {
    const a = maybeAlert('vehicle_roadworthiness_expiry', r, r.roadworthinessExpiresAt, asOfIso, thresholds, 'roadworthiness certificate');
    if (a) alerts.push(a);
  }
  return alerts;
}

export function scanRoadLicenceExpiries(
  records: ReadonlyArray<VehicleComplianceRecord>,
  asOfIso: string,
  thresholds: ReadonlyArray<number> = DEFAULT_REMINDERS_DAYS,
): ReadonlyArray<ComplianceAlert> {
  const alerts: ComplianceAlert[] = [];
  for (const r of records) {
    // Only emit for jurisdictions where this concept applies.
    const j = r.jurisdiction?.toUpperCase();
    if (j && !['TZ', 'KE', 'UG', 'RW'].includes(j)) continue;
    const a = maybeAlert('vehicle_road_licence_expiry', r, r.roadLicenceExpiresAt, asOfIso, thresholds, 'road licence');
    if (a) alerts.push(a);
  }
  return alerts;
}

export function scanNitInspectionExpiries(
  records: ReadonlyArray<VehicleComplianceRecord>,
  asOfIso: string,
  thresholds: ReadonlyArray<number> = DEFAULT_REMINDERS_DAYS,
): ReadonlyArray<ComplianceAlert> {
  const alerts: ComplianceAlert[] = [];
  for (const r of records) {
    // Only relevant in TZ.
    if (r.jurisdiction?.toUpperCase() && r.jurisdiction.toUpperCase() !== 'TZ') continue;
    const a = maybeAlert('vehicle_nit_inspection_expiry', r, r.nitInspectionExpiresAt, asOfIso, thresholds, 'NIT inspection');
    if (a) alerts.push(a);
  }
  return alerts;
}

/** Convenience — runs all four scans in a single pass. */
export function scanAllVehicleCompliance(
  records: ReadonlyArray<VehicleComplianceRecord>,
  asOfIso: string,
  thresholds: ReadonlyArray<number> = DEFAULT_REMINDERS_DAYS,
): ReadonlyArray<ComplianceAlert> {
  return [
    ...scanInsuranceExpiries(records, asOfIso, thresholds),
    ...scanRoadworthinessExpiries(records, asOfIso, thresholds),
    ...scanRoadLicenceExpiries(records, asOfIso, thresholds),
    ...scanNitInspectionExpiries(records, asOfIso, thresholds),
  ];
}
