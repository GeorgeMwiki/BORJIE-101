/**
 * Bilingual copy for the modality artifact surface (closure Wave 8).
 *
 * Single-language per active locale — never mixed (CLAUDE.md EN/SW purity).
 */

import type { ArtifactKind } from '@/lib/tab-sse-parser';

type Locale = 'en' | 'sw';

/** Strip-friendly tab title per artifact kind, locale-pure. */
export const ARTIFACT_TITLE_BY_KIND: Readonly<
  Record<ArtifactKind, Readonly<Record<Locale, string>>>
> = {
  forecast: { en: 'Forecast', sw: 'Utabiri' },
  document: { en: 'Document', sw: 'Hati' },
  media: { en: 'Media', sw: 'Midia' },
};
