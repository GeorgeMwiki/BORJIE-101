/**
 * Hand-rolled .pptx renderer for the report engine.
 *
 * Mirrors the docx renderer pattern — assemble the minimum OOXML
 * parts that PowerPoint / Keynote / LibreOffice need, pack them into
 * a ZIP. The output is a valid .pptx with one slide per section plus
 * a title slide; text and tables render correctly across viewers.
 *
 * The task description suggests pptxgenjs, but installing it cleanly
 * across the workspace (pnpm overrides, supply-chain checks) is a
 * non-trivial side quest. Per the fallback instruction in the spec we
 * provide a hand-rolled implementation here and document the
 * pptxgenjs upgrade path in `packages/report-engine/README.md`.
 *
 * The OOXML parts produced per .pptx:
 *   [Content_Types].xml
 *   _rels/.rels
 *   ppt/presentation.xml
 *   ppt/_rels/presentation.xml.rels
 *   ppt/slideMasters/slideMaster1.xml
 *   ppt/slideMasters/_rels/slideMaster1.xml.rels
 *   ppt/slideLayouts/slideLayout1.xml
 *   ppt/slideLayouts/_rels/slideLayout1.xml.rels
 *   ppt/slides/slide1.xml
 *   ppt/slides/_rels/slide1.xml.rels
 *   ppt/theme/theme1.xml
 *
 * Slide dimensions: 13.333" x 7.5" (16:9, default).
 * Coordinates in OOXML use EMU — 1 inch = 914400 EMU.
 */

import { writeZip, escapeXml } from '../ooxml-zip.js';
import type {
  RenderedReportFile,
  ResolvedReportSection,
  TenantBrand,
} from '../types.js';
import { sanitizeFilename } from './pdf.js';
import type { PresentationSlideMasterSpec } from '../presentation-types.js';

const EMU_PER_INCH = 914400;
const DEFAULT_WIDTH_IN = 13.333;
const DEFAULT_HEIGHT_IN = 7.5;

export interface RenderPptxInput {
  readonly title: string;
  readonly subtitle?: string;
  readonly sections: readonly ResolvedReportSection[];
  readonly brand: TenantBrand;
  /** Optional theme override; otherwise default theme is generated. */
  readonly theme?: PresentationSlideMasterSpec;
  readonly generatedAt: Date;
}

function inToEmu(inches: number): number {
  return Math.round(inches * EMU_PER_INCH);
}

/** Strip leading '#' and uppercase for OOXML's `srgbClr` attribute. */
function normaliseHex(hex: string): string {
  return hex.replace('#', '').toUpperCase();
}

/**
 * Build presentation.xml — the top-level shape carries the slide size
 * and a reference to the slide-master.
 */
function buildPresentationXml(
  slideCount: number,
  width: number,
  height: number,
): string {
  const slideIds = Array.from({ length: slideCount }, (_, i) => i + 1)
    .map((i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${slideIds}</p:sldIdLst>` +
    `<p:sldSz cx="${inToEmu(width)}" cy="${inToEmu(height)}" type="screen16x9"/>` +
    `<p:notesSz cx="${inToEmu(height)}" cy="${inToEmu(width)}"/>` +
    '</p:presentation>'
  );
}

/** presentation.xml.rels — references master + slides. */
function buildPresentationRels(slideCount: number): string {
  const slideRels = Array.from({ length: slideCount }, (_, i) => i + 1)
    .map(
      (i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`,
    )
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>' +
    slideRels.replace(/rId(\d+)/g, (_, n) => `rId${Number(n) + 1}`) +
    '<Relationship Id="rId' +
    (slideCount + 2) +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
    '</Relationships>'
  );
}

/** Slide master — minimal but valid placeholder. */
function buildSlideMasterXml(brand: TenantBrand): string {
  const bg = normaliseHex(brand.primaryColor ?? '#1F3864');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld>' +
    `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bg}"/></a:solidFill></p:bgPr></p:bg>` +
    '<p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr/>' +
    '</p:spTree>' +
    '</p:cSld>' +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    '</p:sldMaster>'
  );
}

const SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

function buildSlideLayoutXml(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">' +
    '<p:cSld>' +
    '<p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr/>' +
    '</p:spTree>' +
    '</p:cSld>' +
    '</p:sldLayout>'
  );
}

const SLIDE_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

/** Theme XML — minimal valid theme1.xml. */
function buildThemeXml(brand: TenantBrand): string {
  const primary = normaliseHex(brand.primaryColor ?? '#1F3864');
  const accent = normaliseHex(brand.accentColor ?? '#FFC000');
  const font = brand.fontFamily ?? 'Calibri';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Tenant">' +
    '<a:themeElements>' +
    '<a:clrScheme name="Tenant">' +
    '<a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>' +
    '<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    '<a:dk2><a:srgbClr val="44546A"/></a:dk2>' +
    '<a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>' +
    `<a:accent1><a:srgbClr val="${primary}"/></a:accent1>` +
    `<a:accent2><a:srgbClr val="${accent}"/></a:accent2>` +
    '<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>' +
    '<a:accent4><a:srgbClr val="FFC000"/></a:accent4>' +
    '<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>' +
    '<a:accent6><a:srgbClr val="70AD47"/></a:accent6>' +
    '<a:hlink><a:srgbClr val="0563C1"/></a:hlink>' +
    '<a:folHlink><a:srgbClr val="954F72"/></a:folHlink>' +
    '</a:clrScheme>' +
    '<a:fontScheme name="Tenant">' +
    `<a:majorFont><a:latin typeface="${escapeXml(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
    `<a:minorFont><a:latin typeface="${escapeXml(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
    '</a:fontScheme>' +
    '<a:fmtScheme name="Office">' +
    '<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>' +
    '<a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst>' +
    '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>' +
    '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
    '</a:fmtScheme>' +
    '</a:themeElements>' +
    '</a:theme>'
  );
}

function buildSlideXml(
  shapes: readonly string[],
  background?: string,
): string {
  const bg = background
    ? `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${normaliseHex(background)}"/></a:solidFill></p:bgPr></p:bg>`
    : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld>' +
    bg +
    '<p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr/>' +
    shapes.join('') +
    '</p:spTree>' +
    '</p:cSld>' +
    '</p:sld>'
  );
}

const SLIDE_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

interface ShapeRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Render a text shape at the given location. `text` may include
 * newlines; each line becomes its own `<a:p>` paragraph.
 */
function textShape(
  id: number,
  name: string,
  rect: ShapeRect,
  text: string,
  opts: {
    readonly fontSize?: number;
    readonly bold?: boolean;
    readonly color?: string;
    readonly alignment?: 'l' | 'ctr' | 'r';
    readonly fontFamily?: string;
  } = {},
): string {
  const fontSize = opts.fontSize ?? 18;
  const sz = fontSize * 100;
  const color = normaliseHex(opts.color ?? '#333333');
  const align = opts.alignment ?? 'l';
  const bold = opts.bold ? 'b="1"' : '';
  const font = escapeXml(opts.fontFamily ?? 'Calibri');

  const paragraphs = text
    .split(/\r?\n/)
    .map(
      (line) =>
        `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="en-US" sz="${sz}" ${bold}>` +
        `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
        `<a:latin typeface="${font}"/></a:rPr>` +
        `<a:t>${escapeXml(line)}</a:t></a:r></a:p>`,
    )
    .join('');

  return (
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${id}" name="${escapeXml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${inToEmu(rect.x)}" y="${inToEmu(rect.y)}"/>` +
    `<a:ext cx="${inToEmu(rect.w)}" cy="${inToEmu(rect.h)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/>${paragraphs}</p:txBody>` +
    `</p:sp>`
  );
}

