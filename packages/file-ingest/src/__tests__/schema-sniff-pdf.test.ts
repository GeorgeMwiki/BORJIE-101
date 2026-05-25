/**
 * Schema-sniff PDF coverage. The adapter consumes extracted text (the
 * upstream pdf-parse step is out-of-scope for the deterministic part of
 * the pipeline). 3 variants: a wide-whitespace tabular block, a
 * pipe-delimited table, and free-text prose.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parsePdfText } from '../schema-sniff/pdf-adapter.js';
import { inferSchema } from '../schema-sniff/infer.js';
import { staticOcrProvider, ocrToTable } from '../schema-sniff/ocr-shim.js';

const FIXTURES = join(__dirname, '..', '..', '__fixtures__');

describe('schema-sniff: PDF text', () => {
  it('detects whitespace-aligned tabular block from a contract scan', () => {
    const text = readFileSync(join(FIXTURES, 'lease-contract-scan.txt'), 'utf8');
    const table = parsePdfText(text);
    expect(table.source_format).toEqual('pdf');
    // The fixture contains a tabular block at the bottom with 6 columns.
    // The first column header is "Lease Reference" (a single header cell
    // containing a space — wide-whitespace splitting preserves intra-cell
    // single spaces, splits on 2+ whitespace).
    expect(table.headers).toContain('Lease Reference');
    expect(table.headers.length).toBeGreaterThanOrEqual(2);
    expect(table.rows.length).toBeGreaterThanOrEqual(3);

    const schema = inferSchema(table);
    expect(schema.rowCount).toBeGreaterThanOrEqual(4);
  });

  it('parses pipe-delimited tabular text', () => {
    const text =
      'pin | period | filing_type | amount\n' +
      'P051234567A | 2024-Q4 | VAT | 4520000\n' +
      'P051234567A | 2024-Q4 | PAYE | 8120000\n' +
      'P061122334B | 2024-Q4 | VAT | 2210000\n';
    const table = parsePdfText(text);
    expect(table.headers).toEqual(['pin', 'period', 'filing_type', 'amount']);
    expect(table.rows).toHaveLength(3);

    const schema = inferSchema(table);
    expect(schema.rowCount).toEqual(3);
    const amountCol = schema.columns.find((c) => c.name === 'amount');
    expect(amountCol?.type).toEqual('integer');
  });

  it('falls back to single-column "text" mode for prose paragraphs', () => {
    const prose =
      'This is a lease agreement between BORJIE and the tenant.\n' +
      'The agreement is binding for twelve months.\n' +
      'All disputes are resolved via arbitration.\n';
    const table = parsePdfText(prose);
    expect(table.headers).toEqual(['text']);
    expect(table.rows).toHaveLength(3);
  });
});

describe('OCR shim', () => {
  it('staticOcrProvider routes recovered text through PDF heuristic and tags image_ocr', async () => {
    const text =
      'reference   |address         |city\n' +
      'PROP-DAR-01 |Plot12Masaki    |DarEsSalaam\n' +
      'PROP-DAR-02 |BlockBMikocheni |DarEsSalaam\n' +
      'PROP-ARS-01 |House17Njiro    |Arusha\n';
    const provider = staticOcrProvider(text);
    const table = await ocrToTable(new Uint8Array([0, 1, 2]), provider);
    expect(table.source_format).toEqual('image_ocr');
    expect(table.headers[0]).toEqual('reference');
    expect(table.rows.length).toBeGreaterThanOrEqual(3);
  });
});
