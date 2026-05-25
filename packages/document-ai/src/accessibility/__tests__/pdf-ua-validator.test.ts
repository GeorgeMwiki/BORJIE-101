import { describe, expect, it } from 'vitest';
import {
  addAccessibilityTags,
  enforceAccessibility,
} from '../pdf-ua-validator.js';

function pdfBytes(body: string): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF\n`);
}

describe('enforceAccessibility (PDF/UA-1)', () => {
  it('flags missing struct tree, mark info, and lang', () => {
    const bytes = pdfBytes('/Type /Catalog\n/Title (Lease)');
    const report = enforceAccessibility({ bytes });
    expect(report.conformant).toBe(false);
    const rules = report.issues.map((i) => i.rule);
    expect(rules).toContain('pdfua.marked.true');
    expect(rules).toContain('pdfua.struct.tree');
    expect(rules).toContain('pdfua.lang.attribute');
  });

  it('flags figures without alt text', () => {
    const bytes = pdfBytes(
      '/Type /Catalog\n/MarkInfo /Marked true\n/StructTreeRoot foo\n/Lang (en)\n/Title (T)\n/Figure /Figure'
    );
    const report = enforceAccessibility({ bytes });
    expect(report.issues.some((i) => i.rule === 'pdfua.figure.alt')).toBe(true);
  });

  it('marks document conformant when all rules pass', () => {
    const bytes = pdfBytes(
      '/Type /Catalog\n/MarkInfo /Marked true\n/StructTreeRoot foo\n/Lang (en-US)\n/Title (T)\n/Figure\n/Alt (cover)'
    );
    const report = enforceAccessibility({ bytes });
    expect(report.conformant).toBe(true);
  });

  it('marks missing title as a warning, not an error', () => {
    const bytes = pdfBytes(
      '/Type /Catalog\n/MarkInfo /Marked true\n/StructTreeRoot foo\n/Lang (en)'
    );
    const report = enforceAccessibility({ bytes });
    const titleIssue = report.issues.find((i) => i.rule === 'pdfua.title.required');
    expect(titleIssue?.severity).toBe('warning');
  });
});

describe('addAccessibilityTags', () => {
  it('appends repair hints for missing tags', () => {
    const bytes = pdfBytes('/Type /Catalog');
    const { repaired, issuesAddressed } = addAccessibilityTags(bytes);
    expect(issuesAddressed.length).toBeGreaterThan(0);
    expect(repaired.length).toBeGreaterThan(bytes.length);
  });

  it('is a no-op when nothing is missing', () => {
    const bytes = pdfBytes(
      '/Type /Catalog\n/MarkInfo /Marked true\n/StructTreeRoot foo\n/Lang (en)'
    );
    const { repaired, issuesAddressed } = addAccessibilityTags(bytes);
    expect(issuesAddressed).toEqual([]);
    expect(repaired.length).toBe(bytes.length);
  });
});
