import { describe, expect, it } from 'vitest';
import {
  embedFontsIfMissing,
  enforceArchivalQuality,
} from '../pdf-a-validator.js';

function pdfBytes(body: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF\n`);
}

describe('enforceArchivalQuality', () => {
  it('flags missing XMP metadata as an error', () => {
    const bytes = pdfBytes(
      '/Type /Catalog\n/Type /Font\n/FontFile2 some-data'
    );
    const report = enforceArchivalQuality({ bytes });
    expect(report.conformant).toBe(false);
    const rules = report.issues.map((i) => i.rule);
    expect(rules).toContain('pdfa.xmp.metadata');
  });

  it('flags missing /Type /Catalog as an error', () => {
    const bytes = pdfBytes('/Metadata foo\n/Type /Font\n/FontFile2 stuff');
    const report = enforceArchivalQuality({ bytes });
    expect(report.conformant).toBe(false);
    const rules = report.issues.map((i) => i.rule);
    expect(rules).toContain('pdf.catalog.required');
  });

  it('flags encryption as an error', () => {
    const bytes = pdfBytes(
      '/Type /Catalog\n/Metadata foo\n/Encrypt <<>>\n/Type /Font\n/FontFile2 stuff'
    );
    const report = enforceArchivalQuality({ bytes });
    expect(report.conformant).toBe(false);
    expect(report.issues.some((i) => i.rule === 'pdfa.no.encryption')).toBe(true);
  });

  it('flags missing font embedding when fonts are referenced', () => {
    const bytes = pdfBytes('/Type /Catalog\n/Metadata x\n/Font /F1');
    const report = enforceArchivalQuality({ bytes });
    expect(report.issues.some((i) => i.rule === 'pdfa.fonts.embedded')).toBe(true);
  });

  it('returns conformant=true for a minimally valid stub', () => {
    const bytes = pdfBytes(
      '/Type /Catalog\n/Metadata <<>>\n/Type /Font\n/FontFile2 foo\n/OutputIntent <<>>'
    );
    const report = enforceArchivalQuality({ bytes });
    expect(report.conformant).toBe(true);
  });

  it('flags non-PDF header as an error', () => {
    const bytes = new TextEncoder().encode('not a pdf');
    const report = enforceArchivalQuality({ bytes });
    expect(report.conformant).toBe(false);
    expect(report.issues.some((i) => i.rule === 'pdf.header.present')).toBe(true);
  });
});

describe('embedFontsIfMissing', () => {
  it('appends a repair marker when fonts are missing', () => {
    const bytes = pdfBytes('/Type /Catalog\n/Font /F1');
    const { repaired, issuesAddressed } = embedFontsIfMissing(bytes);
    expect(issuesAddressed).toContain('pdfa.fonts.embedded');
    expect(repaired.length).toBeGreaterThan(bytes.length);
  });

  it('is a no-op when fonts are embedded', () => {
    const bytes = pdfBytes('/Type /Catalog\n/Font /F1\n/FontFile2 stuff');
    const { repaired, issuesAddressed } = embedFontsIfMissing(bytes);
    expect(issuesAddressed).toEqual([]);
    expect(repaired.length).toBe(bytes.length);
  });
});
