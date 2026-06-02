import { describe, it, expect } from 'vitest';
import {
  classifyDocument,
  parseOfftakeAgreement,
  parseRoyaltyRoll,
  parseCounterpartyApplication,
  parseMaintenanceInvoice,
  parseComplianceNotice,
  parseGovernmentLetter,
  analyzeDocument,
} from '../document-intelligence.js';
import { analyzeUpload } from '../document-analysis-bridge.js';

describe('classifyDocument', () => {
  it('classifies an offtake agreement', () => {
    const r = classifyDocument('This offtake supply agreement between the supplier and buyer sets price per tonne.');
    expect(r.kind).toBe('offtake_agreement');
  });

  it('classifies a royalty roll', () => {
    const r = classifyDocument('royalty roll for site X\npit label 1A monthly royalty KES 30,000 producing');
    expect(r.kind).toBe('royalty_roll');
  });

  it('classifies a government letter', () => {
    const r = classifyDocument('REPUBLIC OF KENYA\nMinistry of Minerals\nRef No. MM/123\nOfficial notice');
    expect(r.kind).toBe('government_letter');
  });

  it('returns unknown for garbage', () => {
    const r = classifyDocument('zzz');
    expect(r.kind).toBe('unknown');
    expect(r.confidence).toBe(0);
  });
});

describe('parseOfftakeAgreement', () => {
  it('extracts parties and price', () => {
    const text = `
      OFFTAKE AGREEMENT
      SUPPLIER: Mwangi Minerals Ltd
      BUYER: John Doe
      Commencement date: 01/01/2026
      End date: 31/12/2026
      Price per tonne: KES 35,000
    `;
    const r = parseOfftakeAgreement(text);
    expect(r.extracted.buyer).toContain('John');
    expect(r.extracted.priceAmount).toBe(35_000);
  });

  it('flags when dates are missing', () => {
    const r = parseOfftakeAgreement('Offtake of pit 1A, KES 10,000');
    expect(r.flags).toContain('offtake_dates_incomplete');
  });
});

describe('parseRoyaltyRoll', () => {
  it('extracts rows', () => {
    const text = '1A 30,000 producing\n2B 25,000 idle\n3C 40,000 arrears';
    const r = parseRoyaltyRoll(text);
    const rows = (r.extracted as { rows: unknown[] }).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('parseCounterpartyApplication', () => {
  it('extracts name and turnover', () => {
    const text = `
      Applicant name: Jane Wanjiru
      Monthly turnover: KES 120,000
      Company: Acme Ltd
      Referee 1: John Doe
      Referee 2: Ada Lovelace
    `;
    const r = parseCounterpartyApplication(text);
    expect(r.extracted.applicantName).toContain('Jane');
    expect(r.extracted.monthlyTurnover).toBe(120_000);
  });

  it('flags insufficient references', () => {
    const r = parseCounterpartyApplication('Applicant name: Test\nMonthly turnover: KES 1');
    expect(r.flags).toContain('insufficient_references');
  });
});

describe('parseMaintenanceInvoice', () => {
  it('extracts invoice total', () => {
    const text = `
      Invoice no: INV-2026-001
      Vendor: Pump Techs Co
      Labour 5,000
      Materials 3,000
      VAT (16%): KES 1,280
      Total: KES 9,280
    `;
    const r = parseMaintenanceInvoice(text);
    expect(r.extracted.invoiceNumber).toBe('INV-2026-001');
    expect(r.extracted.total).toBe(9_280);
  });
});

describe('parseComplianceNotice', () => {
  it('extracts act section and notice period', () => {
    const text = `
      To: Jane Wanjiru
      NOTICE under Section 4 of the Mining Act.
      You are given 60 days notice.
    `;
    const r = parseComplianceNotice(text);
    expect(r.extracted.section).toBe('4');
    expect(r.extracted.noticeAmount).toBe(60);
  });
});

describe('parseGovernmentLetter', () => {
  it('extracts reference and body', () => {
    const text = `
      REPUBLIC OF KENYA
      Ministry of Minerals
      Ref No: MM/123/2026
      Date: 10/04/2026
    `;
    const r = parseGovernmentLetter(text);
    expect(r.extracted.referenceNumber).toBe('MM/123/2026');
  });
});

describe('analyzeDocument', () => {
  it('routes to the right parser', () => {
    const r = analyzeDocument('OFFTAKE AGREEMENT\nSUPPLIER: A\nBUYER: B\nPrice per tonne: KES 1');
    expect(r.kind).toBe('offtake_agreement');
  });
});

describe('analyzeUpload bridge', () => {
  it('returns a full envelope with suggested links', () => {
    const env = analyzeUpload({
      tenantId: 't1',
      documentId: 'd1',
      filename: 'offtake.pdf',
      mimeType: 'application/pdf',
      text: 'OFFTAKE AGREEMENT\nSUPPLIER: X Ltd\nBUYER: Y\nPrice per tonne: KES 10,000',
      uploadedBy: 'user_1',
      uploadedAt: new Date().toISOString(),
    });
    expect(env.classifiedKind).toBe('offtake_agreement');
    expect(env.suggestedLinks.length).toBeGreaterThan(0);
    expect(env.summary).toContain('offtake');
  });

  it('respects a hinted kind', () => {
    const env = analyzeUpload({
      tenantId: 't1',
      documentId: 'd2',
      filename: 'x.pdf',
      mimeType: 'application/pdf',
      text: 'ambiguous text',
      uploadedBy: 'u',
      uploadedAt: new Date().toISOString(),
      hintedKind: 'government_letter',
    });
    expect(env.classifiedKind).toBe('government_letter');
  });

  it('produces no PII in tests — synthetic input', () => {
    const env = analyzeUpload({
      tenantId: 't1',
      documentId: 'd3',
      filename: 'x.pdf',
      mimeType: 'application/pdf',
      text: 'Applicant name: Synthetic User\nMonthly turnover: 1\nReferee 1: A\nReferee 2: B',
      uploadedBy: 'u',
      uploadedAt: new Date().toISOString(),
    });
    expect(env.analysis.extracted).toBeTruthy();
  });
});
