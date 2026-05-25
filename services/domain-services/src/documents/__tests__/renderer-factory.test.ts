/**
 * Renderer factory — enforces document-vs-imagery separation
 * and never lets Nano Banana sneak into document rendering.
 */

import { describe, it, expect } from 'vitest';
import { RendererFactory } from '../renderers/renderer-factory.js';
import { RendererError } from '../renderers/renderer-interface.js';

describe('RendererFactory', () => {
  const factory = new RendererFactory();

  it('returns text renderer for document context', () => {
    const r = factory.get({ kind: 'text', context: 'document' });
    expect(r.kind).toBe('text');
  });

  it('returns nano-banana renderer only for marketing-imagery context', () => {
    const r = factory.get({ kind: 'nano-banana', context: 'marketing-imagery' });
    expect(r.kind).toBe('nano-banana');
  });

  it('refuses nano-banana when context is document', () => {
    expect(() => factory.get({ kind: 'nano-banana', context: 'document' })).toThrow(
      RendererError
    );
  });

  it('refuses docxtemplater in marketing-imagery context', () => {
    expect(() =>
      factory.get({ kind: 'docxtemplater', context: 'marketing-imagery' })
    ).toThrow(RendererError);
  });

  it('lists document renderers and imagery renderers separately', () => {
    expect(factory.listDocumentRenderers().map((r) => r.kind)).toEqual([
      'text',
      'docxtemplater',
      'react-pdf',
      'typst',
    ]);
    expect(factory.listImageryRenderers().map((r) => r.kind)).toEqual(['nano-banana']);
  });
});
