/**
 * Branded layout factory — wave ARTIFACT-RICHNESS.
 *
 * Single source of truth for the chrome (header band, classification
 * badge, footer with audit-hash + ISO timestamp + bilingual
 * disclaimer) that every Borjie artifact must carry. The chrome is
 * format-agnostic — the renderer adapter (HTML / PDF / DOCX / PPTX)
 * consumes the structured object and stitches it into the format-
 * specific scaffolding.
 *
 * This module is intentionally pure (no `process.env`, no I/O); the
 * caller supplies every input. It mirrors the contract already in
 * `document-drafter/brand.ts` but extends it with tenant logo + a
 * canonical citation chip style so every artifact looks alike.
 */

import type { ArtifactClassification, ArtifactLanguage } from './types.js';

const DISCLAIMER_EN = 'AI-generated. Decisions are yours.';
const DISCLAIMER_SW = 'Imeundwa na akili-bandia. Maamuzi ni yako.';

const CLASSIFICATION_LABEL_EN: Record<ArtifactClassification, string> = {
  public: 'Public',
  internal: 'Internal',
  confidential: 'Confidential',
};

const CLASSIFICATION_LABEL_SW: Record<ArtifactClassification, string> = {
  public: 'Hadharani',
  internal: 'Ndani ya Kampuni',
  confidential: 'Siri',
};

export interface BrandedLayoutInput {
  readonly tenantTradingName: string;
  readonly tenantLogoUrl?: string;
  readonly artifactTitle: string;
  readonly artifactKind: string;
  readonly classification: ArtifactClassification;
  readonly auditHashTail: string;
  readonly renderedAtUtc: string;
  readonly authorDisplayName: string;
  readonly language: ArtifactLanguage;
}

export interface BrandedLayout {
  readonly headerLine: string;
  readonly classificationBadge: string;
  readonly footerLine: string;
  readonly disclaimer: string;
  readonly classificationLabel: string;
}

export function buildBrandedLayout(input: BrandedLayoutInput): BrandedLayout {
  const classificationLabel =
    input.language === 'sw'
      ? CLASSIFICATION_LABEL_SW[input.classification]
      : CLASSIFICATION_LABEL_EN[input.classification];
  const disclaimer = input.language === 'sw' ? DISCLAIMER_SW : DISCLAIMER_EN;
  const headerLine = `Borjie | ${input.tenantTradingName} | ${input.artifactTitle}`;
  const classificationBadge = `[${classificationLabel}]`;
  const footerLine = `${input.tenantTradingName} | ${classificationLabel} | ${input.renderedAtUtc} | audit:${input.auditHashTail} | ${disclaimer}`;
  return Object.freeze({
    headerLine,
    classificationBadge,
    footerLine,
    disclaimer,
    classificationLabel,
  });
}

/**
 * Inline CSS rule fragment for the citation chip + footnotes section.
 * The renderer concatenates this into the existing `<style>` tag of
 * the HTML renderer so every artifact uses the same visual language.
 */
export const ARTIFACT_RICHNESS_CSS = `
  .borjie-citation-chip { font-size: 11px; line-height: 1; margin-left: 1px; color: #C8A24B; }
  .borjie-citation-chip a { color: inherit; text-decoration: none; }
  .borjie-citation-chip a:hover { text-decoration: underline; }
  .borjie-toc { background: #FBF9F0; border-left: 3px solid #C8A24B; padding: 12px 16px; margin: 0 0 24px; border-radius: 4px; }
  .borjie-toc h2 { font-size: 14px; margin: 0 0 8px; color: #0B0D12; }
  .borjie-toc ol { margin: 0; padding-left: 18px; font-size: 13px; }
  .borjie-toc a { color: #0B0D12; text-decoration: none; }
  .borjie-toc a:hover { text-decoration: underline; }
  .borjie-footnotes { margin: 32px 0 0; padding: 16px 0 0; border-top: 1px solid #ECE7D6; font-size: 13px; color: #5C5F66; }
  .borjie-footnotes h2 { font-size: 14px; margin: 0 0 8px; color: #0B0D12; }
  .borjie-footnotes ol { margin: 0; padding-left: 20px; }
  .borjie-footnotes li { margin: 4px 0; }
  .borjie-mermaid-fallback { background: #F7F5EE; border: 1px dashed #C8A24B; padding: 12px 16px; margin: 14px 0; border-radius: 4px; }
  .borjie-mermaid-fallback figcaption { font-size: 12px; color: #5C5F66; margin-bottom: 6px; }
  .borjie-mermaid-fallback pre { margin: 0; font-size: 12px; line-height: 1.4; }
  .borjie-math-fallback { font-family: 'Courier New', monospace; background: #F7F5EE; padding: 1px 6px; border-radius: 3px; }
  .borjie-math-display { display: block; padding: 12px 16px; margin: 14px 0; text-align: center; }
  .borjie-empty-state { background: #FBF9F0; padding: 12px 16px; border-radius: 4px; color: #5C5F66; font-style: italic; margin: 14px 0; }
  .katex-display { margin: 14px 0; overflow-x: auto; }
  @media print {
    .borjie-toc { background: none; border: 1px solid #ECE7D6; }
    .borjie-mermaid-fallback { border: 1px solid #5C5F66; }
  }
`;
