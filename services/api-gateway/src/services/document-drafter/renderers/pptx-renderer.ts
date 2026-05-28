/**
 * PPTX renderer — emits a minimal valid Office Open XML presentation
 * (`.pptx`) with one cover slide and a body slide per top-level
 * markdown section. Borjie brand on every slide.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. No external deps (no `pptxgenjs`); writes
 * the OOXML parts directly through the in-tree ZIP writer.
 *
 * Subset:
 *   - Cover slide: Borjie wordmark + draft title + author + date +
 *     classification.
 *   - Body slides: title from `## heading`, body bullets from the
 *     following paragraph until the next `##` or `---`.
 */

import type { BrandContext } from '../brand.js';
import { brandFooterText } from '../brand.js';
import { createZip } from './zip-writer.js';

export const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

interface Slide {
  readonly title: string;
  readonly bullets: ReadonlyArray<string>;
  readonly isCover?: boolean;
}

export function renderPptx(body: string, ctx: BrandContext): Buffer {
  const slides = buildSlidesFromMarkdown(body, ctx);
  const slideXmls = slides.map((s, i) => ({
    name: `ppt/slides/slide${i + 1}.xml`,
    xml: buildSlideXml(s, ctx, i + 1),
  }));
  const slideRels = slides.map((_, i) => ({
    name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
    xml: buildSlideRelsXml(),
  }));

  return createZip([
    { name: '[Content_Types].xml', data: buildContentTypesXml(slides.length), store: true },
    { name: '_rels/.rels', data: buildRootRelsXml() },
    { name: 'docProps/app.xml', data: buildAppXml(ctx, slides.length) },
    { name: 'docProps/core.xml', data: buildCoreXml(ctx) },
    { name: 'ppt/presentation.xml', data: buildPresentationXml(slides.length) },
    { name: 'ppt/_rels/presentation.xml.rels', data: buildPresentationRelsXml(slides.length) },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: buildSlideLayoutXml() },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: buildSlideLayoutRelsXml() },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: buildSlideMasterXml() },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: buildSlideMasterRelsXml() },
    { name: 'ppt/theme/theme1.xml', data: buildThemeXml() },
    ...slideXmls.map((s) => ({ name: s.name, data: s.xml })),
    ...slideRels.map((s) => ({ name: s.name, data: s.xml })),
  ]);
}

function buildSlidesFromMarkdown(body: string, ctx: BrandContext): Slide[] {
  const lines = body.split(/\r?\n/);
  const slides: Slide[] = [
    {
      title: ctx.title,
      bullets: [
        `${ctx.tenantName}`,
        `${capitalize(ctx.classification)}`,
        `${ctx.author}`,
        `${ctx.renderedAtUtc}`,
      ],
      isCover: true,
    },
  ];
  let currentTitle: string | null = null;
  let currentBullets: string[] = [];
  function flush() {
    if (currentTitle !== null) {
      slides.push({ title: currentTitle, bullets: currentBullets });
    }
  }
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || /^---+$/.test(line)) continue;
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      flush();
      currentTitle = h2[1] ?? '';
      currentBullets = [];
      continue;
    }
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) continue; // already on cover
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) {
      if (currentTitle !== null) currentBullets.push(h3[1] ?? '');
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (currentTitle !== null) currentBullets.push(line.replace(/^[-*]\s+/, ''));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (currentTitle !== null) currentBullets.push(line.replace(/^\d+\.\s+/, ''));
      continue;
    }
    if (currentTitle !== null) {
      currentBullets.push(line.length > 200 ? `${line.slice(0, 197)}...` : line);
    }
  }
  flush();
  // Keep at least the cover.
  return slides.length > 0 ? slides : [{ title: ctx.title, bullets: [], isCover: true }];
}

