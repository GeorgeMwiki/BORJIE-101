/**
 * Document Intelligence — domain-specific extractors.
 *
 * Six deterministic heuristic parsers:
 *   - lease agreement
 *   - rent roll
 *   - tenant application
 *   - maintenance invoice
 *   - compliance notice
 *   - government letter
 *
 * Each parser returns a typed payload plus flags for the Compliance
 * junior to review. Per-country variations are consulted via the
 * compliance-plugins registry (passed in by the caller).
 */

import { z } from 'zod';

export const DocumentKindSchema = z.enum([
  'lease_agreement',
  'rent_roll',
  'tenant_application',
  'maintenance_invoice',
  'compliance_notice',
  'government_letter',
  'unknown',
]);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

export interface DocumentAnalysisResult {
  readonly kind: DocumentKind;
  readonly confidence: number;
  readonly extracted: Record<string, unknown>;
  readonly flags: readonly string[];
}

/**
 * Classify a document by scanning for keyword signatures. Returns the top
 * kind + confidence 0..1.
 */
export function classifyDocument(text: string): { kind: DocumentKind; confidence: number } {
  const t = text.toLowerCase();
  const scores: Record<DocumentKind, number> = {
    lease_agreement: count(t, ['lease', 'lessor', 'lessee', 'tenancy', 'rent per month']),
    rent_roll: count(t, ['rent roll', 'unit label', 'arrears', 'monthly rent', 'occupied']),
    tenant_application: count(t, ['application form', 'applicant', 'monthly income', 'references', 'employer']),
    maintenance_invoice: count(t, ['invoice', 'repair', 'labour', 'materials', 'vat', 'plumbing']),
    compliance_notice: count(t, ['notice', 'section', 'act', 'tribunal', 'demand']),
    government_letter: count(t, ['republic of', 'ministry of', 'ref no.', 'official', 'authority']),
    unknown: 0,
  };
  let topKind: DocumentKind = 'unknown';
  let top = 0;
  for (const [k, v] of Object.entries(scores) as Array<[DocumentKind, number]>) {
    if (v > top) {
      top = v;
      topKind = k;
    }
  }
  const confidence = top === 0 ? 0 : Math.min(1, top / 6);
  return { kind: topKind, confidence };
}

function count(text: string, terms: readonly string[]): number {
  return terms.reduce((sum, t) => (text.includes(t) ? sum + 1 : sum), 0);
}

