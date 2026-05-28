/**
 * Single-file HTML renderer — body suitable for email embed or
 * stand-alone viewing in a browser. Uses inline styles only (no
 * external CSS) so the file ships as one .html with no dependencies.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Brand styling applied: Borjie wordmark in
 * the header band (gold on ink), Inter body font, Syne display, audit
 * tail and disclaimer in the footer.
 */

import type { BrandContext, BrandStyle } from '../brand.js';
import {
  DEFAULT_BRAND_STYLE,
  brandFooterText,
  brandHeaderText,
  BORJIE_WORDMARK_SVG,
} from '../brand.js';
import { markdownToHtml } from './markdown-to-html.js';

export interface HtmlRenderOptions {
  readonly style?: BrandStyle;
}

export function renderHtml(
  body: string,
  ctx: BrandContext,
  opts: HtmlRenderOptions = {},
): Buffer {
  const style = opts.style ?? DEFAULT_BRAND_STYLE;
  const bodyHtml = markdownToHtml(body);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(ctx.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; font-family:${style.fontBody},Inter,Helvetica,Arial,sans-serif; color:${style.colorInk}; background:#FAFAF7; font-size:15px; line-height:1.55; }
  .borjie-header { background:${style.colorInk}; color:${style.colorGold}; padding:16px 32px; display:flex; align-items:center; gap:16px; }
  .borjie-header .wm { display:inline-flex; }
  .borjie-header .meta { font-family:${style.fontDisplay},${style.fontBody},sans-serif; font-weight:600; font-size:14px; letter-spacing:0.4px; }
  .borjie-doc { max-width:760px; margin:24px auto 8px; padding:32px; background:#fff; border:1px solid #ECE7D6; border-radius:8px; }
  .borjie-doc h1 { font-family:${style.fontDisplay},${style.fontBody},sans-serif; font-weight:700; font-size:28px; margin:0 0 24px; color:${style.colorInk}; }
  .borjie-doc h2 { font-family:${style.fontDisplay},${style.fontBody},sans-serif; font-weight:700; font-size:20px; margin:28px 0 12px; color:${style.colorInk}; }
  .borjie-doc h3 { font-weight:600; font-size:16px; margin:20px 0 8px; }
  .borjie-doc p { margin:8px 0 14px; }
  .borjie-doc ol, .borjie-doc ul { padding-left:20px; margin:8px 0 14px; }
  .borjie-doc table { border-collapse:collapse; margin:14px 0; font-size:14px; }
  .borjie-doc th, .borjie-doc td { border:1px solid ${style.colorBgSubtle}; padding:6px 10px; text-align:left; }
  .borjie-doc th { background:${style.colorBgSubtle}; font-weight:600; }
  .borjie-doc hr { border:none; border-top:1px solid ${style.colorBgSubtle}; margin:18px 0; }
  .borjie-footer { max-width:760px; margin:0 auto 32px; padding:14px 32px; font-size:12px; color:${style.colorMuted}; text-align:center; }
</style>
</head>
<body>
<div class="borjie-header">
  <span class="wm">${BORJIE_WORDMARK_SVG}</span>
  <span class="meta">${escapeHtml(brandHeaderText(ctx))}</span>
</div>
<main class="borjie-doc">
  ${bodyHtml}
</main>
<footer class="borjie-footer">${escapeHtml(brandFooterText(ctx))}</footer>
</body>
</html>`;
  return Buffer.from(html, 'utf8');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
