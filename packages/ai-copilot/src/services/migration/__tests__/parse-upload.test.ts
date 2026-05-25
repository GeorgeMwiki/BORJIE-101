/**
 * parseUpload dispatcher tests.
 */

import { describe, it, expect } from 'vitest';
import { parseUpload } from '../parsers/parse-upload.js';

describe('parseUpload', () => {
  it('parses CSV by mime type', async () => {
    const csv = 'name,city\nEden Heights,Nairobi\nGreen Park,Dar es Salaam\n';
    const res = await parseUpload(Buffer.from(csv, 'utf8'), 'text/csv', {
      filename: 'roster.csv',
    });
    expect(res.warnings).toEqual([]);
    expect(res.sheets['roster.csv']).toHaveLength(2);
    expect(res.sheets['roster.csv']![0]).toEqual({
      name: 'Eden Heights',
      city: 'Nairobi',
    });
  });

  it('falls back to filename extension when mime is octet-stream', async () => {
    const csv = 'code,name\nDEPT_OPS,Operations\n';
    const res = await parseUpload(
      Buffer.from(csv, 'utf8'),
      'application/octet-stream',
      { filename: 'depts.csv' }
    );
    expect(res.detectedMimeType).toBe('text/csv');
    expect(res.sheets['depts.csv']).toHaveLength(1);
  });

  it('warns (not throws) on unsupported mime', async () => {
    const res = await parseUpload(Buffer.from([]), 'application/zip');
    expect(res.warnings[0]).toMatch(/Unsupported mime type/);
    expect(res.sheets).toEqual({});
  });

  it('returns plainText for text/plain', async () => {
    const res = await parseUpload(
      Buffer.from('Amina Unit A3 KES 45,000', 'utf8'),
      'text/plain'
    );
    expect(res.plainText).toContain('Amina');
  });

  it('warns on PDF without OCR provider', async () => {
    const res = await parseUpload(Buffer.from([0x25, 0x50, 0x44, 0x46]), 'application/pdf');
    expect(res.warnings[0]).toMatch(/PDF uploaded/);
  });
});
