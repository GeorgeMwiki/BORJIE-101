/**
 * Guard-exempt bilingual string table for the owner-cockpit create-course
 * surface (gap 11 — AI course generation).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The locale-purity guard (`../locale-purity.ts`) flags hardcoded Swahili in
 * CODE outside `src/i18n/`. Every create-course string (EN + SW) lives here so
 * the React components carry ZERO Swahili literals and stay pure. Resolved at
 * the edge by `coursesT(locale)` so the active locale supplies EVERY string —
 * single-language per locale, no EN/SW mixing (CLAUDE.md hard rule).
 *
 * Mirrors the training.ts table shape ({ sw, en } pairs + a flat translator).
 */

import type { CourseLanguage } from '@borjie/api-client/courses-types';

interface SwEn {
  readonly sw: string;
  readonly en: string;
}

/** Course difficulties (mirrors COURSE_DIFFICULTIES). */
export const COURSE_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type CourseDifficultyValue = (typeof COURSE_DIFFICULTIES)[number];

/**
 * Mining course domains the backend offers (mirrors COURSE_DOMAINS ids). The
 * labels + descriptions + Lucide icon names are resolved here so the picker
 * stays locale-pure without importing the ai-copilot package on the client.
 */
export interface CourseDomainOption {
  readonly id: string;
  readonly icon: string;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly descriptionEn: string;
  readonly descriptionSw: string;
}

export const COURSE_DOMAIN_OPTIONS: ReadonlyArray<CourseDomainOption> = [
  {
    id: 'mine_operations',
    icon: 'Pickaxe',
    labelEn: 'Mine operations',
    labelSw: 'Uendeshaji wa mgodi',
    descriptionEn:
      'Production rolls, idle-capacity loss, operator fees, and day-to-day pit running.',
    descriptionSw:
      'Uzalishaji, hasara ya uwezo usiotumika, ada za waendeshaji, na uendeshaji wa kila siku.',
  },
  {
    id: 'licensing_compliance',
    icon: 'ShieldCheck',
    labelEn: 'Licensing & compliance',
    labelSw: 'Leseni na uzingatiaji',
    descriptionEn:
      'Mining Act, licence renewals, annual returns, mineral-rights register, and audit trails.',
    descriptionSw:
      'Sheria ya Madini, kuhuisha leseni, marejesho ya mwaka, daftari la haki za madini, na kumbukumbu za ukaguzi.',
  },
  {
    id: 'royalties_finance',
    icon: 'Wallet',
    labelEn: 'Royalties & finance',
    labelSw: 'Mrabaha na fedha',
    descriptionEn:
      'Royalty collection, arrears ladders, NOI, cap rates, and the numbers behind a mine.',
    descriptionSw:
      'Ukusanyaji wa mrabaha, ngazi za madeni, NOI, cap rate, na namba za mgodi.',
  },
  {
    id: 'safety_reliability',
    icon: 'HardHat',
    labelEn: 'Safety & reliability',
    labelSw: 'Usalama na uimara',
    descriptionEn:
      'Incident triage, preventive maintenance, condition monitoring, and asset reliability.',
    descriptionSw:
      'Upangaji wa dharura, matengenezo ya kuzuia, ufuatiliaji wa hali, na uimara wa vifaa.',
  },
  {
    id: 'offtake_commercial',
    icon: 'Handshake',
    labelEn: 'Offtake & commercial',
    labelSw: 'Ununuzi na biashara',
    descriptionEn:
      'Offtake structures, take-or-pay, buyer qualification, and price escalation clauses.',
    descriptionSw:
      'Miundo ya ununuzi, take-or-pay, uthibitishaji wa mnunuzi, na vifungu vya kupanda kwa bei.',
  },
  {
    id: 'investment_strategy',
    icon: 'TrendingUp',
    labelEn: 'Investment & strategy',
    labelSw: 'Uwekezaji na mkakati',
    descriptionEn:
      'Portfolio diversification, joint ventures, hold-period analysis, and growth strategy.',
    descriptionSw:
      'Mseto wa kundi la mali, ubia, uchambuzi wa kipindi cha kushikilia, na mkakati wa ukuaji.',
  },
];