function buildContentTypesXml(slideCount: number): string {
  const slideOverrides = Array.from({ length: slideCount })
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  ${slideOverrides}
</Types>`;
}

function buildRootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function buildAppXml(ctx: BrandContext, slides: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Borjie Drafter</Application>
  <Slides>${slides}</Slides>
  <Company>${xmlEscape(ctx.tenantName)}</Company>
</Properties>`;
}

function buildCoreXml(ctx: BrandContext): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(ctx.title)}</dc:title>
  <dc:creator>${xmlEscape(ctx.author)}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${ctx.renderedAtUtc}</dcterms:created>
</cp:coreProperties>`;
}

function buildPresentationXml(slideCount: number): string {
  const sldIds = Array.from({ length: slideCount })
    .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${sldIds}</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function buildPresentationRelsXml(slideCount: number): string {
  const slideRels = Array.from({ length: slideCount })
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
    )
    .join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideRels}
  <Relationship Id="rId${slideCount + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;
}

function buildSlideLayoutXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sldLayout>`;
}

function buildSlideLayoutRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
}

function buildSlideMasterXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`;
}

function buildSlideMasterRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

function buildThemeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Borjie">
  <a:themeElements>
    <a:clrScheme name="Borjie"><a:dk1><a:srgbClr val="0B0D12"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="5C5F66"/></a:dk2><a:lt2><a:srgbClr val="F7F5EE"/></a:lt2><a:accent1><a:srgbClr val="C8A24B"/></a:accent1><a:accent2><a:srgbClr val="0B0D12"/></a:accent2><a:accent3><a:srgbClr val="5C5F66"/></a:accent3><a:accent4><a:srgbClr val="C8A24B"/></a:accent4><a:accent5><a:srgbClr val="0B0D12"/></a:accent5><a:accent6><a:srgbClr val="5C5F66"/></a:accent6><a:hlink><a:srgbClr val="C8A24B"/></a:hlink><a:folHlink><a:srgbClr val="5C5F66"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="Borjie"><a:majorFont><a:latin typeface="Syne"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Borjie"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln/><a:ln/><a:ln/></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`;
}

function buildSlideRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;
}

function buildSlideXml(slide: Slide, ctx: BrandContext, idx: number): string {
  const titleColor = slide.isCover ? 'C8A24B' : '0B0D12';
  const wmText = `Borjie`;
  const titleRuns = `<a:r><a:rPr lang="en-US" sz="4000" b="1"><a:solidFill><a:srgbClr val="${titleColor}"/></a:solidFill><a:latin typeface="Syne"/></a:rPr><a:t>${xmlEscape(slide.title)}</a:t></a:r>`;
  const bulletParas = slide.bullets
    .map(
      (b) =>
        `<a:p><a:pPr><a:buChar char="-"/></a:pPr><a:r><a:rPr lang="en-US" sz="2000"><a:latin typeface="Inter"/></a:rPr><a:t>${xmlEscape(b)}</a:t></a:r></a:p>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name="Slide ${idx}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9144000" cy="6858000"/><a:chOff x="0" y="0"/><a:chExt cx="9144000" cy="6858000"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="WordmarkTop"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2000" b="1"><a:solidFill><a:srgbClr val="C8A24B"/></a:solidFill><a:latin typeface="Syne"/></a:rPr><a:t>${xmlEscape(wmText)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="${slide.isCover ? '2400000' : '914400'}"/><a:ext cx="8229600" cy="1200000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr wrap="square" rtlCol="0" anchor="t"/><a:lstStyle/><a:p>${titleRuns}</a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="4" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="${slide.isCover ? '4200000' : '2300000'}"/><a:ext cx="8229600" cy="3200000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/>${bulletParas || '<a:p/>'}</p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="5" name="Footer"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="457200" y="6400000"/><a:ext cx="8229600" cy="350000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="900"><a:solidFill><a:srgbClr val="5C5F66"/></a:solidFill><a:latin typeface="Inter"/></a:rPr><a:t>${xmlEscape(brandFooterText(ctx))}</a:t></a:r></a:p></p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
