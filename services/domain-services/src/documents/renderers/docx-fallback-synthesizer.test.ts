import { describe, expect, it } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import { synthesizeDocxFromText } from './docx-fallback-synthesizer';

/**
 * Extract and decompress the `word/document.xml` entry from a synthesized
 * .docx buffer. The writer stores files with deflate (method 8), so the
 * rendered text is NOT present in the raw bytes — we have to walk the
 * local-file headers, find the entry, then inflate the compressed payload.
 */
function extractDocumentXml(buf: Buffer): string {
  const LFH_SIG = 0x04034b50;
  let offset = 0;
  while (offset < buf.length - 4) {
    if (buf.readUInt32LE(offset) !== LFH_SIG) break;
    const compressedSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.slice(nameStart, nameStart + nameLen).toString('utf-8');
    const dataStart = nameStart + nameLen + extraLen;
    if (name === 'word/document.xml') {
      const compressed = buf.slice(dataStart, dataStart + compressedSize);
      return inflateRawSync(compressed).toString('utf-8');
    }
    offset = dataStart + compressedSize;
  }
  throw new Error('word/document.xml not found in synthesized .docx');
}

describe('synthesizeDocxFromText', () => {
  it('produces a non-empty buffer with .docx magic bytes (PK\\x03\\x04)', () => {
    const buf = synthesizeDocxFromText('Hello {{name}}', { name: 'Salome' });
    expect(buf.length).toBeGreaterThan(100);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
  });

  it('substitutes nested placeholders', () => {
    const buf = synthesizeDocxFromText(
      'Tenant: {{tenant.name}} — Unit: {{unit.code}}',
      { tenant: { name: 'Alpha Ltd' }, unit: { code: 'A-12' } }
    );
    const text = extractDocumentXml(buf);
    expect(text).toContain('Alpha Ltd');
    expect(text).toContain('A-12');
  });

  it('leaves unknown placeholders literal', () => {
    const buf = synthesizeDocxFromText('Hello {{missing}}', {});
    const text = extractDocumentXml(buf);
    expect(text).toContain('{{missing}}');
  });

  it('escapes XML-special characters', () => {
    const buf = synthesizeDocxFromText('<b>{{x}}</b>', { x: '< & >' });
    const text = extractDocumentXml(buf);
    expect(text).toContain('&lt;b&gt;');
  });
});
