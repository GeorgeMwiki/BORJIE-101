import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  ingestionStatusLabel,
  kindLabel,
  validateUpload,
} from '@/documents/types';

/**
 * Owner-web document-intelligence — pure data tests.
 *
 * Covers the validation contract + bilingual sw/en labels that drive
 * the upload button + list chips. The React components under
 * `src/documents/` consume these helpers directly; testing the helpers
 * keeps the contract green without a JSDOM render pass.
 */

describe('owner-web documents.validateUpload', () => {
  it('rejects an empty filename', () => {
    const r = validateUpload({
      fileName: '',
      mimeType: 'application/pdf',
      fileSize: 1024,
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a disallowed mime', () => {
    const r = validateUpload({
      fileName: 'malware.exe',
      mimeType: 'application/x-msdownload',
      fileSize: 1024,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('MIME_NOT_ALLOWED');
    }
  });

  it('rejects an empty payload', () => {
    const r = validateUpload({
      fileName: 'empty.pdf',
      mimeType: 'application/pdf',
      fileSize: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('FILE_EMPTY');
    }
  });

  it('rejects payloads over 25 MB', () => {
    const r = validateUpload({
      fileName: 'big.pdf',
      mimeType: 'application/pdf',
      fileSize: MAX_FILE_BYTES + 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('FILE_TOO_LARGE');
    }
  });

  it('accepts a valid contract PDF', () => {
    const r = validateUpload({
      fileName: 'mkataba-2026.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024 * 1024,
    });
    expect(r.ok).toBe(true);
  });
});

describe('owner-web documents.label helpers', () => {
  it('defaults to Swahili for status labels', () => {
    expect(ingestionStatusLabel('queued')).toBe('Imewekwa kwenye foleni');
    expect(ingestionStatusLabel('processing')).toBe('Inachakatwa');
    expect(ingestionStatusLabel('ready')).toBe('Tayari');
    expect(ingestionStatusLabel('failed')).toBe('Imeshindikana');
  });

  it('switches to English when requested', () => {
    expect(ingestionStatusLabel('queued', 'en')).toBe('Queued');
    expect(ingestionStatusLabel('ready', 'en')).toBe('Ready');
  });

  it('returns bilingual kind labels', () => {
    expect(kindLabel('contract')).toBe('Mkataba');
    expect(kindLabel('contract', 'en')).toBe('Contract');
    expect(kindLabel('rfp')).toBe('Zabuni');
    expect(kindLabel('rfp', 'en')).toBe('RFP / Tender');
  });
});

describe('owner-web documents.ALLOWED_MIMES', () => {
  it('ships PDF + DOCX + image coverage', () => {
    expect(ALLOWED_MIMES).toContain('application/pdf');
    expect(
      ALLOWED_MIMES.find((m) => m.includes('wordprocessingml.document')),
    ).toBeTruthy();
    expect(ALLOWED_MIMES.find((m) => m.startsWith('image/'))).toBeTruthy();
  });
});
