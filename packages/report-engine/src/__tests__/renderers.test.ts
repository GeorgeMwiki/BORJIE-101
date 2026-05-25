/**
 * Renderer unit tests — exercise the PDF, DOCX, PPTX synthesizers
 * directly to lock the lower-level OOXML / PDF assembly behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  renderReportPdf,
  renderReportDocx,
  renderReportPptx,
  sanitizeFilename,
  writeZip,
  escapeXml,
  type RenderPdfInput,
  type RenderDocxInput,
  type RenderPptxInput,
} from '../index.js';
import { __test__ as pdfTest } from '../renderers/pdf.js';
import { __test__ as docxTest } from '../renderers/docx.js';
import { __test__ as pptxTest } from '../renderers/pptx.js';

const SECTIONS = [
  {
    section_id: 's1',
    title: 'Narrative',
    kind: 'narrative' as const,
    narrative: 'Hello world.',
  },
  {
    section_id: 's2',
    title: 'Table',
    kind: 'table' as const,
    table: {
      headers: ['A', 'B'],
      rows: [
        [1, 2],
        [3, 4],
      ],
    },
  },
  {
    section_id: 's3',
    title: 'KPIs',
    kind: 'kpi_grid' as const,
    kpi_grid: {
      metrics: [
        { label: 'Occupancy', value: '93%' },
        { label: 'NOI', value: '78k', delta: '+4%' },
      ],
    },
  },
  {
    section_id: 's4',
    title: 'Chart',
    kind: 'chart' as const,
    chart: { title: 'Trend', spec: { mark: 'line' } },
  },
];

const COMMON_INPUT: Omit<RenderPdfInput, 'sections'> = {
  title: 'Test Report',
  subtitle: 'Demo',
  brand: {
    displayName: 'Acme',
    primaryColor: '#1F3864',
    accentColor: '#FFC000',
  },
  generatedAt: new Date('2026-05-22T00:00:00Z'),
};

describe('renderReportPdf', () => {
  it('produces a valid PDF magic header', () => {
    const out = renderReportPdf({ ...COMMON_INPUT, sections: SECTIONS });
    expect(out.buffer.slice(0, 5).toString()).toBe('%PDF-');
    expect(out.mimeType).toBe('application/pdf');
    expect(out.filename).toBe('test_report.pdf');
  });

  it('escapes PDF special characters', () => {
    expect(pdfTest.escapePdfText('hello (world)')).toBe('hello \\(world\\)');
    expect(pdfTest.escapePdfText('back\\slash')).toBe('back\\\\slash');
  });

  it('parses 6-character hex colors', () => {
    expect(pdfTest.hexToRgb('#FF0000')).toEqual([255, 0, 0]);
    expect(pdfTest.hexToRgb('00FF00')).toEqual([0, 255, 0]);
    expect(pdfTest.hexToRgb('invalid')).toBeUndefined();
    expect(pdfTest.hexToRgb(undefined)).toBeUndefined();
  });

  it('word-wraps long narratives without losing content', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const wrapped = pdfTest.wrapText(long, 50);
    expect(wrapped.length).toBeGreaterThan(1);
    const rebuilt = wrapped.join(' ');
    expect(rebuilt).toBe(long);
  });

  it('handles empty section list', () => {
    const out = renderReportPdf({ ...COMMON_INPUT, sections: [] });
    expect(out.buffer.length).toBeGreaterThan(100);
  });

  it('paginates onto multiple pages when content exceeds one page', () => {
    const manySections = Array.from({ length: 30 }, (_, i) => ({
      section_id: `s${i}`,
      title: `Section ${i}`,
      kind: 'narrative' as const,
      narrative: 'Lorem ipsum dolor sit amet. '.repeat(40),
    }));
    const out = renderReportPdf({ ...COMMON_INPUT, sections: manySections });
    const body = out.buffer.toString('binary');
    // Multi-page should produce >= 2 page objects.
    const pageObjects = (body.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pageObjects).toBeGreaterThan(1);
  });
});

describe('renderReportDocx', () => {
  it('produces a ZIP with the right structure', () => {
    const out = renderReportDocx({
      ...COMMON_INPUT,
      sections: SECTIONS,
    } satisfies RenderDocxInput);
    // PK\x03\x04 magic
    expect(out.buffer[0]).toBe(0x50);
    expect(out.buffer[1]).toBe(0x4b);
    expect(out.buffer[2]).toBe(0x03);
    expect(out.buffer[3]).toBe(0x04);
    expect(out.filename).toBe('test_report.docx');
  });

  it('escapes XML special characters in titles', () => {
    const xml = docxTest.buildDocumentXml({
      ...COMMON_INPUT,
      sections: [
        {
          section_id: 's1',
          title: 'Tom & Jerry <Show>',
          kind: 'narrative',
          narrative: 'Hi',
        },
      ],
    } satisfies RenderDocxInput);
    expect(xml).toContain('Tom &amp; Jerry &lt;Show&gt;');
    expect(xml).not.toContain('Tom & Jerry <Show>');
  });

  it('emits a table with the right cell count', () => {
    const xml = docxTest.renderTable(
      ['A', 'B', 'C'],
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
    );
    const trCount = (xml.match(/<w:tr>/g) ?? []).length;
    expect(trCount).toBe(3); // header + 2 body
    const tcCount = (xml.match(/<w:tc>/g) ?? []).length;
    expect(tcCount).toBe(9);
  });
});

describe('renderReportPptx', () => {
  it('produces a ZIP with presentation.xml', () => {
    const out = renderReportPptx({
      ...COMMON_INPUT,
      sections: SECTIONS,
    } satisfies RenderPptxInput);
    expect(out.buffer[0]).toBe(0x50);
    expect(out.buffer[1]).toBe(0x4b);
    expect(out.filename).toBe('test_report.pptx');
  });

  it('builds presentation XML with 1 + N slides', () => {
    const xml = pptxTest.buildPresentationXml(4, 13.333, 7.5);
    const sldIds = (xml.match(/<p:sldId\b/g) ?? []).length;
    expect(sldIds).toBe(4);
  });

  it('converts inches to EMU correctly', () => {
    expect(pptxTest.inToEmu(1)).toBe(914400);
    expect(pptxTest.inToEmu(0.5)).toBe(457200);
  });

  it('normalises hex strings to upper-case 6-char', () => {
    expect(pptxTest.normaliseHex('#abcdef')).toBe('ABCDEF');
    expect(pptxTest.normaliseHex('123456')).toBe('123456');
  });

  it('accepts an optional theme override', () => {
    const out = renderReportPptx({
      ...COMMON_INPUT,
      sections: SECTIONS,
      theme: {
        dimensions: { w: 10, h: 7.5 },
        colors: { primary: '#FF0000' },
        fonts: { body: 'Lato' },
      },
    });
    expect(out.buffer.length).toBeGreaterThan(0);
  });
});

describe('shared helpers', () => {
  it('sanitizeFilename strips non-alphanumeric', () => {
    expect(sanitizeFilename('Hello, World! 2026 (Q3)')).toBe(
      'hello_world_2026_q3',
    );
    expect(sanitizeFilename('A'.repeat(200)).length).toBeLessThanOrEqual(64);
  });

  it('escapeXml round-trips known entities', () => {
    expect(escapeXml('<a&b>"c\'d')).toBe('&lt;a&amp;b&gt;&quot;c&apos;d');
  });

  it('writeZip produces a valid ZIP header and end-of-central directory', () => {
    const zip = writeZip([{ name: 'hello.txt', data: Buffer.from('hi') }]);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    const tail = zip.slice(zip.length - 22);
    // End-of-central-directory magic: PK\x05\x06
    expect(tail[0]).toBe(0x50);
    expect(tail[1]).toBe(0x4b);
    expect(tail[2]).toBe(0x05);
    expect(tail[3]).toBe(0x06);
  });
});