export function parseLeaseAgreement(text: string): DocumentAnalysisResult {
  const flags: string[] = [];
  const parties = /lessor[:\s]+([A-Z][A-Za-z '&.-]{2,80})/i.exec(text)?.[1];
  const tenant = /lessee[:\s]+([A-Z][A-Za-z '&.-]{2,80})/i.exec(text)?.[1];
  const rent = /rent[^\n]{0,200}?(KES|TZS|UGX|RWF)\s*([\d,\.]+)/i.exec(text);
  const start = /commencement\s+date[^\n]{0,60}?([\d]{1,2}[\/\-.][A-Za-z0-9]{1,10}[\/\-.][\d]{2,4})/i.exec(text)?.[1];
  const end = /(?:end|expiry)\s+date[^\n]{0,60}?([\d]{1,2}[\/\-.][A-Za-z0-9]{1,10}[\/\-.][\d]{2,4})/i.exec(text)?.[1];
  if (!rent) flags.push('rent_not_detected');
  if (!start || !end) flags.push('lease_dates_incomplete');
  if (!tenant) flags.push('tenant_name_missing');
  return {
    kind: 'lease_agreement',
    confidence: 0.8,
    extracted: {
      landlord: parties,
      tenant,
      rentCurrency: rent?.[1],
      rentAmount: rent ? Number(rent[2].replace(/[,\s]/g, '')) : undefined,
      startDate: start,
      endDate: end,
    },
    flags,
  };
}

export function parseRentRoll(text: string): DocumentAnalysisResult {
  const rows: Array<{ unit: string; rent: number; status: string }> = [];
  const lineRegex = /\b([A-Z0-9][A-Z0-9\-/]{0,8})\s+(?:KES|TZS|UGX|RWF)?\s*([\d,\.]+)\s+(occupied|vacant|notice|arrears)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(text)) !== null) {
    rows.push({
      unit: m[1],
      rent: Number(m[2].replace(/[,\s]/g, '')),
      status: m[3].toLowerCase(),
    });
  }
  const flags: string[] = [];
  if (rows.length === 0) flags.push('no_rows_detected');
  return {
    kind: 'rent_roll',
    confidence: rows.length > 0 ? 0.75 : 0.3,
    extracted: { rowCount: rows.length, rows },
    flags,
  };
}

export function parseTenantApplication(text: string): DocumentAnalysisResult {
  const name = /applicant\s+name[:\s]+([A-Z][A-Za-z '&.-]{2,80})/i.exec(text)?.[1];
  const income = /(?:monthly|annual)\s+income[:\s]+(?:KES|TZS|UGX|RWF)?\s*([\d,\.]+)/i.exec(text);
  const employer = /employer[:\s]+([A-Z][A-Za-z0-9 '&.-]{2,80})/i.exec(text)?.[1];
  const references = Array.from(text.matchAll(/referee\s*\d*[:\s]+([A-Z][A-Za-z '&.-]{2,80})/gi)).map((r) => r[1]);
  const flags: string[] = [];
  if (!name) flags.push('applicant_name_missing');
  if (!income) flags.push('income_missing');
  if (references.length < 2) flags.push('insufficient_references');
  return {
    kind: 'tenant_application',
    confidence: 0.7,
    extracted: {
      applicantName: name,
      monthlyIncome: income ? Number(income[1].replace(/[,\s]/g, '')) : undefined,
      employer,
      references,
    },
    flags,
  };
}

export function parseMaintenanceInvoice(text: string): DocumentAnalysisResult {
  const invoiceNo = /invoice\s*(?:no\.?|number)[:\s]+([A-Z0-9\-]{3,20})/i.exec(text)?.[1];
  const total = /total[:\s]+(?:KES|TZS|UGX|RWF)?\s*([\d,\.]+)/i.exec(text);
  const vat = /vat\s*\(?(\d{1,2})%?\)?[:\s]*(?:KES|TZS|UGX|RWF)?\s*([\d,\.]+)/i.exec(text);
  const vendor = /vendor[:\s]+([A-Z][A-Za-z0-9 '&.-]{2,80})/i.exec(text)?.[1];
  const flags: string[] = [];
  if (!invoiceNo) flags.push('invoice_number_missing');
  if (!total) flags.push('total_missing');
  return {
    kind: 'maintenance_invoice',
    confidence: 0.8,
    extracted: {
      invoiceNumber: invoiceNo,
      vendor,
      total: total ? Number(total[1].replace(/[,\s]/g, '')) : undefined,
      vatPct: vat ? Number(vat[1]) : undefined,
      vatAmount: vat ? Number(vat[2].replace(/[,\s]/g, '')) : undefined,
    },
    flags,
  };
}

export function parseComplianceNotice(text: string): DocumentAnalysisResult {
  const act = /(?:act|rent\s+restriction|landlord\s+and\s+tenant)[^\n]{0,80}/i.exec(text)?.[0];
  const section = /section\s+([0-9]+[A-Za-z]?)/i.exec(text)?.[1];
  const partyServed = /to[:\s]+([A-Z][A-Za-z '&.-]{2,80})/i.exec(text)?.[1];
  const noticePeriod = /(\d{1,3})\s*(?:days?|months?)\s+notice/i.exec(text);
  const flags: string[] = [];
  if (!section) flags.push('section_missing');
  if (!noticePeriod) flags.push('notice_period_missing');
  return {
    kind: 'compliance_notice',
    confidence: 0.75,
    extracted: {
      actReference: act,
      section,
      partyServed,
      noticeAmount: noticePeriod ? Number(noticePeriod[1]) : undefined,
      noticeUnit: noticePeriod?.[0].includes('month') ? 'months' : 'days',
    },
    flags,
  };
}

export function parseGovernmentLetter(text: string): DocumentAnalysisResult {
  const ref = /ref\s*(?:no\.?|number)?[:\s]+([A-Z0-9\/\-]{3,30})/i.exec(text)?.[1];
  const ministry = /(?:ministry|authority|council)\s+of\s+([A-Z][A-Za-z &]{2,60})/i.exec(text)?.[0];
  const date = /date[:\s]+([\d]{1,2}[\/\-.][A-Za-z0-9]{1,10}[\/\-.][\d]{2,4})/i.exec(text)?.[1];
  const flags: string[] = [];
  if (!ref) flags.push('reference_missing');
  return {
    kind: 'government_letter',
    confidence: 0.7,
    extracted: {
      referenceNumber: ref,
      originatingBody: ministry,
      date,
    },
    flags,
  };
}

/**
 * Parse a document by first classifying then calling the appropriate parser.
 */
export function analyzeDocument(text: string): DocumentAnalysisResult {
  const classification = classifyDocument(text);
  switch (classification.kind) {
    case 'lease_agreement':
      return parseLeaseAgreement(text);
    case 'rent_roll':
      return parseRentRoll(text);
    case 'tenant_application':
      return parseTenantApplication(text);
    case 'maintenance_invoice':
      return parseMaintenanceInvoice(text);
    case 'compliance_notice':
      return parseComplianceNotice(text);
    case 'government_letter':
      return parseGovernmentLetter(text);
    case 'unknown':
      return {
        kind: 'unknown',
        confidence: 0,
        extracted: {},
        flags: ['document_kind_unknown'],
      };
  }
}
