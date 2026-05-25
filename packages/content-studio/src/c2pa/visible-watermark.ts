/**
 * Visible "AI Generated" watermark — Adobe Content Credentials-style.
 *
 * Adobe's CR badge (https://contentcredentials.org/) is the convention
 * that survived the 2024-2026 industry consolidation: a small
 * bottom-right corner mark that tags AI-origin without obscuring the
 * image. This module produces an SVG overlay descriptor that a host
 * applies via `sharp.composite([...])`, `<canvas>`, or `ffmpeg drawimage`.
 *
 * Pure function: no image processing happens here. The caller
 * receives a portable `{ svg, x, y, width, height }` blueprint plus
 * defensible defaults from the CA-SB-942 (Aug 2026) + EU AI Act Art.50
 * disclosure requirements.
 */

export interface WatermarkOptions {
  /** Bounding-box size of the underlying asset (px). */
  readonly assetWidth: number;
  readonly assetHeight: number;
  /** Where on the asset the watermark anchors. Default 'bottom-right'. */
  readonly position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Padding from the chosen corner (px). Default 16. */
  readonly padding?: number;
  /** Opacity in [0, 1]. Default 0.85 (visible but unobtrusive). */
  readonly opacity?: number;
  /** Label shown next to the badge. Default 'AI Generated'. */
  readonly label?: string;
  /** Compact mode — badge only, no label. Default false. */
  readonly compact?: boolean;
  /** Locale used for the label. Default 'en'. */
  readonly locale?: 'en' | 'sw' | 'sw-TZ' | 'lug';
}

export interface VisibleWatermark {
  /** SVG markup the host composites onto the asset. */
  readonly svg: string;
  /** x/y of the SVG's top-left corner in the asset's pixel space. */
  readonly x: number;
  readonly y: number;
  /** Box dimensions. */
  readonly width: number;
  readonly height: number;
}

const LABEL_BY_LOCALE: Record<Required<WatermarkOptions>['locale'], string> = {
  en: 'AI Generated',
  sw: 'Imetengenezwa na AI',
  'sw-TZ': 'Imetengenezwa na AI',
  lug: 'Eyakolebwawo AI',
};

export function buildVisibleWatermark(options: WatermarkOptions): VisibleWatermark {
  const padding = options.padding ?? 16;
  const opacity = clamp01(options.opacity ?? 0.85);
  const locale = options.locale ?? 'en';
  const label = options.label ?? LABEL_BY_LOCALE[locale];
  const compact = options.compact ?? false;

  // The CR mark is a 24x24 px badge; with label we add ~110px of text.
  const badgeSize = 24;
  const textWidth = compact ? 0 : estimateTextWidth(label, 12);
  const gap = compact ? 0 : 6;
  const width = badgeSize + gap + textWidth + 12; // 12 padding inside box
  const height = badgeSize + 8;

  const { x, y } = anchor(options.assetWidth, options.assetHeight, width, height, padding, options.position ?? 'bottom-right');

  const svg = compact ? badgeSvgCompact(width, height, opacity) : badgeSvgWithLabel(width, height, opacity, label);

  return { svg, x, y, width, height };
}

// ─────────────────────────────────────────────────────────────────────
// SVG factories
// ─────────────────────────────────────────────────────────────────────

function badgeSvgCompact(width: number, height: number, opacity: number): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<g opacity="${opacity}">`,
    `<rect x="0" y="0" rx="6" ry="6" width="${width}" height="${height}" fill="rgba(0,0,0,0.72)"/>`,
    badgeIconPath(8, 4, 24),
    `</g>`,
    `</svg>`,
  ].join('');
}

function badgeSvgWithLabel(width: number, height: number, opacity: number, label: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<g opacity="${opacity}">`,
    `<rect x="0" y="0" rx="6" ry="6" width="${width}" height="${height}" fill="rgba(0,0,0,0.72)"/>`,
    badgeIconPath(8, 4, 24),
    `<text x="${8 + 24 + 6}" y="${height / 2 + 4}" fill="#ffffff" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="500">${escapeXml(label)}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}

function badgeIconPath(x: number, y: number, size: number): string {
  // Adobe CR mark — simplified SVG path. Two interlocking C-arcs.
  const cx = x + size / 2;
  const cy = y + size / 2;
  const r = (size / 2) - 2;
  return [
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffffff" stroke-width="2"/>`,
    `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#ffffff" font-family="system-ui, sans-serif" font-size="10" font-weight="700">CR</text>`,
  ].join('');
}

// ─────────────────────────────────────────────────────────────────────
// Anchor math
// ─────────────────────────────────────────────────────────────────────

function anchor(
  assetW: number,
  assetH: number,
  boxW: number,
  boxH: number,
  pad: number,
  pos: Required<WatermarkOptions>['position'],
): { x: number; y: number } {
  switch (pos) {
    case 'bottom-right':
      return { x: assetW - boxW - pad, y: assetH - boxH - pad };
    case 'bottom-left':
      return { x: pad, y: assetH - boxH - pad };
    case 'top-right':
      return { x: assetW - boxW - pad, y: pad };
    case 'top-left':
      return { x: pad, y: pad };
  }
}

function estimateTextWidth(text: string, fontSize: number): number {
  // Rough heuristic — sans-serif at 12px averages ~7px per char.
  return Math.ceil(text.length * (fontSize * 0.58));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
