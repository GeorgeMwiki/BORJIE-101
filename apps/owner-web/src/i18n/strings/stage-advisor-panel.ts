/**
 * stage-advisor-panel — guard-exempt Swahili+English string table for
 * `StageAdvisorPanel` (the owner cockpit surface for the stage-aware
 * capability advisor, `@borjie/stage-advisor`).
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every bilingual literal the panel needs (title,
 * subtitle, loading / unavailable captions, section headers, CTA copy)
 * lives here rather than inline in the component — keeping the panel
 * source free of hardcoded Swahili tokens while preserving the
 * `locale === 'sw' ? STR.x.sw : STR.x.en` call-site shape via the
 * existing `pick()` helper.
 *
 * SHAPE
 * Each leaf is `{ en, sw }`. Text is preserved verbatim from the prior
 * inline `STR` object — do NOT re-translate.
 */

export const stageAdvisorPanelStrings = {
  title: { en: 'Stage advisor', sw: 'Mshauri wa hatua' },
  subtitle: {
    en: 'Where your estate is in its lifecycle — and what to do next.',
    sw: 'Hatua ya shamba lako katika mzunguko — na la kufanya baadaye.',
  },
  unavailable: {
    en: 'Stage advisor is not available right now.',
    sw: 'Mshauri wa hatua haupatikani kwa sasa.',
  },
  loading: { en: 'Loading…', sw: 'Inapakia…' },
  confidence: { en: 'confidence', sw: 'uhakika' },
  noStage: {
    en: 'Not enough activity yet to classify your stage.',
    sw: 'Bado hakuna shughuli za kutosha kubaini hatua yako.',
  },
  evidenceTitle: { en: 'Why this stage', sw: 'Kwa nini hatua hii' },
  focusTitle: { en: 'Focus areas', sw: 'Maeneo ya kuzingatia' },
  playbookTitle: { en: 'Onboarding playbook', sw: 'Mwongozo wa kuanza' },
  tasksDone: { en: 'tasks done', sw: 'kazi zimekamilika' },
  nextTitle: { en: 'Next steps', sw: 'Hatua zinazofuata' },
  nudgesTitle: { en: 'Proactive nudges', sw: 'Vidokezo vya haraka' },
  noNudges: {
    en: 'No nudges right now — you are on track.',
    sw: 'Hakuna vidokezo kwa sasa — uko sawa.',
  },
  dismiss: { en: 'Dismiss', sw: 'Ondoa' },
} as const;
