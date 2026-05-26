/**
 * PPTX brander — emits a brand-locked .pptx package with one slide per
 * IRSection. Speaker notes carry the section's citations per spec §6
 * ("PPTX — speaker-notes footer with citations").
 *
 * Slide master colours come exclusively from `BRAND_COLOR_PALETTE`.
 */

import { createHash } from 'node:crypto';
import type { IRDoc, IRSection } from '../types.js';
import { CompositionError } from '../types.js';
import {
  validateNativeBrandColors,
  validateNativeBrandFonts,
} from './brand-validator.js';
import { writeZip, escapeXml } from './ooxml-zip.js';

const BRAND_PRIMARY = '#1F3864';
const BRAND_ACCENT = '#C45B12';
const BRAND_BG = '#ffffff';
const BRAND_FG = '#0f172a';
const BRAND_FONT = 'Inter';

const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function stripHash(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

function contentTypesXml(slideCount: number): string {
  const overrides = [
    '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
  ];
  for (let i = 1; i <= slideCount; i += 1) {
    overrides.push(
      `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
    overrides.push(
      `<Override PartName="/ppt/notesSlides/notesSlide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    overrides.join('') +
    `</Types>`
  );
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

function presentationXml(slideCount: number): string {
  const slideIds: string[] = [];
  for (let i = 1; i <= slideCount; i += 1) {
    slideIds.push(`<p:sldId id="${255 + i}" r:id="rId${i}"/>`);
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:presentation xmlns:p="${P_NS}" xmlns:r="${R_NS}">` +
    `<p:sldIdLst>${slideIds.join('')}</p:sldIdLst>` +
    `<p:sldSz cx="9144000" cy="6858000"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/>` +
    `</p:presentation>`
  );
}

function presentationRels(slideCount: number): string {
  const relationships: string[] = [];
  for (let i = 1; i <= slideCount; i += 1) {
    relationships.push(
      `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`,
    );
  }
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    relationships.join('') +
    `</Relationships>`
  );
}

function slideXml(title: string, body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="${A_NS}" xmlns:p="${P_NS}" xmlns:r="${R_NS}">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    // Title
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="457200" y="457200"/><a:ext cx="8229600" cy="800100"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>` +
    `<a:rPr lang="en-US" sz="3200" b="1"><a:solidFill><a:srgbClr val="${stripHash(BRAND_PRIMARY)}"/></a:solidFill>` +
    `<a:latin typeface="${BRAND_FONT}"/></a:rPr>` +
    `<a:t>${escapeXml(title)}</a:t></a:r></a:p></p:txBody></p:sp>` +
    // Body
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="457200" y="1371600"/><a:ext cx="8229600" cy="4800600"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>` +
    `<a:rPr lang="en-US" sz="1800"><a:solidFill><a:srgbClr val="${stripHash(BRAND_FG)}"/></a:solidFill>` +
    `<a:latin typeface="${BRAND_FONT}"/></a:rPr>` +
    `<a:t>${escapeXml(body)}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:sld>`
  );
}

function slideRels(slideIdx: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideIdx}.xml"/>` +
    `</Relationships>`
  );
}

function notesSlideXml(notesText: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:notes xmlns:a="${A_NS}" xmlns:p="${P_NS}" xmlns:r="${R_NS}">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>` +
    `<a:rPr lang="en-US" sz="1400"><a:solidFill><a:srgbClr val="${stripHash(BRAND_FG)}"/></a:solidFill>` +
    `<a:latin typeface="${BRAND_FONT}"/></a:rPr>` +
    `<a:t>${escapeXml(notesText)}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `</p:spTree></p:cSld></p:notes>`
  );
}

function notesSlideRels(slideIdx: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideIdx}.xml"/>` +
    `</Relationships>`
  );
}

