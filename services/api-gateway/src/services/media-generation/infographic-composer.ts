/**
 * Single-page infographic composer.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Composes a 1-page infographic from
 * "slots": a hero strip, KPI tiles, a stat band and a closing strip.
 * Pure-SVG output for predictable rendering in PDFs / PPTX slides /
 * social shares.
 */

export interface InfographicSlot {
  readonly kind: 'hero' | 'kpi' | 'stat' | 'callout';
  readonly title: string;
  readonly subtitle?: string;
  readonly value?: string;
  readonly delta?: string;
}

export interface GenerateInfographicInput {
  readonly title: string;
  readonly slots: ReadonlyArray<InfographicSlot>;
  readonly footer?: string;
}

export interface GenerateInfographicOutput {
  readonly svg: Buffer;
  readonly contentType: string;
  readonly durationMs: number;
}

const WIDTH = 1080;
const HERO_HEIGHT = 220;
const KPI_HEIGHT = 200;
const STAT_HEIGHT = 160;
const CALLOUT_HEIGHT = 140;
const PADDING = 32;

export function composeInfographic(
  input: GenerateInfographicInput,
): GenerateInfographicOutput {
  const start = Date.now();
  if (input.slots.length === 0) {
    throw new Error('infographic-composer: at least one slot required');
  }
  let y = PADDING;
  const blocks: string[] = [];
  for (const slot of input.slots) {
    if (slot.kind === 'hero') {
      blocks.push(heroBlock(slot, y));
      y += HERO_HEIGHT + PADDING;
    } else if (slot.kind === 'kpi') {
      blocks.push(kpiBlock(slot, y));
      y += KPI_HEIGHT + PADDING;
    } else if (slot.kind === 'stat') {
      blocks.push(statBlock(slot, y));
      y += STAT_HEIGHT + PADDING;
    } else {
      blocks.push(calloutBlock(slot, y));
      y += CALLOUT_HEIGHT + PADDING;
    }
  }
  const footer = input.footer ?? '';
  const height = y + (footer ? 56 : 0);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="Inter,Helvetica,Arial,sans-serif">
  <rect width="${WIDTH}" height="${height}" fill="#F7F5EE"/>
  <text x="${PADDING}" y="36" font-size="22" font-weight="700" fill="#0B0D12" font-family="Syne,Inter,sans-serif">${escape(input.title)}</text>
  <text x="${WIDTH - PADDING}" y="36" font-size="14" font-weight="700" fill="#C8A24B" text-anchor="end" font-family="Syne,Inter,sans-serif">Borjie</text>
  ${blocks.join('\n')}
  ${footer ? `<text x="${WIDTH / 2}" y="${height - 24}" font-size="11" fill="#5C5F66" text-anchor="middle">${escape(footer)}</text>` : ''}
</svg>`;
  return {
    svg: Buffer.from(svg, 'utf8'),
    contentType: 'image/svg+xml',
    durationMs: Date.now() - start,
  };
}

function heroBlock(slot: InfographicSlot, y: number): string {
  return `<rect x="${PADDING}" y="${y + 40}" width="${WIDTH - PADDING * 2}" height="${HERO_HEIGHT - 40}" rx="12" ry="12" fill="#0B0D12"/>
    <text x="${WIDTH / 2}" y="${y + 130}" font-size="40" font-weight="700" fill="#C8A24B" text-anchor="middle" font-family="Syne,Inter,sans-serif">${escape(slot.title)}</text>
    ${slot.subtitle ? `<text x="${WIDTH / 2}" y="${y + 170}" font-size="16" fill="#FFFFFF" text-anchor="middle">${escape(slot.subtitle)}</text>` : ''}`;
}

function kpiBlock(slot: InfographicSlot, y: number): string {
  return `<rect x="${PADDING}" y="${y + 40}" width="${WIDTH - PADDING * 2}" height="${KPI_HEIGHT - 40}" rx="12" ry="12" fill="#FFFFFF" stroke="#C8A24B" stroke-width="2"/>
    <text x="${PADDING + 32}" y="${y + 90}" font-size="14" font-weight="600" fill="#5C5F66">${escape(slot.title)}</text>
    <text x="${PADDING + 32}" y="${y + 156}" font-size="48" font-weight="700" fill="#0B0D12">${escape(slot.value ?? '--')}</text>
    ${slot.delta ? `<text x="${WIDTH - PADDING - 32}" y="${y + 156}" font-size="20" fill="#C8A24B" text-anchor="end">${escape(slot.delta)}</text>` : ''}`;
}

function statBlock(slot: InfographicSlot, y: number): string {
  return `<rect x="${PADDING}" y="${y + 32}" width="${WIDTH - PADDING * 2}" height="${STAT_HEIGHT - 32}" rx="8" ry="8" fill="#FFFFFF"/>
    <text x="${WIDTH / 2}" y="${y + 90}" font-size="32" font-weight="700" fill="#0B0D12" text-anchor="middle">${escape(slot.value ?? '--')}</text>
    <text x="${WIDTH / 2}" y="${y + 124}" font-size="14" fill="#5C5F66" text-anchor="middle">${escape(slot.title)}</text>`;
}

function calloutBlock(slot: InfographicSlot, y: number): string {
  return `<rect x="${PADDING}" y="${y + 28}" width="${WIDTH - PADDING * 2}" height="${CALLOUT_HEIGHT - 28}" rx="8" ry="8" fill="#C8A24B"/>
    <text x="${PADDING + 24}" y="${y + 78}" font-size="20" font-weight="700" fill="#0B0D12">${escape(slot.title)}</text>
    ${slot.subtitle ? `<text x="${PADDING + 24}" y="${y + 108}" font-size="14" fill="#0B0D12">${escape(slot.subtitle)}</text>` : ''}`;
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
