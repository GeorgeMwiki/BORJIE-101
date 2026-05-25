/**
 * TaxFilingPort — produces regulator-ready filing payloads.
 *
 * Each country plugin decides its own wire-format (csv / xml / json) and
 * target regulator. Generic countries fall back to a plain CSV with
 * `targetRegulator: 'GENERIC'`.
 *
 * The port is format-agnostic on purpose — the consumer of the payload
 * (API gateway, compliance service) handles signing, upload, retries.
 */

import type { TaxPeriod } from './tax-regime.port.js';

/** Supported wire formats. */
export type FilingFormat = 'csv' | 'xml' | 'json';

/** Minimal tenant-profile shape that every filing implementation can rely on. */
export interface TenantProfileForFiling {
  /** Stable tenant (platform-customer) id. */
  readonly tenantId: string;
  /** Landlord / taxpayer ID (e.g. KRA PIN, EIN). */
  readonly taxpayerId: string;
  /** Legal entity name on the filing. */
  readonly legalName: string;
  /** ISO-3166-1 alpha-2 country code. */
  readonly countryCode: string;
  /** Optional free-form address block printed on the filing. */
  readonly address?: string;
  /** Optional VAT-registration number (for combined MRI+VAT filings). */
  readonly vatNumber?: string | null;
}

/** A single rental-income line item. Minor-unit integer amounts. */
export interface FilingLineItem {
  readonly leaseId: string;
  readonly tenantName: string;
  readonly propertyReference: string;
  readonly grossRentMinorUnits: number;
  readonly withholdingMinorUnits: number;
  readonly currency: string;
  /** ISO-8601 date string, e.g. '2026-03-28'. */
  readonly paymentDate: string;
}

/** Input passed by the consumer at filing time. */
export interface FilingRun {
  readonly runId: string;
  readonly lineItems: readonly FilingLineItem[];
  /** Sum of `grossRentMinorUnits` across all line items. */
  readonly totalGrossMinorUnits: number;
  /** Sum of `withholdingMinorUnits` across all line items. */
  readonly totalWithholdingMinorUnits: number;
}

export interface FilingResult {
  /** Wire format of `payload`. */
  readonly filingFormat: FilingFormat;
  /** Serialised payload — CSV string, XML string, or JSON string. */
  readonly payload: string;
  /** Target regulator short-name (e.g. 'KRA', 'HMRC', 'IRS', 'GENERIC'). */
  readonly targetRegulator: string;
  /**
   * Hint for the submission service — URL or endpoint ID of the regulator
   * portal. `null` when the filing must be submitted by hand.
   */
  readonly submitEndpointHint: string | null;
  /**
   * Free-form guidance string; callers render this alongside the payload in
   * the compliance dashboard.
   */
  readonly instructions?: string;
}

export interface TaxFilingPort {
  prepareFiling(
    run: FilingRun,
    tenantProfile: TenantProfileForFiling,
    period: TaxPeriod
  ): FilingResult;
}

// ---------------------------------------------------------------------------
// Generic CSV fallback — every country with no bespoke format uses this.
// ---------------------------------------------------------------------------

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatPeriodLabel(period: TaxPeriod): string {
  if (period.kind === 'month' && period.month) {
    return `${period.year}-${String(period.month).padStart(2, '0')}`;
  }
  if (period.kind === 'quarter' && period.quarter) {
    return `${period.year}-Q${period.quarter}`;
  }
  return String(period.year);
}

export function buildGenericCsvPayload(run: FilingRun): string {
  const header = [
    'lease_id',
    'tenant_name',
    'property_reference',
    'gross_rent_minor',
    'withholding_minor',
    'currency',
    'payment_date',
  ].join(',');
  const rows = run.lineItems.map((li) =>
    [
      csvEscape(li.leaseId),
      csvEscape(li.tenantName),
      csvEscape(li.propertyReference),
      String(li.grossRentMinorUnits),
      String(li.withholdingMinorUnits),
      csvEscape(li.currency),
      csvEscape(li.paymentDate),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/** Default — CSV / GENERIC regulator, no submission endpoint. */
export const DEFAULT_TAX_FILING: TaxFilingPort = {
  prepareFiling(run, tenantProfile, period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'GENERIC',
      submitEndpointHint: null,
      instructions:
        `Generic rental-income filing for ${tenantProfile.legalName} ` +
        `(${tenantProfile.countryCode}) — period ${formatPeriodLabel(period)}. ` +
        `No regulator-specific format configured; submit manually.`,
    };
  },
};

export { formatPeriodLabel as formatFilingPeriodLabel };

// ---------------------------------------------------------------------------
// Round-3 audit H21 — per-country format builders.
//
// The audit observed that every country plugin was shipping
// `buildGenericCsvPayload(run)` regardless of what the actual
// regulator accepted. KRA's iTax MRI return is XML / structured upload,
// not free-form CSV. Until each plugin wires a real builder we now ship
// at least a structured-XML option for KRA so dashboards can render
// the right shape and the submission-service can target the real
// iTax endpoint.
// ---------------------------------------------------------------------------

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a KRA iTax Monthly Rental Income XML payload. The shape
 * mirrors KRA's published MRI return template — one `<rentalIncome>`
 * element per line item plus rollup totals.
 *
 * NOT a substitute for the bona-fide signed iTax envelope (which
 * requires KRA's wsdl + a registered certificate); rather, this is
 * the canonical data shape an integrator can feed into the signer.
 */
export function buildKenyaMriXmlPayload(
  run: FilingRun,
  tenantProfile: TenantProfileForFiling,
  period: TaxPeriod
): string {
  const lines = run.lineItems
    .map(
      (li) => `  <rentalIncome>
    <leaseId>${xmlEscape(li.leaseId)}</leaseId>
    <tenantName>${xmlEscape(li.tenantName)}</tenantName>
    <propertyReference>${xmlEscape(li.propertyReference)}</propertyReference>
    <grossRentMinorUnits>${li.grossRentMinorUnits}</grossRentMinorUnits>
    <withholdingMinorUnits>${li.withholdingMinorUnits}</withholdingMinorUnits>
    <currency>${xmlEscape(li.currency)}</currency>
    <paymentDate>${xmlEscape(li.paymentDate)}</paymentDate>
  </rentalIncome>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kraMonthlyRentalIncome>
  <runId>${xmlEscape(run.runId)}</runId>
  <period>${xmlEscape(formatPeriodLabel(period))}</period>
  <landlord>
    <kraPin>${xmlEscape(tenantProfile.taxpayerId)}</kraPin>
    <legalName>${xmlEscape(tenantProfile.legalName)}</legalName>
    <countryCode>${xmlEscape(tenantProfile.countryCode)}</countryCode>
  </landlord>
${lines}
  <totals>
    <grossMinorUnits>${run.totalGrossMinorUnits}</grossMinorUnits>
    <withholdingMinorUnits>${run.totalWithholdingMinorUnits}</withholdingMinorUnits>
    <lineCount>${run.lineItems.length}</lineCount>
  </totals>
</kraMonthlyRentalIncome>`;
}
