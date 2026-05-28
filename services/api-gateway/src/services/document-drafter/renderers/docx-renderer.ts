/**
 * DOCX renderer — emits a valid Office Open XML (.docx) document from a
 * markdown body with Borjie brand styling baked into the header/footer.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. No external deps — uses the in-tree
 * `zip-writer.ts` and a hand-rolled minimal OOXML schema (Word does
 * not require every optional part). The output validates in Word,
 * LibreOffice, Google Docs and Apple Pages.
 *
 * Markdown subset: headings (#, ##, ###), paragraphs, bullet lists,
 * ordered lists, horizontal rules, bold (**) inside paragraphs.
 */

import type { BrandContext } from '../brand.js';
import { brandFooterText } from '../brand.js';
import { createZip } from './zip-writer.js';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const DOCX_CONTENT_TYPE = MIME_DOCX;

export function renderDocx(body: string, ctx: BrandContext): Buffer {
  const documentXml = buildDocumentXml(body, ctx);
  const headerXml = buildHeaderXml(ctx);
  const footerXml = buildFooterXml(ctx);
  const stylesXml = buildStylesXml();
  const contentTypesXml = buildContentTypesXml();
  const relsXml = buildRootRelsXml();
  const docRelsXml = buildDocRelsXml();
  const appXml = buildAppXml(ctx);
  const coreXml = buildCoreXml(ctx);

  return createZip([
    { name: '[Content_Types].xml', data: contentTypesXml, store: true },
    { name: '_rels/.rels', data: relsXml },
    { name: 'docProps/app.xml', data: appXml },
    { name: 'docProps/core.xml', data: coreXml },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/header1.xml', data: headerXml },
    { name: 'word/footer1.xml', data: footerXml },
    { name: 'word/styles.xml', data: stylesXml },
    { name: 'word/_rels/document.xml.rels', data: docRelsXml },
  ]);
}

function buildContentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;
}

function buildRootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildDocRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;
}

function buildAppXml(ctx: BrandContext): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Borjie Drafter</Application>
  <Company>${xmlEscape(ctx.tenantName)}</Company>
</Properties>`;
}

function buildCoreXml(ctx: BrandContext): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(ctx.title)}</dc:title>
  <dc:creator>${xmlEscape(ctx.author)}</dc:creator>
  <cp:lastModifiedBy>${xmlEscape(ctx.author)}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${ctx.renderedAtUtc}</dcterms:created>
</cp:coreProperties>`;
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter" w:cs="Inter"/><w:sz w:val="22"/></w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Syne" w:hAnsi="Syne"/><w:b/><w:sz w:val="40"/><w:color w:val="0B0D12"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Syne" w:hAnsi="Syne"/><w:b/><w:sz w:val="30"/><w:color w:val="0B0D12"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="0B0D12"/></w:rPr>
  </w:style>
</w:styles>`;
}

function buildHeaderXml(ctx: BrandContext): string {
  const text = `Borjie | ${ctx.tenantName} | ${ctx.title}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Syne" w:hAnsi="Syne"/><w:b/><w:color w:val="C8A24B"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>
  </w:p>
</w:hdr>`;
}

function buildFooterXml(ctx: BrandContext): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>
    <w:r><w:rPr><w:sz w:val="16"/><w:color w:val="5C5F66"/></w:rPr><w:t xml:space="preserve">${xmlEscape(brandFooterText(ctx))}</w:t></w:r>
  </w:p>
</w:ftr>`;
}

function buildDocumentXml(body: string, ctx: BrandContext): string {
  const paragraphs = markdownToDocxParagraphs(body);
  void ctx; // header/footer wired via sectPr below
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:footerReference w:type="default" r:id="rId3"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function markdownToDocxParagraphs(md: string): string {
  const lines = md.split(/\r?\n/);
  const parts: string[] = [];
  for (const raw of lines) {
    const line = raw;
    if (line.trim() === '') {
      parts.push('<w:p/>');
      continue;
    }
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      parts.push(headingPara(h1[1] ?? '', 'Heading1'));
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      parts.push(headingPara(h2[1] ?? '', 'Heading2'));
      continue;
    }
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      parts.push(headingPara(h3[1] ?? '', 'Heading3'));
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      parts.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:color="C8A24B"/></w:pBdr></w:pPr></w:p>');
      continue;
    }
    const num = /^\d+\.\s+(.+)$/.exec(line);
    if (num) {
      parts.push(listPara(num[1] ?? ''));
      continue;
    }
    const bul = /^[-*]\s+(.+)$/.exec(line);
    if (bul) {
      parts.push(listPara(bul[1] ?? ''));
      continue;
    }
    parts.push(plainPara(line));
  }
  return parts.join('\n');
}

function headingPara(text: string, style: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(stripInlineMarkup(text))}</w:t></w:r></w:p>`;
}

function listPara(text: string): string {
  return `<w:p><w:pPr><w:ind w:left="360"/></w:pPr><w:r><w:t xml:space="preserve">• ${xmlEscape(stripInlineMarkup(text))}</w:t></w:r></w:p>`;
}

function plainPara(text: string): string {
  const runs = runsFromMarkup(text);
  return `<w:p>${runs}</w:p>`;
}

function runsFromMarkup(text: string): string {
  const parts: string[] = [];
  const re = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(plainRun(text.slice(last, m.index)));
    }
    parts.push(boldRun(m[1] ?? ''));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(plainRun(text.slice(last)));
  return parts.join('');
}

function plainRun(t: string): string {
  return `<w:r><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r>`;
}

function boldRun(t: string): string {
  return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r>`;
}

function stripInlineMarkup(text: string): string {
  return text.replace(/\*\*/g, '').replace(/`/g, '');
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
