import { describe, expect, it } from 'vitest';
import { classifyDocType, extractEntities } from '../extract/index.js';
import { parseLayout } from '../layout/index.js';
import { loadFixture } from './fixtures.js';
import type { ExtractedField } from '../extract/entity-extractor.js';

function findField(
  fields: ReadonlyArray<ExtractedField>,
  key: string,
): ExtractedField | undefined {
  return fields.find((f) => f.key === key);
}

describe('classifyDocType', () => {
  it('classifies a lease application', async () => {
    const text = loadFixture('lease-application');
    const result = await classifyDocType(text);
    expect(result.docType).toBe('lease_application');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies a payment receipt', async () => {
    const text = loadFixture('payment-receipt-gepg');
    const result = await classifyDocType(text);
    expect(result.docType).toBe('payment_receipt');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies a NIDA scan', async () => {
    const text = loadFixture('national-id-nida');
    const result = await classifyDocType(text);
    expect(result.docType).toBe('national_id');
  });

  it('classifies a condition survey', async () => {
    const text = loadFixture('condition-survey');
    const result = await classifyDocType(text);
    expect(result.docType).toBe('condition_survey');
  });

  it('classifies a complaint letter', async () => {
    const text = loadFixture('complaint-letter');
    const result = await classifyDocType(text);
    expect(result.docType).toBe('complaint_letter');
  });

  it('returns unknown for empty text', async () => {
    const result = await classifyDocType('');
    expect(result.docType).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('handles Swahili-heavy text', async () => {
    const result = await classifyDocType(
      'Mkataba wa upangaji wa kodi ya mwezi. Mpangaji na mwenye nyumba wamekubaliana.',
    );
    expect(result.docType).toBe('lease_contract');
  });

  it('uses the LLM tie-breaker when heuristic confidence is low', async () => {
    const text = 'just some random words with no keywords at all';
    const llmCalled: Array<unknown> = [];
    const result = await classifyDocType(text, {
      llm: {
        async classify(input) {
          llmCalled.push(input);
          return { docType: 'lease_contract', confidence: 0.8 };
        },
        async extract() {
          return { fields: {}, confidence: 0 };
        },
      },
    });
    expect(llmCalled.length).toBeGreaterThan(0);
    expect(result.llmUsed).toBe(true);
    expect(result.docType).toBe('lease_contract');
  });

  it('falls back to heuristic when LLM throws', async () => {
    const result = await classifyDocType('payment receipt gepg risiti', {
      llm: {
        async classify() {
          throw new Error('LLM unavailable');
        },
        async extract() {
          return { fields: {}, confidence: 0 };
        },
      },
    });
    // payment_receipt heuristic should win.
    expect(['payment_receipt', 'unknown']).toContain(result.docType);
  });
});

describe('extractEntities — lease application', () => {
  it('extracts applicant + asset + rent', async () => {
    const text = loadFixture('lease-application');
    const layout = await parseLayout({ text });
    const fields = extractEntities({
      docType: 'lease_application',
      text,
      layout,
    });
    expect(findField(fields, 'applicant_name')?.value).toBe('Asha Mwangi');
    expect(findField(fields, 'applicant_phone')?.value).toBe('+255712345678');
    expect(findField(fields, 'applicant_nida')?.value).toContain('19850101');
    expect(findField(fields, 'requested_asset')?.value).toBe('PROP-DAR-0001');
    expect(findField(fields, 'requested_rent')?.value).toEqual({
      currency: 'TZS',
      amount: 850000,
      amountMinor: 85_000_000,
    });
  });

  it('attaches page + bbox citations', async () => {
    const text = loadFixture('lease-application');
    const layout = await parseLayout({ text });
    const fields = extractEntities({
      docType: 'lease_application',
      text,
      layout,
    });
    const applicant = findField(fields, 'applicant_name');
    expect(applicant?.page).toBe(1);
    expect(applicant?.bbox).not.toBeNull();
    expect(applicant?.bbox?.w).toBeGreaterThan(0);
  });
});

describe('extractEntities — payment receipt', () => {
  it('extracts amount + GePG ref + payment date', async () => {
    const text = loadFixture('payment-receipt-gepg');
    const layout = await parseLayout({ text });
    const fields = extractEntities({
      docType: 'payment_receipt',
      text,
      layout,
    });
    expect(findField(fields, 'amount')?.value).toEqual({
      currency: 'TZS',
      amount: 850000,
      amountMinor: 85_000_000,
    });
    expect(findField(fields, 'gepg_reference')?.value).toBe('991234567890');
    expect(findField(fields, 'payment_date')?.value).toBe('2025-02-15');
  });
});

describe('extractEntities — NIDA', () => {
  it('extracts ID number in Tanzania format', async () => {
    const text = loadFixture('national-id-nida');
    const layout = await parseLayout({ text });
    const fields = extractEntities({
      docType: 'national_id',
      text,
      layout,
    });
    expect(findField(fields, 'id_number')?.value).toBe(
      '19900215-44455-66677-02',
    );
    expect(findField(fields, 'date_of_birth')?.value).toBe('1990-02-15');
  });
});

describe('extractEntities — condition survey', () => {
  it('extracts asset + inspection date + inspector', async () => {
    const text = loadFixture('condition-survey');
    const layout = await parseLayout({ text });
    const fields = extractEntities({
      docType: 'condition_survey',
      text,
      layout,
    });
    expect(findField(fields, 'asset_reference')?.value).toBe('PROP-DAR-0001');
    expect(findField(fields, 'inspection_date')?.value).toBe('2025-02-08');
    expect(findField(fields, 'inspector_name')?.value).toBe('Joseph Kibwana');
  });
});

describe('extractEntities — complaint letter', () => {
  it('extracts complainant + topic + asset', async () => {
    const text = loadFixture('complaint-letter');
    const layout = await parseLayout({ text });
    const fields = extractEntities({
      docType: 'complaint_letter',
      text,
      layout,
    });
    expect(findField(fields, 'complainant_name')?.value).toBe('Asha Mwangi');
    expect(findField(fields, 'complaint_topic')?.value).toContain('water leakage');
    expect(findField(fields, 'asset_reference')?.value).toBe('PROP-DAR-0001');
  });
});

describe('extractEntities — unknown returns nothing', () => {
  it('emits no fields for unknown doc type', () => {
    const fields = extractEntities({
      docType: 'unknown',
      text: 'some text',
    });
    expect(fields).toHaveLength(0);
  });
});
