/**
 * License + medical cert expiry watcher.
 *
 * For a set of drivers + a reference date, returns the list of
 * compliance alerts that should fire at the 90/30/7-day thresholds and
 * any already-expired entries.
 *
 * Pure function — no I/O. The api-gateway scheduler loads drivers from
 * Postgres, hands them to `scanLicenseExpiries`, then forwards alerts
 * to the notifications service.
 */

import { type Driver, type ComplianceAlert } from '../types.js';

/** Standard reminder horizons (days before expiry). */
export const DEFAULT_REMINDERS_DAYS = Object.freeze([90, 30, 7] as const);

function daysBetween(fromIso: string, toIso: string): number {
  // toIso may be a YYYY-MM-DD or full ISO; both parse to a sensible UTC date.
  const fromMs = Date.parse(fromIso);
  const toMs = Date.parse(toIso);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    throw new Error(`Invalid date(s): from=${fromIso} to=${toIso}`);
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.floor((toMs - fromMs) / dayMs);
}

function severityForDays(daysUntil: number): 'info' | 'warn' | 'critical' {
  if (daysUntil < 0) return 'critical';
  if (daysUntil <= 7) return 'critical';
  if (daysUntil <= 30) return 'warn';
  return 'info';
}

export interface ScanOptions {
  readonly reminderDaysAhead?: ReadonlyArray<number>;
  readonly jurisdiction?: string;
}

export function scanLicenseExpiries(
  drivers: ReadonlyArray<Driver>,
  asOfIso: string,
  options: ScanOptions = {},
): ReadonlyArray<ComplianceAlert> {
  const thresholds = options.reminderDaysAhead ?? DEFAULT_REMINDERS_DAYS;
  const sorted = [...thresholds].sort((a, b) => a - b);

  const alerts: ComplianceAlert[] = [];
  for (const driver of drivers) {
    const days = daysBetween(asOfIso, driver.licenseExpiresAt);
    if (days < 0) {
      alerts.push({
        kind: 'driver_license_expiry',
        subjectId: driver.id,
        subjectKind: 'driver',
        tenantId: driver.tenantId,
        expiresOn: driver.licenseExpiresAt,
        daysUntilExpiry: days,
        severity: 'critical',
        message: `Driver ${driver.id} licence expired ${Math.abs(days)} day(s) ago`,
        ...(options.jurisdiction ? { jurisdiction: options.jurisdiction } : {}),
      });
    } else {
      const matching = sorted.find((t) => days <= t);
      if (matching !== undefined) {
        alerts.push({
          kind: 'driver_license_expiry',
          subjectId: driver.id,
          subjectKind: 'driver',
          tenantId: driver.tenantId,
          expiresOn: driver.licenseExpiresAt,
          daysUntilExpiry: days,
          severity: severityForDays(days),
          message: `Driver ${driver.id} licence expires in ${days} day(s)`,
          ...(options.jurisdiction ? { jurisdiction: options.jurisdiction } : {}),
        });
      }
    }

    if (driver.hasMedicalCert && driver.certExpiresAt) {
      const certDays = daysBetween(asOfIso, driver.certExpiresAt);
      if (certDays < 0) {
        alerts.push({
          kind: 'driver_medical_cert_expiry',
          subjectId: driver.id,
          subjectKind: 'driver',
          tenantId: driver.tenantId,
          expiresOn: driver.certExpiresAt,
          daysUntilExpiry: certDays,
          severity: 'critical',
          message: `Driver ${driver.id} medical certificate expired ${Math.abs(certDays)} day(s) ago`,
          ...(options.jurisdiction ? { jurisdiction: options.jurisdiction } : {}),
        });
      } else {
        const m = sorted.find((t) => certDays <= t);
        if (m !== undefined) {
          alerts.push({
            kind: 'driver_medical_cert_expiry',
            subjectId: driver.id,
            subjectKind: 'driver',
            tenantId: driver.tenantId,
            expiresOn: driver.certExpiresAt,
            daysUntilExpiry: certDays,
            severity: severityForDays(certDays),
            message: `Driver ${driver.id} medical cert expires in ${certDays} day(s)`,
            ...(options.jurisdiction ? { jurisdiction: options.jurisdiction } : {}),
          });
        }
      }
    }
  }
  return alerts;
}
