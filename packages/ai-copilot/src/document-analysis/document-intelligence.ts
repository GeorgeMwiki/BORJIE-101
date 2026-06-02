/**
 * Document Intelligence — domain-specific extractors.
 *
 * Six deterministic heuristic parsers:
 *   - offtake agreement
 *   - royalty roll
 *   - counterparty application
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
  'offtake_agreement',
  'royalty_roll',
  'counterparty_application',
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
    offtake_agreement: count(t, ['offtake', 'supplier', 'buyer', 'supply agreement', 'price per tonne']),
    royalty_roll: count(t, ['royalty roll', 'pit label', 'arrears', 'monthly royalty', 'producing']),
    counterparty_application: count(t, ['application form', 'applicant', 'monthly turnover', 'references', 'company']),
    maintenance_invoice: count(t, ['invoice', 'repair', 'labour', 'materials', 'vat', 'pump']),
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

export function parseOfftakeAgreement(text: string): DocumentAnalysisResult {
  const flags: string[] = [];
  const supplier = /supplier[:\s]+([A-Z][A-Za-z '&.-]{2,80})/i.exec(text)?.[1];
  const buyer = /buyer[:\s]+([A-Z][A-Za-z '&.-]{2,80})/i.exec(text)?.[1];
  const price = /price[^\n]{0,200}?(KES|TZS|UGX|RWF)\s*([\d,\.]+)/i.exec(text);
  const start = /commencement\s+date[^\n]{0,60}?([\d]{1,2}[\/\-.][A-Za-z0-9]{1,10}[\/\-.][\d]{2,4})/i.exec(text)?.[1];
  const end = /(?:end|expiry)\s+date[^\n]{0,60}?([\d]{1,2}[\/\-.][A-Za-z0-9]{1,10}[\/\-.][\d]{2,4})/i.exec(text)?.[1];
  if (!price) flags.push('price_not_detected');
  if (!start || !end) flags.push('offtake_dates_incomplete');
  if (!buyer) flags.push('buyer_name_missing');
  return {
    kind: 'offtake_agreement',
    confidence: 0.8,
    extracted: {
      supplier,
      buyer,
      priceCurrency: price?.[1],
      priceAmount: price ? Number((price[2] ?? '').replace(/[,\s]/g, '')) : undefined,
      startDate: start,
      endDate: end,
    },
    flags,
  };
}

export function parseRoyaltyRoll(text: string): DocumentAnalysisResult {
  const rows: Array<{ pit: string; royalty: number; status: string }> = [];
  const lineRegex = /\b([A-Z0-9][A-Z0-9\-/]{0,8})\s+(?:KES|TZS|UGX|RWF)?\s*([\d,\.]+)\s+(producing|idle|notice|arrears)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = lineRegex.exec(text)) !== null) {
    const pit = m[1];
    const royalty = m[2];
    const status = m[3];
    if (pit === undefined || royalty === undefined || status === undefined) continue;
    rows.push({
      pit,
      royalty: Number(royalty.replace(/[,\s]/g, '')),
      status: status.toLowerCase(),
    });
  }
  const flags: string[] = [];
  if (rows.length === 0) flags.push('no_rows_detected');
  return {
    kind: 'royalty_roll',
    confidence: rows.length > 0 ? 0.75 : 0.3,
    extracted: { rowCount: rows.length, rows },
    flags,
  };
}

export function parseCounterpartyApplication(text: string): DocumentAnalysisResult {
  const name = /applicant\s+name[:\s]+([A-Z][A-Za-z '&.-]{2,80})/i.exec(text)?.[1];
  const turnover = /(?:monthly|annual)\s+turnover[:\s]+(?:KES|TZS|UGX|RWF)?\s*([\d,\.]+)/i.exec(text);
  const company = /company[:\s]+([A-Z][A-Za-z0-9 '&.-]{2,80})/i.exec(text)?.[1];
  const references = Array.from(text.matchAll(/referee\s*\d*[:\s]+([A-Z][A-Za-z '&.-]{2,80})/gi)).map((r) => r[1]);
  const flags: string[] = [];
  if (!name) flags.push('applicant_name_missing');
  if (!turnover) flags.push('turnover_missing');
  if (references.length < 2) flags.push('insufficient_references');
  return {
    kind: 'counterparty_application',
    confidence: 0.7,
    extracted: {
      applicantName: name,
      monthlyTurnover: turnover ? Number((turnover[1] ?? '').replace(/[,\s]/g, '')) : undefined,
      company,
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
      total: total ? Number((total[1] ?? '').replace(/[,\s]/g, '')) : undefined,
      vatPct: vat ? Number(vat[1]) : undefined,
      vatAmount: vat ? Number((vat[2] ?? '').replace(/[,\s]/g, '')) : undefined,
    },
    flags,
  };
}

export function parseComplianceNotice(text: string): DocumentAnalysisResult {
  const act = /(?:act|mining\s+act|licence\s+conditions)[^\n]{0,80}/i.exec(text)?.[0];
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
    case 'offtake_agreement':
      return parseOfftakeAgreement(text);
    case 'royalty_roll':
      return parseRoyaltyRoll(text);
    case 'counterparty_application':
      return parseCounterpartyApplication(text);
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