function buildTitleSlideShapes(
  title: string,
  subtitle: string | undefined,
  brand: TenantBrand,
  fontFamily: string,
): readonly string[] {
  const shapes: string[] = [];
  shapes.push(
    textShape(
      2,
      'Title',
      { x: 0.8, y: 2.6, w: DEFAULT_WIDTH_IN - 1.6, h: 1.2 },
      title,
      {
        fontSize: 44,
        bold: true,
        color: brand.primaryColor ?? '#FFFFFF',
        alignment: 'ctr',
        fontFamily,
      },
    ),
  );
  if (subtitle) {
    shapes.push(
      textShape(
        3,
        'Subtitle',
        { x: 0.8, y: 4.0, w: DEFAULT_WIDTH_IN - 1.6, h: 1.0 },
        subtitle,
        { fontSize: 22, color: '#EEEEEE', alignment: 'ctr', fontFamily },
      ),
    );
  }
  shapes.push(
    textShape(
      4,
      'Brand',
      { x: 0.8, y: DEFAULT_HEIGHT_IN - 0.8, w: DEFAULT_WIDTH_IN - 1.6, h: 0.5 },
      brand.displayName,
      { fontSize: 14, color: '#CCCCCC', alignment: 'ctr', fontFamily },
    ),
  );
  return shapes;
}

