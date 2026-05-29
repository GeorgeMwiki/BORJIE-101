/**
 * Bilingual empty-state copy for artifact renderers.
 *
 * Wave ARTIFACT-RICHNESS. When a producer hands the renderer a body
 * that is empty (or whose data dependencies are not yet resolved),
 * the renderer should never crash — it should print a meaningful
 * empty-state. This module is the single source of truth for those
 * strings so every artifact family uses the same wording.
 *
 * Pure module, zero deps.
 */

import type { ArtifactLanguage } from './types.js';

export type EmptyStateKind =
  | 'no_data'
  | 'still_loading'
  | 'no_evidence'
  | 'partial_render'
  | 'unsupported_format'
  | 'awaiting_owner_action';

const COPY: Record<EmptyStateKind, Record<ArtifactLanguage, string>> = {
  no_data: {
    sw: 'Hakuna data bado kwenye sehemu hii. Itajaa kiotomatiki mara tu kitendo cha kwanza kitakapotokea.',
    en: 'No data yet in this section. It will populate automatically once the first event lands.',
  },
  still_loading: {
    sw: 'Inapakia… Subiri kidogo.',
    en: 'Loading… one moment.',
  },
  no_evidence: {
    sw: 'Hakuna ushahidi uliotajwa kwa kipande hiki.',
    en: 'No evidence has been cited for this segment.',
  },
  partial_render: {
    sw: 'Sehemu fulani hazikuweza kufunguliwa. Kilichoonyeshwa ndicho kilichofanikiwa.',
    en: 'Some sections could not render. What is shown is what succeeded.',
  },
  unsupported_format: {
    sw: 'Muundo huu wa faili haukufanikiwa. Tafadhali jaribu PDF au DOCX.',
    en: 'This file format failed. Please try PDF or DOCX instead.',
  },
  awaiting_owner_action: {
    sw: 'Inasubiri uamuzi wako kabla ya kuendelea.',
    en: 'Waiting on your decision before continuing.',
  },
};

export function emptyState(kind: EmptyStateKind, language: ArtifactLanguage = 'en'): string {
  return COPY[kind][language];
}

export function emptyStateHtml(
  kind: EmptyStateKind,
  language: ArtifactLanguage = 'en',
): string {
  const msg = emptyState(kind, language);
  return `<p class="borjie-empty-state" role="status">${escape(msg)}</p>`;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
