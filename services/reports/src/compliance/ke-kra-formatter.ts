/**
 * KE_KRA Export Formatter
 *
 * Kenya Revenue Authority — rental income tax schedule for the annual (or
 * monthly for Monthly Rental Income Tax, MRI) return.
 *
 *  - MRI tax rate: sourced from @borjie/compliance-plugins Kenya
 *    TaxRegimePort (canonical 7.5% per Finance Act 2024). Never hardcode
 *    tax rates — the plugin is the single source of truth so a future
 *    rate change is one edit away in the plugin, not a sprawl of constants.
 *  - VAT: sourced from getJurisdictionalRules('KE').taxAuthority.vatRatePct
 *    (currently 16%) on applicable commercial rentals.
 *
 * Output: CSV matching the iTax template columns commonly expected for
 * rental income.
 */

import { getJurisdictionalRules } from '@borjie/domain-models';

export interface KeKraRentEntry {
  readonly leaseId: string;
  readonly landlordPin: string;
  readonly landlordName: string;
  readonly tenantPin: string | null;
  readonly tenantName: string;
  readonly propertyAddress: string;
  /** Gross rent paid during the period (minor units, KES cents). */
  readonly grossRentMinor: number;
  readonly isCommercial: boolean;
  readonly paymentDate: string;
}

export interface KeKraExportContext {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly filerPin: string;
  readonly currency: 'KES';
}

export interface KeKraExportRow {
  readonly leaseId: string;
  readonly landlordPin: string;
  readonly landlordName: string;
  readonly tenantPin: string;
  readonly tenantName: string;
  readonly propertyAddress: string;
  readonly grossRent: number;
  readonly mriTax: number;
  readonly vatAmount: number;
  readonly netPayable: number;
  readonly paymentDate: string;
}

// MRI rate: 7.5% per Kenya Finance Act 2024 (Monthly Rental Income tax).
//
// NOTE: The KE plugin's taxRegime.calculateWithholding() represents KRA
// mineral-payment withholding (5% on gross mineral value per KRA-WHT-MINERAL)
// which is a DIFFERENT tax instrument from MRI. After the property→mining
// domain migration the plugin's calculateWithholding surface changed meaning;
// deriving MRI rate from it would yield the wrong 5% figure.
// The canonical MRI rate is a legislated constant (Finance Act 2024, Third
// Schedule Part B) — it does not vary by mine type or operation; only a
// Finance Act amendment changes it. So we declare it as a named constant here
// (the single place to update it on a Finance Act change).
const MRI_RATE = 0.075; // 7.5% Finance Act 2024
const VAT_RATE = getJurisdictionalRules('KE').taxAuthority.vatRatePct / 100;

function toMajor(minor: number): number {
  return Math.round(minor) / 100;
}

export function buildKeKraRow(
  entry: KeKraRentEntry,
  context: KeKraExportContext,
): KeKraExportRow {
  const gross = toMajor(entry.grossRentMinor);
  const mri = Math.round(gross * MRI_RATE * 100) / 100;
  const vat = entry.isCommercial
    ? Math.round(gross * VAT_RATE * 100) / 100
    : 0;
  const net = Math.round((gross - mri + vat) * 100) / 100;
  return {
    leaseId: entry.leaseId,
    landlordPin: entry.landlordPin,
    landlordName: entry.landlordName,
    tenantPin: entry.tenantPin ?? context.filerPin,
    tenantName: entry.tenantName,
    propertyAddress: entry.propertyAddress,
    grossRent: gross,
    mriTax: mri,
    vatAmount: vat,
    netPayable: net,
    paymentDate: entry.paymentDate,
  };
}

const KE_KRA_HEADERS = [
  'LeaseId',
  'LandlordPIN',
  'LandlordName',
  'TenantPIN',
  'TenantName',
  'PropertyAddress',
  'GrossRent_KES',
  'MRI_7_5Pct_KES',
  'VAT_16Pct_KES',
  'NetPayable_KES',
  'PaymentDate',
] as const;

function escapeCsv(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function formatKeKraCsv(
  entries: readonly KeKraRentEntry[],
  context: KeKraExportContext,
): string {
  const lines: string[] = [];
  lines.push(KE_KRA_HEADERS.join(','));
  for (const entry of entries) {
    const row = buildKeKraRow(entry, context);
    lines.push(
      [
        row.leaseId,
        row.landlordPin,
        row.landlordName,
        row.tenantPin,
        row.tenantName,
        row.propertyAddress,
        row.grossRent.toFixed(2),
        row.mriTax.toFixed(2),
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

export const KE_KRA_FORMATTER = {
  id: 'ke_kra' as const,
  headers: KE_KRA_HEADERS,
  mriRate: MRI_RATE,
  vatRate: VAT_RATE,
  format: formatKeKraCsv,
  buildRow: buildKeKraRow,
};
