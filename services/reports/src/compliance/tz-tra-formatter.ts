/**
 * TZ_TRA Export Formatter
 *
 * Tanzania Revenue Authority — monthly remittance of rental withholding tax.
 *
 *  - Withholding tax (WHT) on rent: 10% of gross rent
 *  - VAT: sourced from getJurisdictionalRules('TZ').taxAuthority.vatRatePct
 *    (currently 18%) on applicable commercial rentals
 *
 * Format: CSV with fixed header columns so the row layout can be validated
 * against the TRA template. Amounts are in Tanzanian Shillings (TZS), no
 * decimals (minor units are converted to major units here).
 */

import { getJurisdictionalRules } from '@borjie/domain-models';

export interface TzTraRentEntry {
  readonly leaseId: string;
  readonly landlordTin: string;
  readonly landlordName: string;
  readonly tenantTin: string | null;
  readonly tenantName: string;
  readonly propertyAddress: string;
  /** Gross rent paid during the period (minor units, TZS cents). */
  readonly grossRentMinor: number;
  /** VAT-applicable (commercial) — true => 18% VAT applies. */
  readonly isCommercial: boolean;
  readonly paymentDate: string; // ISO 8601
}

export interface TzTraExportContext {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly tenantTin: string; // SaaS tenant / company TIN
  readonly currency: 'TZS';
}

export interface TzTraExportRow {
  readonly leaseId: string;
  readonly landlordTin: string;
  readonly landlordName: string;
  readonly tenantTin: string;
  readonly tenantName: string;
  readonly propertyAddress: string;
  readonly grossRent: number;
  readonly whtAmount: number;
  readonly vatAmount: number;
  readonly netPayable: number;
  readonly paymentDate: string;
}

const WHT_RATE = 0.1;
const VAT_RATE = getJurisdictionalRules('TZ').taxAuthority.vatRatePct / 100;

function toMajor(minor: number): number {
  return Math.round(minor) / 100;
}

export function buildTzTraRow(
  entry: TzTraRentEntry,
  context: TzTraExportContext,
): TzTraExportRow {
  const gross = toMajor(entry.grossRentMinor);
  const wht = Math.round(gross * WHT_RATE * 100) / 100;
  const vat = entry.isCommercial
    ? Math.round(gross * VAT_RATE * 100) / 100
    : 0;
  const net = Math.round((gross - wht + vat) * 100) / 100;
  return {
    leaseId: entry.leaseId,
    landlordTin: entry.landlordTin,
    landlordName: entry.landlordName,
    tenantTin: entry.tenantTin ?? context.tenantTin,
    tenantName: entry.tenantName,
    propertyAddress: entry.propertyAddress,
    grossRent: gross,
    whtAmount: wht,
    vatAmount: vat,
    netPayable: net,
    paymentDate: entry.paymentDate,
  };
}

const TZ_TRA_HEADERS = [
  'LeaseId',
  'LandlordTIN',
  'LandlordName',
  'TenantTIN',
  'TenantName',
  'PropertyAddress',
  'GrossRent_TZS',
  'WHT_10Pct_TZS',
  'VAT_18Pct_TZS',
  'NetPayable_TZS',
  'PaymentDate',
] as const;

function escapeCsv(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function formatTzTraCsv(
  entries: readonly TzTraRentEntry[],
  context: TzTraExportContext,
): string {
  const lines: string[] = [];
  lines.push(TZ_TRA_HEADERS.join(','));
  for (const entry of entries) {
    const row = buildTzTraRow(entry, context);
    lines.push(
      [
        row.leaseId,
        row.landlordTin,
        row.landlordName,
        row.tenantTin,
        row.tenantName,
        row.propertyAddress,
        row.grossRent.toFixed(2),
        row.whtAmount.toFixed(2),
        row.vatAmount.toFixed(2),
        row.netPayable.toFixed(2),
        row.paymentDate,
      ]
        .map(escapeCsv)
        .join(','),
    );
  }
  return lines.join('\n');
}

export const TZ_TRA_FORMATTER = {
  id: 'tz_tra' as const,
  headers: TZ_TRA_HEADERS,
  whtRate: WHT_RATE,
  vatRate: VAT_RATE,
  format: formatTzTraCsv,
  buildRow: buildTzTraRow,
};
