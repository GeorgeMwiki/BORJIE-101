/**
 * recommendations-panel — guard-exempt bilingual (sw / en) copy for the
 * Smart Matches panel (components/recommendations/RecommendationsPanel.tsx).
 *
 * Lives under `i18n/` so the locale-purity scanner exempts the Swahili.
 * Every key carries a REAL Swahili translation; no machine-translation
 * stubs. The match-target labels are a closed UI vocabulary
 * (RECOMMENDATION_TARGETS) localized through the table below — never the
 * raw token. The `algorithm`, `runId`, per-item `reason` and `evidenceIds`
 * are stable engine/data values rendered verbatim (locale-neutral wire).
 */

import type { RecommendationTarget } from '@/lib/queries/recommendations';

export const recommendationsPanelStrings = {
  title: { en: 'Smart Matches', sw: 'Mechi Mahiri' },
  subtitle: {
    en: 'Ranked matches from your live marketplace + reputation signal',
    sw: 'Mechi zilizopangwa kutoka soko lako hai + ishara ya sifa',
  },
  selectTarget: { en: 'Select match target', sw: 'Chagua lengo la mechi' },

  loadingSession: { en: 'Loading session…', sw: 'Inapakia kipindi…' },
  signInPrompt: {
    en: 'Sign in to compute personalised matches.',
    sw: 'Ingia ili kukokotoa mechi zilizobinafsishwa.',
  },
  computing: { en: 'Computing matches…', sw: 'Inakokotoa mechi…' },
  matcherUnavailable: {
    en: 'Matcher unavailable. Try again shortly.',
    sw: 'Kilinganishi hakipatikani. Jaribu tena hivi karibuni.',
  },
  noCandidates: {
    en: 'No active marketplace candidates to match yet.',
    sw: 'Hakuna wagombea hai wa soko wa kulinganisha bado.',
  },

  algorithm: { en: 'Algorithm', sw: 'Algoridhimu' },
  run: { en: 'Run', sw: 'Mzunguko' },
  evidence: { en: 'Evidence', sw: 'Ushahidi' },
  moreSuffix: (count: number) => ({
    en: ` +${count} more`,
    sw: ` +${count} zaidi`,
  }),
} as const;

/**
 * Match-target labels — the closed `RECOMMENDATION_TARGETS` vocabulary
 * (buyer_mine | worker_site | supplier_mine). Rendered in the active
 * locale, never the raw token.
 */
export const recommendationTargetLabels: Record<
  RecommendationTarget,
  { readonly en: string; readonly sw: string }
> = {
  buyer_mine: { en: 'Buyers → Mines', sw: 'Wanunuzi → Migodi' },
  worker_site: { en: 'Workers → Sites', sw: 'Wafanyakazi → Tovuti' },
  supplier_mine: { en: 'Suppliers → Mines', sw: 'Wasambazaji → Migodi' },
};