/** Flat UI copy keyed by a stable string id, EN + SW. */
const UI = {
  // page heroes / nav
  navCreateCourse: { en: 'Create course', sw: 'Tengeneza kozi' },
  createTitle: { en: 'Create a course', sw: 'Tengeneza kozi' },
  createSubtitle: {
    en: 'Tell Mr. Mwikila what you want to learn; he builds a tailored course.',
    sw: 'Mwambie Bw. Mwikila unachotaka kujifunza; atatengeneza kozi maalum.',
  },
  courseViewTitle: { en: 'Your course', sw: 'Kozi yako' },
  // step indicator
  stepProgress: { en: 'Course creation steps', sw: 'Hatua za kutengeneza kozi' },
  stepDomain: { en: 'Topic', sw: 'Mada' },
  stepScenario: { en: 'Situation', sw: 'Hali' },
  stepDocuments: { en: 'Documents', sw: 'Nyaraka' },
  // domain picker
  pickDomainTitle: { en: 'Pick a topic area', sw: 'Chagua eneo la mada' },
  pickDomainHint: {
    en: 'Choose the area that fits your operation best.',
    sw: 'Chagua eneo linalolingana na uendeshaji wako.',
  },
  // scenario form
  scenarioTitle: { en: 'Describe your situation', sw: 'Eleza hali yako' },
  scenarioHint: {
    en: 'The more specific you are, the more useful the course.',
    sw: 'Kadiri unavyokuwa wazi, ndivyo kozi inavyokuwa na manufaa.',
  },
  scenarioLabel: { en: 'Your situation', sw: 'Hali yako' },
  scenarioPlaceholder: {
    en: 'For example: I run a small gold mine in the Lake Zone and want to renew my licence on time.',
    sw: 'Mfano: Naendesha mgodi mdogo wa dhahabu Kanda ya Ziwa na nataka kuhuisha leseni kwa wakati.',
  },
  difficultyLabel: { en: 'Difficulty', sw: 'Kiwango' },
  difficultyBeginner: { en: 'Beginner', sw: 'Mwanzo' },
  difficultyIntermediate: { en: 'Intermediate', sw: 'Wastani' },
  difficultyAdvanced: { en: 'Advanced', sw: 'Juu' },
  scenarioTooShort: {
    en: 'Please add a little more detail (at least 10 characters).',
    sw: 'Tafadhali ongeza maelezo kidogo (angalau herufi 10).',
  },
  // document attach
  documentsTitle: { en: 'Attach documents (optional)', sw: 'Ambatisha nyaraka (si lazima)' },
  documentsHint: {
    en: 'Add a licence, a contract, or a report to ground the course in your own context.',
    sw: 'Ongeza leseni, mkataba, au ripoti ili kozi iegemee muktadha wako.',
  },
  documentNameLabel: { en: 'Document name', sw: 'Jina la hati' },
  documentNamePlaceholder: { en: 'e.g. Primary mining licence', sw: 'mf. Leseni ya msingi ya uchimbaji' },
  documentTypeLabel: { en: 'Type', sw: 'Aina' },
  documentTypePlaceholder: { en: 'e.g. Licence', sw: 'mf. Leseni' },
  documentSummaryLabel: { en: 'What it contains', sw: 'Kina nini' },
  documentSummaryPlaceholder: {
    en: 'A short note on what is in this document.',
    sw: 'Maelezo mafupi ya yaliyomo kwenye hati hii.',
  },
  addDocument: { en: 'Add document', sw: 'Ongeza hati' },
  removeDocument: { en: 'Remove', sw: 'Ondoa' },
  noDocuments: { en: 'No documents attached.', sw: 'Hakuna nyaraka zilizoambatishwa.' },
  // actions
  back: { en: 'Back', sw: 'Rudi' },
  continue: { en: 'Continue', sw: 'Endelea' },
  generate: { en: 'Generate course', sw: 'Tengeneza kozi' },
  skipAndGenerate: { en: 'Skip and generate', sw: 'Ruka na utengeneze' },
  // generation modal
  generatingTitle: { en: 'Building your course', sw: 'Inatengeneza kozi yako' },
  generatingBody: {
    en: 'This takes a moment. You can wait here.',
    sw: 'Inachukua muda mfupi. Unaweza kusubiri hapa.',
  },
  generationErrorTitle: { en: 'Could not start', sw: 'Imeshindwa kuanza' },
  generationErrorBody: {
    en: 'The course could not be started. Please try again.',
    sw: 'Kozi haikuweza kuanzishwa. Tafadhali jaribu tena.',
  },
  generationNetworkError: {
    en: 'A connection problem stopped the course. Please try again.',
    sw: 'Tatizo la mtandao limesimamisha kozi. Tafadhali jaribu tena.',
  },
  serviceUnavailable: {
    en: 'Course generation is temporarily unavailable.',
    sw: 'Utengenezaji wa kozi haupatikani kwa muda.',
  },
  retry: { en: 'Retry', sw: 'Jaribu tena' },
  cancel: { en: 'Cancel', sw: 'Ghairi' },
  // course view — states
  loading: { en: 'Loading…', sw: 'Inapakia…' },
  generating: { en: 'Generating your course…', sw: 'Inatengeneza kozi yako…' },
  loadError: { en: 'Could not load the course. Please try again.', sw: 'Imeshindwa kupakia kozi. Tafadhali jaribu tena.' },
  generationFailedTitle: { en: 'Generation failed', sw: 'Utengenezaji umeshindwa' },
  generationFailed: {
    en: 'The course could not be generated. Please try again.',
    sw: 'Kozi haikuweza kutengenezwa. Tafadhali jaribu tena.',
  },
  tryAgain: { en: 'Try again', sw: 'Jaribu tena' },
  backToCreate: { en: 'Create a new course', sw: 'Tengeneza kozi mpya' },
  // course view — content
  lessonCount: { en: '{count} lessons', sw: 'Masomo {count}' },
  minutes: { en: '{count} min', sw: 'Dakika {count}' },
  objectives: { en: 'Objectives', sw: 'Malengo' },
  keyTakeaways: { en: 'Key takeaways', sw: 'Mambo muhimu' },
  quizCount: { en: '{count} quiz questions', sw: 'Maswali {count} ya jaribio' },
  completed: { en: 'Completed', sw: 'Imekamilika' },
  // provenance (honest-degrade transparency)
  viaLlm: { en: 'AI-generated', sw: 'Imetengenezwa na AI' },
  viaDeterministic: { en: 'From the concept catalog', sw: 'Kutoka katalogi ya dhana' },
} as const;

