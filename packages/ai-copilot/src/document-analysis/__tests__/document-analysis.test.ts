import { describe, it, expect } from 'vitest';
import {
  classifyDocument,
  parseLeaseAgreement,
  parseRentRoll,
  parseTenantApplication,
  parseMaintenanceInvoice,
  parseComplianceNotice,
  parseGovernmentLetter,
  analyzeDocument,
} from '../document-intelligence.js';
import { analyzeUpload } from '../document-analysis-bridge.js';

describe('classifyDocument', () => {
  it('classifies a lease', () => {
    const r = classifyDocument('This lease agreement between the lessor and lessee sets rent per month.');
    expect(r.kind).toBe('lease_agreement');
  });

  it('classifies a rent roll', () => {
    const r = classifyDocument('rent roll for property X\nunit label 1A monthly rent KES 30,000 occupied');
    expect(r.kind).toBe('rent_roll');
  });

  it('classifies a government letter', () => {
    const r = classifyDocument('REPUBLIC OF KENYA\nMinistry of Lands\nRef No. ML/123\nOfficial notice');
    expect(r.kind).toBe('government_letter');
  });

  it('returns unknown for garbage', () => {
    const r = classifyDocument('zzz');
    expect(r.kind).toBe('unknown');
    expect(r.confidence).toBe(0);
  });
});

describe('parseLeaseAgreement', () => {
  it('extracts parties and rent', () => {
    const text = `
      LEASE AGREEMENT
      LESSOR: Mwangi Properties Ltd
      LESSEE: John Doe
      Commencement date: 01/01/2026
      End date: 31/12/2026
      Rent per month: KES 35,000
    `;
    const r = parseLeaseAgreement(text);
    expect(r.extracted.tenant).toContain('John');
    expect(r.extracted.rentAmount).toBe(35_000);
  });

  it('flags when dates are missing', () => {
    const r = parseLeaseAgreement('Lease of unit 1A, KES 10,000');
    expect(r.flags).toContain('lease_dates_incomplete');
  });
});

describe('parseRentRoll', () => {
  it('extracts rows', () => {
    const text = '1A 30,000 occupied\n2B 25,000 vacant\n3C 40,000 arrears';
    const r = parseRentRoll(text);
    const rows = (r.extracted as { rows: unknown[] }).rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe('parseTenantApplication', () => {
  it('extracts name and income', () => {
    const text = `
      Applicant name: Jane Wanjiru
      Monthly income: KES 120,000
      Employer: Acme Ltd
      Referee 1: John Doe
      Referee 2: Ada Lovelace
    `;
    const r = parseTenantApplication(text);
    expect(r.extracted.applicantName).toContain('Jane');
    expect(r.extracted.monthlyIncome).toBe(120_000);
  });

  it('flags insufficient references', () => {
    const r = parseTenantApplication('Applicant name: Test\nMonthly income: KES 1');
    expect(r.flags).toContain('insufficient_references');
  });
});

describe('parseMaintenanceInvoice', () => {
  it('extracts invoice total', () => {
    const text = `
      Invoice no: INV-2026-001
      Vendor: Plumbers Co
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
      NOTICE under Section 4 of the Landlord and Tenant Act.
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
      Ministry of Lands
      Ref No: ML/123/2026
      Date: 10/04/2026
    `;
    const r = parseGovernmentLetter(text);
    expect(r.extracted.referenceNumber).toBe('ML/123/2026');
  });
});

describe('analyzeDocument', () => {
  it('routes to the right parser', () => {
    const r = analyzeDocument('LEASE AGREEMENT\nLESSOR: A\nLESSEE: B\nRent per month: KES 1');
    expect(r.kind).toBe('lease_agreement');
  });
});

describe('analyzeUpload bridge', () => {
  it('returns a full envelope with suggested links', () => {
    const env = analyzeUpload({
      tenantId: 't1',
      documentId: 'd1',
      filename: 'lease.pdf',
      mimeType: 'application/pdf',
      text: 'LEASE AGREEMENT\nLESSOR: X Ltd\nLESSEE: Y\nRent per month: KES 10,000',
      uploadedBy: 'user_1',
      uploadedAt: new Date().toISOString(),
    });
    expect(env.classifiedKind).toBe('lease_agreement');
    expect(env.suggestedLinks.length).toBeGreaterThan(0);
    expect(env.summary).toContain('lease');
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
      text: 'Applicant name: Synthetic User\nMonthly income: 1\nReferee 1: A\nReferee 2: B',
      uploadedBy: 'u',
      uploadedAt: new Date().toISOString(),
    });
    expect(env.analysis.extracted).toBeTruthy();
  });
});
