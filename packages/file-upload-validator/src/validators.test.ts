/**
 * Magic-byte (content-signature) validation tests — guards against
 * polyglot / MIME-confusion uploads where the declared Content-Type lies
 * about the real file content.
 */

import { describe, it, expect } from 'vitest';
import {
  assertMagicMatchesDeclared,
  validateFile,
  FileValidationError,
} from './validators.js';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]); // PK..
const ELF = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]); // ELF exe
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('assertMagicMatchesDeclared', () => {
  it('passes when bytes match the declared MIME', () => {
    expect(() => assertMagicMatchesDeclared(PDF, 'application/pdf')).not.toThrow();
    expect(() => assertMagicMatchesDeclared(PNG, 'image/png')).not.toThrow();
    expect(() => assertMagicMatchesDeclared(ZIP, DOCX_MIME)).not.toThrow();
  });

  it('throws MAGIC_MISMATCH when content lies about its type', () => {
    // An ELF executable claiming to be a PDF.
    expect(() => assertMagicMatchesDeclared(ELF, 'application/pdf')).toThrow(
      FileValidationError,
    );
    // A PNG renamed/relabelled as a DOCX.
    try {
      assertMagicMatchesDeclared(PNG, DOCX_MIME);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(FileValidationError);
      expect((e as FileValidationError).code).toBe('MAGIC_MISMATCH');
    }
  });

  it('allows text MIMEs (no reliable signature)', () => {
    const csv = new Uint8Array([0x61, 0x2c, 0x62, 0x0a]); // "a,b\n"
    expect(() => assertMagicMatchesDeclared(csv, 'text/csv')).not.toThrow();
    expect(() => assertMagicMatchesDeclared(ELF, 'text/plain')).not.toThrow();
  });
});

describe('validateFile with bytes', () => {
  it('rejects a content/type mismatch via the magic-byte path', () => {
    expect(() =>
      validateFile({
        file: { name: 'invoice.pdf', size: ELF.length, type: 'application/pdf' },
        categories: ['pdf'],
        bytes: ELF,
      }),
    ).toThrow(FileValidationError);
  });

  it('accepts a genuine PDF', () => {
    expect(() =>
      validateFile({
        file: { name: 'invoice.pdf', size: PDF.length, type: 'application/pdf' },
        categories: ['pdf'],
        bytes: PDF,
      }),
    ).not.toThrow();
  });

  it('stays backward-compatible when bytes are omitted', () => {
    expect(() =>
      validateFile({
        file: { name: 'invoice.pdf', size: 1024, type: 'application/pdf' },
        categories: ['pdf'],
      }),
    ).not.toThrow();
  });
});