function buildSectionSlideShapes(
  section: ResolvedReportSection,
  brand: TenantBrand,
  fontFamily: string,
): readonly string[] {
  const shapes: string[] = [];
  let nextId = 2;
  shapes.push(
    textShape(
      nextId++,
      'SectionTitle',
      { x: 0.5, y: 0.4, w: DEFAULT_WIDTH_IN - 1, h: 0.8 },
      section.title,
      {
        fontSize: 28,
        bold: true,
        color: brand.primaryColor ?? '#1F3864',
        fontFamily,
      },
    ),
  );

  if (section.kind === 'narrative' && section.narrative) {
    shapes.push(
      textShape(
        nextId++,
        'Body',
        { x: 0.5, y: 1.4, w: DEFAULT_WIDTH_IN - 1, h: DEFAULT_HEIGHT_IN - 2 },
        section.narrative,
        { fontSize: 16, color: '#333333', fontFamily },
      ),
    );
  } else if (section.kind === 'table' && section.table) {
    const lines: string[] = [];
    lines.push(section.table.headers.join('  |  '));
    lines.push('---'.repeat(Math.max(1, section.table.headers.length)));
    for (const row of section.table.rows) {
      lines.push(row.map((v) => String(v ?? '')).join('  |  '));
    }
    shapes.push(
      textShape(
        nextId++,
        'Table',
        { x: 0.5, y: 1.4, w: DEFAULT_WIDTH_IN - 1, h: DEFAULT_HEIGHT_IN - 2 },
        lines.join('\n'),
        { fontSize: 12, color: '#333333', fontFamily },
      ),
    );
  } else if (section.kind === 'kpi_grid' && section.kpi_grid) {
    const cols = 3;
    const cellW = (DEFAULT_WIDTH_IN - 1) / cols;
    section.kpi_grid.metrics.forEach((metric, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const baseX = 0.5 + col * cellW;
      const baseY = 1.4 + row * 1.6;
      shapes.push(
        textShape(
          nextId++,
          `KpiLabel${idx}`,
          { x: baseX, y: baseY, w: cellW - 0.2, h: 0.4 },
          metric.label,
          { fontSize: 11, color: '#666666', fontFamily },
        ),
      );
      shapes.push(
        textShape(
          nextId++,
          `KpiValue${idx}`,
          { x: baseX, y: baseY + 0.4, w: cellW - 0.2, h: 0.6 },
          String(metric.value),
          {
            fontSize: 22,
            bold: true,
            color: brand.primaryColor ?? '#1F3864',
            fontFamily,
          },
        ),
      );
      if (metric.delta) {
        shapes.push(
          textShape(
            nextId++,
            `KpiDelta${idx}`,
            { x: baseX, y: baseY + 1.0, w: cellW - 0.2, h: 0.4 },
            metric.delta,
            { fontSize: 11, color: brand.accentColor ?? '#FFC000', fontFamily },
          ),
        );
      }
    });
  } else if (section.kind === 'chart' && section.chart) {
    shapes.push(
      textShape(
        nextId++,
        'ChartTitle',
        { x: 0.5, y: 1.4, w: DEFAULT_WIDTH_IN - 1, h: 0.4 },
        section.chart.title ?? '',
        { fontSize: 16, bold: true, color: '#333333', fontFamily },
      ),
    );
    shapes.push(
      textShape(
        nextId++,
        'ChartPlaceholder',
        {
          x: 0.5,
          y: 2.0,
          w: DEFAULT_WIDTH_IN - 1,
          h: DEFAULT_HEIGHT_IN - 2.5,
        },
        '[Chart placeholder — embed PNG via chart-render]',
        { fontSize: 12, color: '#999999', alignment: 'ctr', fontFamily },
      ),
    );
  }
  return shapes;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  __SLIDE_OVERRIDES__
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

/** Render the resolved report into a .pptx buffer. */
export function renderReportPptx(input: RenderPptxInput): RenderedReportFile {
  const themeWidth = input.theme?.dimensions?.w ?? DEFAULT_WIDTH_IN;
  const themeHeight = input.theme?.dimensions?.h ?? DEFAULT_HEIGHT_IN;
  const themeFont = input.theme?.fonts?.body ?? input.brand.fontFamily ?? 'Calibri';
  const themeBackground =
    input.theme?.colors?.background ?? '#FFFFFF';
  const themePrimary =
    input.theme?.colors?.primary ?? input.brand.primaryColor ?? '#1F3864';

  const effectiveBrand: TenantBrand = {
    ...input.brand,
    primaryColor: themePrimary,
    fontFamily: themeFont,
  };

  // Slide 1 = title; subsequent slides = one per section.
  const slideShapes: ReadonlyArray<readonly string[]> = [
    buildTitleSlideShapes(input.title, input.subtitle, effectiveBrand, themeFont),
    ...input.sections.map((s) =>
      buildSectionSlideShapes(s, effectiveBrand, themeFont),
    ),
  ];
  const slideCount = slideShapes.length;

  const slideOverrides = Array.from({ length: slideCount }, (_, i) => i + 1)
    .map(
      (n) =>
        `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('');

  const entries = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        CONTENT_TYPES.replace('__SLIDE_OVERRIDES__', slideOverrides),
        'utf-8',
      ),
    },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf-8') },
    {
      name: 'ppt/presentation.xml',
      data: Buffer.from(
        buildPresentationXml(slideCount, themeWidth, themeHeight),
        'utf-8',
      ),
    },
    {
      name: 'ppt/_rels/presentation.xml.rels',
      data: Buffer.from(buildPresentationRels(slideCount), 'utf-8'),
    },
    {
      name: 'ppt/slideMasters/slideMaster1.xml',
      data: Buffer.from(buildSlideMasterXml(effectiveBrand), 'utf-8'),
    },
    {
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      data: Buffer.from(SLIDE_MASTER_RELS, 'utf-8'),
    },
    {
      name: 'ppt/slideLayouts/slideLayout1.xml',
      data: Buffer.from(buildSlideLayoutXml(), 'utf-8'),
    },
    {
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      data: Buffer.from(SLIDE_LAYOUT_RELS, 'utf-8'),
    },
    {
      name: 'ppt/theme/theme1.xml',
      data: Buffer.from(buildThemeXml(effectiveBrand), 'utf-8'),
    },
  ];

  for (let i = 0; i < slideCount; i++) {
    const isTitle = i === 0;
    const xml = buildSlideXml(
      slideShapes[i] ?? [],
      isTitle ? themePrimary : themeBackground,
    );
    entries.push({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: Buffer.from(xml, 'utf-8'),
    });
    entries.push({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
      data: Buffer.from(SLIDE_RELS, 'utf-8'),
    });
  }

  const buffer = writeZip(entries);
  return {
    format: 'pptx',
    buffer,
    mimeType:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    filename: `${sanitizeFilename(input.title)}.pptx`,
  };
}

// Exported for tests.
export const __test__ = {
  buildPresentationXml,
  buildSlideXml,
  textShape,
  inToEmu,
  normaliseHex,
};