export type CourseUiKey = keyof typeof UI;

function fillTemplate(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

export interface CoursesTranslator {
  /** Resolve a flat UI key for the active locale. */
  readonly t: (key: CourseUiKey) => string;
  /** Resolve a flat UI key with named params (e.g. {count}). */
  readonly tp: (
    key: CourseUiKey,
    params: Readonly<Record<string, string | number>>,
  ) => string;
  /** Localised difficulty label. */
  readonly difficultyLabel: (difficulty: string) => string;
  /** Localised domain label. */
  readonly domainLabel: (option: CourseDomainOption) => string;
  /** Localised domain description. */
  readonly domainDescription: (option: CourseDomainOption) => string;
}

const DIFFICULTY_KEY: Readonly<Record<string, CourseUiKey>> = {
  beginner: 'difficultyBeginner',
  intermediate: 'difficultyIntermediate',
  advanced: 'difficultyAdvanced',
};

/** Build a locale-bound translator for the create-course surface. */
export function coursesT(locale: CourseLanguage): CoursesTranslator {
  const pick = (pair: SwEn | undefined): string =>
    pair ? (locale === 'sw' ? pair.sw : pair.en) : '';
  const t = (key: CourseUiKey): string => pick(UI[key]);
  return {
    t,
    tp: (key, params) => fillTemplate(t(key), params),
    difficultyLabel: (difficulty) => {
      const key = DIFFICULTY_KEY[difficulty];
      return key ? t(key) : difficulty;
    },
    domainLabel: (option) => (locale === 'sw' ? option.labelSw : option.labelEn),
    domainDescription: (option) =>
      locale === 'sw' ? option.descriptionSw : option.descriptionEn,
  };
}
