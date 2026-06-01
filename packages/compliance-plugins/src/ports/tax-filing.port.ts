/**
 * TaxFilingPort — produces regulator-ready royalty-return / filing payloads.
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

/** Minimal operator-profile shape that every filing implementation can rely on. */
export interface OperatorProfileForFiling {
  /** Stable tenant (platform-customer) id. */
  readonly tenantId: string;
  /** Operator / taxpayer ID (e.g. TRA TIN, KRA PIN, EIN). */
  readonly taxpayerId: string;
  /** Legal entity name on the filing. */
  readonly legalName: string;
  /** ISO-3166-1 alpha-2 country code. */
  readonly countryCode: string;
  /** Optional free-form address block printed on the filing. */
  readonly address?: string;
  /** Optional VAT-registration number (for combined royalty+VAT filings). */
  readonly vatNumber?: string | null;
}

/** A single mineral-sale / royalty line item. Minor-unit integer amounts. */
export interface FilingLineItem {
  readonly offtakeId: string;
  readonly counterpartyName: string;
  readonly siteReference: string;
  readonly grossValueMinorUnits: number;
  readonly withholdingMinorUnits: number;
  readonly currency: string;
  /** ISO-8601 date string, e.g. '2026-03-28'. */
  readonly paymentDate: string;
}

/** Input passed by the consumer at filing time. */
export interface FilingRun {
  readonly runId: string;
  readonly lineItems: readonly FilingLineItem[];
  /** Sum of `grossValueMinorUnits` across all line items. */
  readonly totalGrossMinorUnits: number;
  /** Sum of `withholdingMinorUnits` across all line items. */
  readonly totalWithholdingMinorUnits: number;
}

export interface FilingResult {
  /** Wire format of `payload`. */
  readonly filingFormat: FilingFormat;
  /** Serialised payload — CSV string, XML string, or JSON string. */
  readonly payload: string;
  /** Target regulator short-name (e.g. 'TRA', 'KRA', 'IRS', 'GENERIC'). */
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
    operatorProfile: OperatorProfileForFiling,
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
    'offtake_id',
    'counterparty_name',
    'site_reference',
    'gross_value_minor',
    'withholding_minor',
    'currency',
    'payment_date',
  ].join(',');
  const rows = run.lineItems.map((li) =>
    [
      csvEscape(li.offtakeId),
      csvEscape(li.counterpartyName),
      csvEscape(li.siteReference),
      String(li.grossValueMinorUnits),
      String(li.withholdingMinorUnits),
      csvEscape(li.currency),
      csvEscape(li.paymentDate),
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/** Default — CSV / GENERIC regulator, no submission endpoint. */
export const DEFAULT_TAX_FILING: TaxFilingPort = {
  prepareFiling(run, operatorProfile, period) {
    return {
      filingFormat: 'csv',
      payload: buildGenericCsvPayload(run),
      targetRegulator: 'GENERIC',
      submitEndpointHint: null,
      instructions:
        `Generic mineral-royalty filing for ${operatorProfile.legalName} ` +
        `(${operatorProfile.countryCode}) — period ${formatPeriodLabel(period)}. ` +
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
// regulator accepted. Kenya's mineral-royalty return is an XML /
// structured upload, not free-form CSV. Until each plugin wires a real
// builder we now ship at least a structured-XML option for Kenya so
// dashboards can render the right shape and the submission-service can
// target the real royalty-return endpoint.
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
 * Build a Kenya mineral-royalty XML payload. The shape mirrors a
 * structured royalty-return template — one `<royaltyLine>` element per
 * line item plus rollup totals.
 *
 * NOT a substitute for the bona-fide signed envelope (which requires the
 * regulator's wsdl + a registered certificate); rather, this is the
 * canonical data shape an integrator can feed into the signer.
 */
export function buildKenyaRoyaltyXmlPayload(
  run: FilingRun,
  operatorProfile: OperatorProfileForFiling,
  period: TaxPeriod
): string {
  const lines = run.lineItems
    .map(
      (li) => `  <royaltyLine>
    <offtakeId>${xmlEscape(li.offtakeId)}</offtakeId>
    <counterpartyName>${xmlEscape(li.counterpartyName)}</counterpartyName>
    <siteReference>${xmlEscape(li.siteReference)}</siteReference>
    <grossValueMinorUnits>${li.grossValueMinorUnits}</grossValueMinorUnits>
    <withholdingMinorUnits>${li.withholdingMinorUnits}</withholdingMinorUnits>
    <currency>${xmlEscape(li.currency)}</currency>
    <paymentDate>${xmlEscape(li.paymentDate)}</paymentDate>
  </royaltyLine>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kenyaMineralRoyaltyReturn>
  <runId>${xmlEscape(run.runId)}</runId>
  <period>${xmlEscape(formatPeriodLabel(period))}</period>
  <operator>
    <kraPin>${xmlEscape(operatorProfile.taxpayerId)}</kraPin>
    <legalName>${xmlEscape(operatorProfile.legalName)}</legalName>
    <countryCode>${xmlEscape(operatorProfile.countryCode)}</countryCode>
  </operator>
${lines}
  <totals>
    <grossMinorUnits>${run.totalGrossMinorUnits}</grossMinorUnits>
    <withholdingMinorUnits>${run.totalWithholdingMinorUnits}</withholdingMinorUnits>
    <lineCount>${run.lineItems.length}</lineCount>
  </totals>
</kenyaMineralRoyaltyReturn>`;
}
