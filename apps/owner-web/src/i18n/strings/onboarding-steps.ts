/**
 * onboarding-steps — guard-exempt Swahili+English string table for the
 * owner-onboarding wizard step components (`components/onboarding/steps.tsx`)
 * and the wizard panel labels that previously interleaved EN/SW in one
 * rendered string.
 *
 * WHY THIS FILE EXISTS
 * The locale-purity guard (`i18n/locale-purity.ts`) skips the entire
 * `i18n/` tree, so every Swahili literal the wizard needs lives here rather
 * than inline. Crucially, the prior code rendered BOTH languages at once
 * (`${en} / ${sw}`, raw English paragraphs) — the zero-mix canon forbids
 * that. Each leaf below is a strict `{ en, sw }` pair the call site resolves
 * with `pickByLocale(locale, S.key)` so exactly ONE language paints.
 *
 * A NEW per-surface bundle (rather than editing the shared tail/routes
 * tables) keeps this stream conflict-free.
 *
 * SHAPE
 * A flat record. Each leaf is `{ en, sw }`.
 */

export const onboardingStepsStrings = {
  // KYB step — the TIN label previously hardcoded raw English "TIN".
  onbTin: { en: 'TIN', sw: 'Namba ya mlipakodi (TIN)' },

  // Cockpit-seed step — the paragraph was a raw English literal; its Swahili
  // peer previously lived as `onbSeedHintSw` (en empty). Both halves now have
  // real copy and are selected by locale.
  onbSeedIntro: {
    en: "Pick a one-line headline for your first daily brief. We'll seed your cockpit so it's ready when you finish onboarding.",
    sw: 'Chagua kichwa kifupi kwa muhtasari wako wa kwanza wa siku. Tutaandaa dashibodi yako ili iwe tayari ukimaliza usajili.',
  },

  // Stepper / step labels — the panel rendered `${label} / ${labelSw}`. These
  // pairs let the panel resolve ONE label per active locale.
  stepKyb: { en: 'NIDA + KYB', sw: 'NIDA + KYB' },
  stepLicences: { en: 'Licence import', sw: 'Pakia leseni' },
  stepSites: { en: 'Site geometry', sw: 'Mipaka ya tovuti' },
  stepDrillHoles: { en: 'Drill-hole batch', sw: 'Mashimo ya kuchimba' },
  stepCockpitSeed: { en: 'Cockpit seed', sw: 'Anza dashibodi' },

  // File-upload hints — previously rendered hintEn AND hintSw together.
  hintLicences: { en: 'Drop PML/PL/SML/ML PDFs here', sw: 'Tia PML/PL/SML/ML hapa' },
  hintSites: {
    en: 'Drop a GeoJSON polygon for each site',
    sw: 'Tia GeoJSON ya kila tovuti',
  },
  hintDrill: {
    en: 'Drop the first drill-hole CSV batch',
    sw: 'Tia CSV ya mashimo ya kwanza',
  },

  // Wizard nav + progress copy that previously used a combined `both` literal.
  progressTitle: { en: 'Progress', sw: 'Maendeleo' },
  backButton: { en: 'Back', sw: 'Rudi' },
  nextButton: { en: 'Next', sw: 'Endelea' },
  finishButton: { en: 'Finish', sw: 'Maliza' },

  // NEVER-BLOCKED: the GeoJSON site (step 2) + drill CSV (step 3) imports are
  // OPTIONAL. A new owner may not have either file yet, so they can skip and
  // add the data later. The Skip control + the "optional" note make that
  // explicit so the wizard never traps an owner who has nothing to upload.
  skipButton: { en: 'Skip for now', sw: 'Ruka kwa sasa' },
  stepOptionalNote: {
    en: 'Optional — you can import this later from the cockpit.',
    sw: 'Si lazima — unaweza kupakia hii baadaye kutoka dashibodi.',
  },
  stepCounter: {
    en: 'Step {{n}} of {{total}}',
    sw: 'Hatua {{n}} kati ya {{total}}',
  },

  // Site (GeoJSON) + drill-hole (CSV) ingest outcomes. These feeds are parsed
  // client-side and committed as real `sites` / `drill_holes` rows.
  ingestingSites: { en: 'Reading your site geometry…', sw: 'Inasoma jiometri ya tovuti…' },
  ingestingDrill: { en: 'Reading your drill-hole batch…', sw: 'Inasoma mashimo ya kuchimba…' },
  siteParseFailedTitle: {
    en: 'Some site files could not be read',
    sw: 'Baadhi ya faili za tovuti hazikusomeka',
  },
  drillParseFailedTitle: {
    en: 'Some drill-hole files could not be read',
    sw: 'Baadhi ya faili za mashimo hazikusomeka',
  },
  reasonNotGeoJson: {
    en: 'Not a valid GeoJSON FeatureCollection with features.',
    sw: 'Si GeoJSON sahihi yenye vipengele.',
  },
  reasonNotCsv: {
    en: 'Not a valid CSV (needs a header row and at least one data row).',
    sw: 'Si CSV sahihi (inahitaji kichwa na angalau safu moja ya data).',
  },
} as const;
