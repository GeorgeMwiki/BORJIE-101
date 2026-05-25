import { describe, expect, it } from 'vitest';
import { getRenderer } from './renderer-factory-v2';

describe('renderer-factory-v2 guardrail', () => {
  it('rejects nano-banana for document context', () => {
    expect(() => getRenderer('nano-banana', 'document')).toThrow();
  });

  it('rejects docxtemplater for marketing-imagery context', () => {
    expect(() => getRenderer('docxtemplater', 'marketing-imagery')).toThrow();
  });

  it('rejects react-pdf for marketing-imagery context', () => {
    expect(() => getRenderer('react-pdf', 'marketing-imagery')).toThrow();
  });

  it('returns working renderers for document context', () => {
    const text = getRenderer('text', 'document');
    const docx = getRenderer('docxtemplater', 'document');
    const pdf = getRenderer('react-pdf', 'document');
    expect(text.kind).toBe('text');
    expect(docx.kind).toBe('docxtemplater');
    expect(pdf.kind).toBe('react-pdf');
  });
});
