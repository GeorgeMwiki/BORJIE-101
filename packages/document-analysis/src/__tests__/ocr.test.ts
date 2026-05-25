import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../ocr/language.js';
import { extractText } from '../ocr/extract-text.js';
import { TesseractUnavailableError, runTesseract } from '../ocr/tesseract-adapter.js';
import { loadFixture } from './fixtures.js';

/**
 * Some assertions only hold when the optional OCR deps are NOT installed.
 * Detect availability up front so the test asserts the right path.
 */
async function isDepAvailable(name: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await (import(name as string).catch(() => null));
    return mod !== null;
  } catch {
    return false;
  }
}

const tesseractAvailable = await isDepAvailable('tesseract.js');
const pdfParseAvailable = await isDepAvailable('pdf-parse');

describe('detectLanguage', () => {
  it('identifies an English document', () => {
    const text = loadFixture('lease-application');
    // mostly English with Swahili phrase mixed in → still English-dominant.
    expect(detectLanguage(text)).toBe('en');
  });

  it('identifies Swahili-heavy text', () => {
    const text =
      'Mkataba wa upangaji ni kati ya mwenye nyumba na mpangaji. Kodi ya mwezi ni TZS 850,000. Tarehe ya kuanza kwa mkataba ni leo.';
    expect(detectLanguage(text)).toBe('sw');
  });

  it('returns mixed for empty or unrecognised text', () => {
    expect(detectLanguage('')).toBe('mixed');
    expect(detectLanguage('xyz qwerty zzz')).toBe('mixed');
  });
});

describe('extractText — text-like MIME', () => {
  it('decodes a string buffer for text/plain', async () => {
    const out = await extractText({
      content: 'hello world',
      mimeType: 'text/plain',
    });
    expect(out.method).toBe('native');
    expect(out.text).toBe('hello world');
    expect(out.confidence).toBe(1);
  });

  it('decodes a Buffer', async () => {
    const out = await extractText({
      content: Buffer.from('Lease Agreement between A and B'),
      mimeType: 'text/plain',
    });
    expect(out.text).toContain('Lease Agreement');
    expect(out.language).toBe('en');
  });
});

describe('extractText — text-decoding path is exhaustive', () => {
  it('decodes a markdown body', async () => {
    const out = await extractText({
      content: '# Hello\n\nworld',
      mimeType: 'text/markdown',
    });
    expect(out.method).toBe('native');
    expect(out.text).toContain('Hello');
  });
  it('decodes JSON as text', async () => {
    const out = await extractText({
      content: '{"x":1}',
      mimeType: 'application/json',
    });
    expect(out.method).toBe('native');
    expect(out.text).toBe('{"x":1}');
  });
  it('decodes unknown MIME via best-effort native', async () => {
    const out = await extractText({
      content: 'some bytes',
      mimeType: 'application/octet-stream',
    });
    expect(out.method).toBe('native');
    expect(out.confidence).toBeLessThan(1);
  });
});

describe('OCR availability sanity', () => {
  it(
    'unavailable Tesseract → typed error (skipped when installed)',
    async () => {
      if (tesseractAvailable) {
        // Engine is installed and uses a worker; cannot exercise the
        // unavailable branch without uninstalling the dep at runtime.
        return;
      }
      await expect(runTesseract(Buffer.from([]))).rejects.toBeInstanceOf(
        TesseractUnavailableError,
      );
    },
  );

  it('lazy import probe never throws', () => {
    expect(typeof pdfParseAvailable).toBe('boolean');
    expect(typeof tesseractAvailable).toBe('boolean');
  });
});
