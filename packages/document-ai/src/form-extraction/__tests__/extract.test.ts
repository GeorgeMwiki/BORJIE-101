import { describe, expect, it, vi } from 'vitest';
import { extractFormFields } from '../extract.js';
import {
  bankStatementSchema,
  idCardSchema,
  invoiceSchema,
  leaseAgreementSchema,
  receiptSchema,
  utilityBillSchema,
} from '../schemas.js';
import { buildPage, buildParsedDocument } from '../../ocr/parsed-document-builder.js';
import type { BrainPort, TextBlock } from '../../types.js';

function tBlock(id: string, text: string): TextBlock {
  return {
    id,
    text,
    bbox: { x: 0, y: 0, width: 1, height: 0.04 },
    role: 'paragraph',
    confidence: 0.95,
    language: 'en',
  };
}

async function makeDoc(id: string, lines: string[]) {
  return await buildParsedDocument({
    id,
    sourceMime: 'application/pdf',
    sourceBytes: new Uint8Array([1]),
    pages: [
      buildPage({
        pageNumber: 1,
        language: 'en',
        blocks: lines.map((line, idx) => tBlock(`b-${idx}`, line)),
      }),
    ],
    producedBy: 'test',
  });
}

describe('extractFormFields — pre-shipped schemas', () => {
  it('extracts lease agreement fields heuristically', async () => {
    const doc = await makeDoc('lease', [
      'LEASE AGREEMENT',
      'Landlord: Borjie Ltd',
      'Tenant: Asha Mwangi',
      'Monthly Rent: TZS 1,250,000',
      'Term: 12 months',
    ]);
    const fields = await extractFormFields({ doc, schema: leaseAgreementSchema });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.landlord_name!.value).toBe('Borjie Ltd');
    expect(byName.tenant_name!.value).toBe('Asha Mwangi');
    expect(byName.monthly_rent!.value).toContain('1,250,000');
    expect(byName.landlord_name!.source).not.toBeNull();
    expect(byName.landlord_name!.origin).toBe('extracted');
  });

  it('extracts bank statement fields', async () => {
    const doc = await makeDoc('bs', [
      'Bank: CRDB Bank',
      'Account Number: 0150-2345-678',
      'Statement Period: 2026-04-01 to 2026-04-30',
      'Opening Balance: TZS 1,500,000',
      'Closing Balance: TZS 2,100,000',
    ]);
    const fields = await extractFormFields({ doc, schema: bankStatementSchema });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.bank_name!.value).toBe('CRDB Bank');
    expect(byName.account_number!.value).toBe('0150-2345-678');
    expect(byName.opening_balance!.value).toContain('1,500,000');
  });

  it('extracts ID card fields', async () => {
    const doc = await makeDoc('id', [
      'Name: Asha Mwangi',
      'ID Number: 19880712-12345-67890-12',
      'Date of Birth: 1988-07-12',
      'Nationality: Tanzanian',
    ]);
    const fields = await extractFormFields({ doc, schema: idCardSchema });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.full_name!.value).toBe('Asha Mwangi');
    expect(byName.id_number!.value).toContain('19880712');
    expect(byName.nationality!.value).toBe('Tanzanian');
  });

  it('extracts receipt fields', async () => {
    const doc = await makeDoc('rcpt', [
      'Vendor: Posta Mall Store',
      'Receipt No: RCPT-0042',
      'Date: 2026-05-20',
      'Subtotal: TZS 45,000',
      'Total: TZS 48,250',
    ]);
    const fields = await extractFormFields({ doc, schema: receiptSchema });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.vendor!.value).toBe('Posta Mall Store');
    expect(byName.total!.value).toContain('48,250');
    expect(byName.receipt_number!.value).toBe('RCPT-0042');
  });

  it('extracts invoice fields', async () => {
    const doc = await makeDoc('inv', [
      'Invoice Number: INV-2026-08842',
      'Issue Date: 2026-05-10',
      'Due Date: 2026-05-30',
      'Bill To: Borjie Properties',
      'Total: TZS 750,000',
    ]);
    const fields = await extractFormFields({ doc, schema: invoiceSchema });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.invoice_number!.value).toBe('INV-2026-08842');
    expect(byName.due_date!.value).toBe('2026-05-30');
    expect(byName.bill_to!.value).toBe('Borjie Properties');
  });

  it('extracts utility bill fields', async () => {
    const doc = await makeDoc('util', [
      'Provider: TANESCO',
      'Customer: Asha Mwangi',
      'Account Number: 1234567890',
      'Billing Period: 2026-04-01 to 2026-04-30',
      'Amount Due: TZS 67,500',
    ]);
    const fields = await extractFormFields({ doc, schema: utilityBillSchema });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.provider!.value).toBe('TANESCO');
    expect(byName.account_number!.value).toBe('1234567890');
    expect(byName.amount_due!.value).toContain('67,500');
  });

  it('marks missing fields with origin "missing"', async () => {
    const doc = await makeDoc('thin', ['LEASE AGREEMENT']);
    const fields = await extractFormFields({
      doc,
      schema: leaseAgreementSchema,
    });
    const missing = fields.filter((f) => f.origin === 'missing');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0]!.value).toBeUndefined();
  });

  it('falls back to brain output when heuristic misses', async () => {
    const doc = await makeDoc('thin', ['Some narrative text without keywords.']);
    const brain: BrainPort = {
      complete: vi.fn(async () => ({
        text: '{"landlord_name": "Acme Corp", "tenant_name": "Jane Doe"}',
      })),
    };
    const fields = await extractFormFields({
      doc,
      schema: leaseAgreementSchema,
      brain,
    });
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.landlord_name!.value).toBe('Acme Corp');
    expect(byName.landlord_name!.origin).toBe('inferred');
    expect(byName.tenant_name!.value).toBe('Jane Doe');
  });

  it('survives malformed brain JSON without throwing', async () => {
    const doc = await makeDoc('thin', ['No keywords.']);
    const brain: BrainPort = {
      complete: vi.fn(async () => ({ text: 'not json at all' })),
    };
    const fields = await extractFormFields({
      doc,
      schema: leaseAgreementSchema,
      brain,
    });
    expect(fields.every((f) => f.origin === 'missing')).toBe(true);
  });
});