function bodyTextFromSection(section: IRSection): string {
  const lines: string[] = [];
  for (const block of section.blocks) {
    if (block.kind === 'heading' && block.text !== undefined) {
      lines.push(block.text);
    } else if (block.kind === 'paragraph' && block.text !== undefined) {
      const suffix =
        block.citationId !== undefined && block.citationId.length > 0
          ? ` [${block.citationId}]`
          : '';
      lines.push(`• ${block.text}${suffix}`);
    } else if (block.kind === 'kpi_grid' && block.kpis !== undefined) {
      for (const k of block.kpis) {
        lines.push(`• ${k.label}: ${k.value}`);
      }
    }
  }
  return lines.join('\n');
}

function speakerNotesFromSection(
  section: IRSection,
  doc: IRDoc,
): string {
  const citationLookup = new Map(doc.citations.map((c) => [c.id, c] as const));
  const lines: string[] = [`Section: ${section.title}`];
  if (section.citationIds.length > 0) {
    lines.push('Citations:');
    for (const id of section.citationIds) {
      const c = citationLookup.get(id);
      if (c !== undefined) {
        lines.push(`  [${c.id}] ${c.claim} — ${c.source.kind}:${c.source.ref}`);
      }
    }
  }
  return lines.join('\n');
}

export interface BrandPptxResult {
  readonly bytes: Buffer;
  readonly checksum: string;
}

/**
 * Render an IRDoc to a brand-locked .pptx — one slide per section,
 * plus a title slide. Speaker notes carry the citation footer.
 */
export function brandPptx(doc: IRDoc): BrandPptxResult {
  const colors = [BRAND_PRIMARY, BRAND_ACCENT, BRAND_BG, BRAND_FG];
  const fonts = [BRAND_FONT];

  const colorLint = validateNativeBrandColors(colors);
  if (!colorLint.ok) {
    throw new CompositionError(
      'BRAND_VIOLATION',
      'pptx-brander emitted non-token colour',
      colorLint.violations,
    );
  }
  const fontLint = validateNativeBrandFonts(fonts);
  if (!fontLint.ok) {
    throw new CompositionError(
      'BRAND_VIOLATION',
      'pptx-brander emitted unregistered font',
      fontLint.violations,
    );
  }

  const titleSection: IRSection = {
    id: 'title',
    title: doc.title,
    blocks: [
      {
        kind: 'paragraph',
        text:
          doc.subtitle !== undefined && doc.subtitle.length > 0
            ? doc.subtitle
            : `Borjie — Generated ${doc.generated_at}`,
      },
    ],
    citationIds: [],
  };

  const slidesData = [titleSection, ...doc.sections];
  const slideCount = slidesData.length;

  const entries: { readonly name: string; readonly data: Buffer }[] = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml(slideCount), 'utf-8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf-8') },
    { name: 'ppt/presentation.xml', data: Buffer.from(presentationXml(slideCount), 'utf-8') },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: Buffer.from(presentationRels(slideCount), 'utf-8'),
    },
  ];

  slidesData.forEach((section, idx) => {
    const i = idx + 1;
    entries.push({
      name: `ppt/slides/slide${i}.xml`,
      data: Buffer.from(slideXml(section.title, bodyTextFromSection(section)), 'utf-8'),
    });
    entries.push({
      name: `ppt/slides/_rels/slide${i}.xml.rels`,
      data: Buffer.from(slideRels(i), 'utf-8'),
    });
    entries.push({
      name: `ppt/notesSlides/notesSlide${i}.xml`,
      data: Buffer.from(speakerNotesXmlForSlide(section, doc), 'utf-8'),
    });
    entries.push({
      name: `ppt/notesSlides/_rels/notesSlide${i}.xml.rels`,
      data: Buffer.from(notesSlideRels(i), 'utf-8'),
    });
  });

  const bytes = writeZip(entries);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  return { bytes, checksum };
}

function speakerNotesXmlForSlide(section: IRSection, doc: IRDoc): string {
  return notesSlideXml(speakerNotesFromSection(section, doc));
}
