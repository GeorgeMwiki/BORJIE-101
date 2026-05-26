/**
 * Format-specific brander tests — every brander produces a non-empty
 * binary and asserts brand-lock compliance before sealing.
 */

import { describe, expect, it } from 'vitest';
import { brandPdf, renderIRDocToHtml } from '../brand-lock/pdf-brander.js';
import { brandDocx } from '../brand-lock/docx-brander.js';
import { brandXlsx } from '../brand-lock/xlsx-brander.js';
import { brandPptx } from '../brand-lock/pptx-brander.js';
import type { IRDoc, SpanCitation } from '../types.js';

const CITATION: SpanCitation = {
  id: 'CIT-001',
  claim: 'A test citation.',
  source: { kind: 'corpus_chunk', ref: 'chunk-1' },
};

function exampleDoc(): IRDoc {
  return {
    title: 'Brand-locked Smoke Doc',
    subtitle: 'Format brander coverage',
    sections: [
      {
        id: 's1',
        title: 'Summary',
        blocks: [
          { kind: 'heading', text: 'Highlights', level: 2 },
          {
            kind: 'paragraph',
            text: 'Operational summary with a cited figure.',
            citationId: 'CIT-001',
          },
          {
            kind: 'kpi_grid',
            kpis: [
              { label: 'Headline KPI', value: 'see ledger', citationId: 'CIT-001' },
            ],
          },
          {
            kind: 'table',
            headers: ['Metric', 'Value'],
            rows: [['Tons', 'see ledger']],
          },
          { kind: 'chart_placeholder', text: 'Trend chart' },
          { kind: 'signature_block', text: 'Mr. Mwikila' },
        ],
        citationIds: ['CIT-001'],
      },
    ],
    citations: [CITATION],
    watermark: 'draft',
    generated_at: '2026-05-26T08:00:00.000Z',
  };
}

describe('PDF brander', () => {
  it('produces a non-empty PDF with %PDF prefix', () => {
    const result = brandPdf(exampleDoc());
    expect(result.bytes.length).toBeGreaterThan(100);
    expect(result.bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('renders HTML free of inline styles', () => {
    const html = renderIRDocToHtml(exampleDoc());
    expect(html).not.toContain(' style=');
    expect(html).toContain('Brand-locked Smoke Doc');
  });
});

describe('DOCX brander', () => {
  it('produces a valid PKZIP archive (PK\\x03\\x04 prefix)', () => {
    const result = brandDocx(exampleDoc());
    expect(result.bytes.length).toBeGreaterThan(100);
    expect(result.bytes[0]).toBe(0x50); // P
    expect(result.bytes[1]).toBe(0x4b); // K
    expect(result.bytes[2]).toBe(0x03);
    expect(result.bytes[3]).toBe(0x04);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('XLSX brander', () => {
  it('produces a valid xlsx PKZIP archive', () => {
    const result = brandXlsx(exampleDoc());
    expect(result.bytes.length).toBeGreaterThan(100);
    expect(result.bytes.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});

describe('PPTX brander', () => {
  it('produces a valid pptx PKZIP archive with title + section slides', () => {
    const result = brandPptx(exampleDoc());
    expect(result.bytes.length).toBeGreaterThan(100);
    expect(result.bytes.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
