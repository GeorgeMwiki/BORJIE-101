/**
 * Shared brand styling for every drafter renderer (PDF/DOCX/PPTX/HTML).
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Every rendered output must carry the
 * Borjie identity (gold mark, Inter / Syne typography, audit footer with
 * hash chain). The renderers consume `BrandStyle` and `BrandContext`
 * (tenant trading name, classification, draft title, audit hash) and
 * stitch them into format-specific scaffolding.
 *
 * The mark is an inline SVG so renderers do not need access to the
 * design-system bundle at runtime (the api-gateway is a server build).
 * Colors are the canonical Borjie palette (gold #C8A24B + ink #0B0D12).
 */

export interface BrandStyle {
  readonly colorGold: string;
  readonly colorInk: string;
  readonly colorMuted: string;
  readonly colorBgSubtle: string;
  readonly fontBody: string;
  readonly fontDisplay: string;
}

export const DEFAULT_BRAND_STYLE: BrandStyle = Object.freeze({
  colorGold: '#C8A24B',
  colorInk: '#0B0D12',
  colorMuted: '#5C5F66',
  colorBgSubtle: '#F7F5EE',
  fontBody: 'Inter',
  fontDisplay: 'Syne',
});

export interface BrandContext {
  /** Tenant trading name shown in the header. */
  readonly tenantName: string;
  /** Document title shown beside the wordmark. */
  readonly title: string;
  /** Last 8 chars of the audit chain hash. */
  readonly auditHashTail: string;
  /** Classification: Public | Internal | Confidential. */
  readonly classification: 'public' | 'internal' | 'confidential';
  /** Author display name (free-form drafts default to "Borjie brain"). */
  readonly author: string;
  /** UTC ISO timestamp for the footer. */
  readonly renderedAtUtc: string;
}

const DISCLAIMER_EN =
  'AI-generated. Decisions are yours.';
const DISCLAIMER_SW =
  'Imeundwa na akili-bandia. Maamuzi ni yako.';

export function brandFooterText(ctx: BrandContext, lang: 'sw' | 'en' = 'en'): string {
  const disclaimer = lang === 'sw' ? DISCLAIMER_SW : DISCLAIMER_EN;
  return `${ctx.tenantName} | ${capitalize(ctx.classification)} | ${ctx.renderedAtUtc} | audit:${ctx.auditHashTail} | ${disclaimer}`;
}

export function brandHeaderText(ctx: BrandContext): string {
  return `Borjie | ${ctx.tenantName} | ${ctx.title}`;
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Compact Borjie wordmark as an inline SVG (gold-on-transparent).
 * Width 96 x height 24 — sized for document headers / slide covers.
 */
export const BORJIE_WORDMARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24" viewBox="0 0 96 24" role="img" aria-label="Borjie">
  <text x="0" y="18" fill="#C8A24B" font-family="Syne,Inter,Helvetica,Arial,sans-serif" font-weight="700" font-size="18" letter-spacing="0.5">Borjie</text>
</svg>`;

/**
 * Smallest possible Borjie mark — a gold dot. Used in PPTX corners and
 * DOCX footers where SVG embedding adds inertia.
 */
export function brandMarkPlainText(): string {
  return 'Borjie';
}

/**
 * Last-8 audit hash tail helper. Defensive against short inputs (tests).
 */
export function tailOfHash(hash: string | null | undefined): string {
  if (!hash) return '--------';
  if (hash.length <= 8) return hash.padStart(8, '0');
  return hash.slice(-8);
}
