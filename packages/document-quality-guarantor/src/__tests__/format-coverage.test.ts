/**
 * Format-coverage tests — verify all 17 built-in handlers, mime
 * routing, and the `register()` override path.
 */
import { describe, expect, it } from 'vitest';
import { BUILT_IN_HANDLERS, createFormatRegistry } from '../format-coverage/index.js';
import { SUPPORTED_FORMATS } from '../types.js';

describe('format-coverage', () => {
  it('ships a handler for every format in SUPPORTED_FORMATS (17 total)', () => {
    expect(SUPPORTED_FORMATS.length).toBe(17);
    for (const format of SUPPORTED_FORMATS) {
      const handler = BUILT_IN_HANDLERS.find((h) => h.format === format);
      expect(handler, `missing handler for ${format}`).toBeDefined();
      expect(handler!.engineChain.length).toBeGreaterThan(0);
      expect(handler!.mimeTypes.length).toBeGreaterThan(0);
    }
  });

  it('routes mime → handler (lowercased lookup)', () => {
    const reg = createFormatRegistry();
    expect(reg.byMime('application/pdf')?.format).toBe('pdf');
    expect(reg.byMime('APPLICATION/PDF')?.format).toBe('pdf');
    expect(reg.byMime('text/markdown')?.format).toBe('md');
    expect(reg.byMime('text/html')?.format).toBe('html');
    expect(reg.byMime('not/a/real-mime')).toBeUndefined();
  });

  it('routes format → handler', () => {
    const reg = createFormatRegistry();
    for (const format of SUPPORTED_FORMATS) {
      expect(reg.byFormat(format)).toBeDefined();
    }
  });

  it('register() overrides a built-in handler', () => {
    const reg = createFormatRegistry();
    const before = reg.byFormat('pdf')!;
    expect(before.engineChain[0]).toBe('typst');
    reg.register({
      format: 'pdf',
      direction: 'output',
      mimeTypes: ['application/pdf'],
      engineChain: ['custom-pdf-engine'],
    });
    const after = reg.byFormat('pdf')!;
    expect(after.engineChain[0]).toBe('custom-pdf-engine');
  });

  it('register() adds a brand new mime → handler mapping', () => {
    const reg = createFormatRegistry([]);
    reg.register({
      format: 'json',
      direction: 'both',
      mimeTypes: ['application/x-vendor-json'],
      engineChain: ['vendor'],
    });
    expect(reg.byMime('application/x-vendor-json')?.format).toBe('json');
  });

  it('intake-only formats (image, msg) reject output direction', () => {
    const image = BUILT_IN_HANDLERS.find((h) => h.format === 'image')!;
    expect(image.direction).toBe('intake');
    const msg = BUILT_IN_HANDLERS.find((h) => h.format === 'msg')!;
    expect(msg.direction).toBe('intake');
  });
});
