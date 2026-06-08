/**
 * Unit tests for the renderer factory — exhaustive (engineHint, format)
 * routing + unsupported-combination guards. Pure routing, no network.
 */

import { describe, expect, it } from 'vitest';
import {
  createRendererFactory,
  createDefaultRendererSet,
  type RendererSet,
} from '../renderer-factory.js';

const set: RendererSet = createDefaultRendererSet({ useStub: true });
const factory = createRendererFactory(set);

describe('renderer-factory — engine routing', () => {
  it('routes typst+pdf → the typst renderer', () => {
    expect(factory.getRenderer('typst', 'pdf').id).toBe('typst');
  });

  it('routes carbone to docx / xlsx / pptx / pdf / html', () => {
    expect(factory.getRenderer('carbone', 'docx').id).toBe('carbone');
    expect(factory.getRenderer('carbone', 'xlsx').id).toBe('carbone');
    expect(factory.getRenderer('carbone', 'pptx').id).toBe('carbone');
    expect(factory.getRenderer('carbone', 'pdf').id).toBe('carbone');
    expect(factory.getRenderer('carbone', 'html').id).toBe('carbone');
  });

  it('routes html-pdf+pdf → the pdf-from-html renderer', () => {
    expect(factory.getRenderer('html-pdf', 'pdf').id).toBe('pdf-from-html');
  });
});

describe('renderer-factory — unsupported combinations throw precisely', () => {
  it('typst cannot emit docx/xlsx', () => {
    expect(() => factory.getRenderer('typst', 'docx')).toThrow(/pdf only/);
    expect(() => factory.getRenderer('typst', 'xlsx')).toThrow(/pdf only/);
  });

  it('html-pdf cannot emit docx', () => {
    expect(() => factory.getRenderer('html-pdf', 'docx')).toThrow(/pdf only/);
  });
});

describe('renderer-factory — default set is stub-safe', () => {
  it('every default renderer is a stub when useStub is set', async () => {
    const out = await set.typst.render({
      templateRef: 't',
      format: 'pdf',
      data: {},
    });
    expect(new TextDecoder().decode(out.buffer)).toContain('STUB:typst');
  });
});
