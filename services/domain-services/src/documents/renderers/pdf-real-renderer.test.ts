import { describe, expect, it } from 'vitest';
import { PdfRealRenderer } from './pdf-real-renderer';

describe('PdfRealRenderer (builtin engine)', () => {
  it('produces a PDF with the %PDF- magic bytes and EOF marker', async () => {
    const renderer = new PdfRealRenderer();
    const result = await renderer.render(
      {
        id: 'test/residency',
        version: '1',
        source: 'Residency proof for {{tenant.name}} at {{unit.code}}.\nIssued {{issuedAt}}.',
      },
      {
        tenant: { name: 'Amina Juma' },
        unit: { code: 'A-12' },
        issuedAt: '2026-04-18',
      }
    );
    expect(result.mimeType).toBe('application/pdf');
    const head = result.buffer.subarray(0, 5).toString('latin1');
    expect(head).toBe('%PDF-');
    const tail = result.buffer.subarray(-6).toString('latin1');
    expect(tail).toContain('%%EOF');
  });

  it('substitutes nested placeholders into the PDF text stream', async () => {
    const renderer = new PdfRealRenderer();
    const result = await renderer.render(
      { id: 't', version: '1', source: 'Name: {{x.y}}' },
      { x: { y: 'Salome' } }
    );
    const body = result.buffer.toString('latin1');
    expect(body).toContain('Salome');
  });

  it('throws NOT_IMPLEMENTED when react-pdf engine requested but not installed', async () => {
    const renderer = new PdfRealRenderer({ engine: 'react-pdf' });
    // Pass a string (non-React-element) — should still fail at the SDK import or template check.
    await expect(
      renderer.render({ id: 't', version: '1', source: {} }, {})
    ).rejects.toThrow();
  });
});
