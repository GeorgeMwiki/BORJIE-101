/**
 * Guard-exempt bilingual string table for the owner-cockpit training surfaces
 * (gap 9 scenario-simulation + gap 10 mastery-checkpoint).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The locale-purity guard (`../locale-purity.ts`) flags hardcoded Swahili in
 * CODE outside `src/i18n/`. Every training-surface string (EN + SW) lives here
 * so the React components carry ZERO Swahili literals and stay pure. Resolved
 * at the edge by `trainingT(locale)` so the active locale supplies EVERY string
 * — single-language per locale, no EN/SW mixing (CLAUDE.md hard rule).
 *
 * Mirrors the routes-a.ts cohort table shape ({ sw, en } pairs).
 */

import type { ScenarioLanguage } from '@borjie/api-client/training-types';

interface SwEn {
  readonly sw: string;
  readonly en: string;
}

/** Scenario kinds the backend generates (mirrors SCENARIO_KIND_VALUES). */
export const SCENARIO_KINDS = [
  'licence_renewal_negotiation',
  'royalty_dispute',
  'safety_incident_triage',
  'offtake_negotiation',
  'contractor_damage_claim',
] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;

/** Junior role-modes the operator rehearses as (mirrors the route allowlist). */
export const ROLE_MODES = [
  'compliance',
  'finance',
  'safety',
  'commercial',
  'operations',
] as const;
export type RoleModeValue = (typeof ROLE_MODES)[number];

const KIND_LABELS: Readonly<Record<ScenarioKind, SwEn>> = {
  licence_renewal_negotiation: {
    en: 'Licence-renewal negotiation',
    sw: 'Mazungumzo ya kuhuisha leseni',
  },
  royalty_dispute: { en: 'Royalty dispute', sw: 'Mgogoro wa mrabaha' },
  safety_incident_triage: {
    en: 'Safety-incident triage',
    sw: 'Upangaji wa dharura ya usalama',
  },
  offtake_negotiation: {
    en: 'Offtake negotiation',
    sw: 'Mazungumzo ya mkataba wa ununuzi',
  },
  contractor_damage_claim: {
    en: 'Contractor-damage claim',
    sw: 'Madai ya uharibifu wa mkandarasi',
  },
};

const ROLE_LABELS: Readonly<Record<RoleModeValue, SwEn>> = {
  compliance: { en: 'Compliance', sw: 'Uzingatiaji' },
  finance: { en: 'Finance', sw: 'Fedha' },
  safety: { en: 'Safety', sw: 'Usalama' },
  commercial: { en: 'Commercial', sw: 'Biashara' },
  operations: { en: 'Operations', sw: 'Uendeshaji' },
};

const DIFFICULTY_LABELS: Readonly<Record<string, SwEn>> = {
  beginner: { en: 'Beginner', sw: 'Mwanzo' },
  intermediate: { en: 'Intermediate', sw: 'Wastani' },
  advanced: { en: 'Advanced', sw: 'Juu' },
};

/** Flat UI copy keyed by a stable string id, EN + SW. */
const UI: Readonly<Record<string, SwEn>> = {
  // page heroes
  scenariosTitle: { en: 'Rehearsal scenarios', sw: 'Hali za mazoezi' },
  scenariosSubtitle: {
    en: 'Practise the high-stakes conversations before they happen.',
    sw: 'Fanya mazoezi ya mazungumzo muhimu kabla hayajatokea.',
  },
  checkpointPageTitle: { en: 'Mastery checkpoint', sw: 'Ukaguzi wa umahiri' },
  checkpointPageSubtitle: {
    en: 'Prove the concepts before the next phase unlocks.',
    sw: 'Thibitisha dhana kabla awamu ijayo haijafunguliwa.',
  },
  // nav
  navLabel: { en: 'Training sections', sw: 'Sehemu za mafunzo' },
  navScenarios: { en: 'Scenarios', sw: 'Hali' },
  navCheckpoint: { en: 'Checkpoint', sw: 'Ukaguzi' },
  // filters
  filters: { en: 'Filters', sw: 'Vichujio' },
  all: { en: 'All', sw: 'Zote' },
  difficulty: { en: 'Difficulty', sw: 'Ugumu' },
  kind: { en: 'Kind', sw: 'Aina' },
  competency: { en: 'Competency', sw: 'Umahiri' },
  // cards
  estMinutes: { en: 'Estimated minutes', sw: 'Dakika zinazokadiriwa' },
  objectivesLabel: { en: 'Objectives', sw: 'Malengo' },
  risksLabel: { en: 'Risks to surface', sw: 'Hatari za kuibua' },
  startScenario: { en: 'Start scenario', sw: 'Anza hali' },
  // empty / error
  emptyTitle: { en: 'No scenarios match', sw: 'Hakuna hali inayolingana' },
  emptyDesc: {
    en: 'Adjust the filters to see more rehearsals.',
    sw: 'Rekebisha vichujio kuona mazoezi zaidi.',
  },
  emptyDegradedTitle: {
    en: 'No scenarios yet',
    sw: 'Hakuna hali bado',
  },
  emptyDegradedDesc: {
    en: 'Generate rehearsals from the concept catalog to begin.',
    sw: 'Tengeneza mazoezi kutoka katalogi ya dhana kuanza.',
  },
  generate: { en: 'Generate scenarios', sw: 'Tengeneza hali' },
  generateFailed: {
    en: 'Could not generate scenarios. Try again.',
    sw: 'Imeshindwa kutengeneza hali. Jaribu tena.',
  },
  errorUnavailable: {
    en: 'Training is temporarily unavailable.',
    sw: 'Mafunzo hayapatikani kwa muda.',
  },
  errorUnavailableDesc: {
    en: 'The training service is offline. Please try again shortly.',
    sw: 'Huduma ya mafunzo iko nje ya mtandao. Tafadhali jaribu tena hivi punde.',
  },
  errorLoad: {
    en: 'Could not load. Try again.',
    sw: 'Imeshindwa kupakia. Jaribu tena.',
  },
  retry: { en: 'Retry', sw: 'Jaribu tena' },
  loading: { en: 'Loading…', sw: 'Inapakia…' },
  // role-mode banner
  roleModeLockedBanner: {
    en: 'Admin-locked role: rehearsing as {role}.',
    sw: 'Jukumu lililofungwa na msimamizi: unafanya mazoezi kama {role}.',
  },
  roleModeRejectedTitle: {
    en: 'Role not permitted',
    sw: 'Jukumu haliruhusiwi',
  },
  roleModeRejectedDesc: {
    en: 'That role-mode is not allowed for this scenario.',
    sw: 'Jukumu hilo haliruhusiwi kwa hali hii.',
  },
  // workspace
  backToBrowser: { en: 'Back to scenarios', sw: 'Rudi kwenye hali' },
  startingRun: { en: 'Starting rehearsal…', sw: 'Inaanza mazoezi…' },
  briefingTitle: { en: 'Briefing', sw: 'Maelezo' },
  counterparty: { en: 'Counterparty', sw: 'Mhusika mwenzako' },
  objectiveCoverage: { en: 'Objective coverage', sw: 'Ufikiaji wa malengo' },
  elapsedTime: { en: 'Elapsed time', sw: 'Muda uliopita' },
  transcript: { en: 'Transcript', sw: 'Nakala ya mazungumzo' },
  transcriptEmpty: {
    en: 'Open with your first move.',
    sw: 'Anza na hatua yako ya kwanza.',
  },
  counterpartyTyping: { en: 'Counterparty is replying…', sw: 'Mhusika anajibu…' },
  inputLabel: { en: 'Your message', sw: 'Ujumbe wako' },
  inputPlaceholder: {
    en: 'Type your move, then press Enter…',
    sw: 'Andika hatua yako, kisha bonyeza Enter…',
  },
  send: { en: 'Send', sw: 'Tuma' },
  completeRun: { en: 'Complete rehearsal', sw: 'Maliza mazoezi' },
  runPassedTitle: { en: 'Rehearsal passed', sw: 'Mazoezi yamefaulu' },
  runMissedTitle: { en: 'Keep practising', sw: 'Endelea kufanya mazoezi' },
  // checkpoint
  checkpointTitle: { en: 'Mastery checkpoint', sw: 'Ukaguzi wa umahiri' },
  checkpointEmptyTitle: { en: 'No checkpoint yet', sw: 'Hakuna ukaguzi bado' },
  checkpointEmptyDesc: {
    en: 'Run some rehearsals first to build a checkpoint.',
    sw: 'Fanya mazoezi kwanza ili kujenga ukaguzi.',
  },
  backToHub: { en: 'Back to training', sw: 'Rudi kwenye mafunzo' },
  next: { en: 'Next', sw: 'Endelea' },
  submit: { en: 'Submit', sw: 'Wasilisha' },
  submitting: { en: 'Submitting…', sw: 'Inawasilisha…' },
  checkpointSubmitFailed: {
    en: 'Could not submit. Try again.',
    sw: 'Imeshindwa kuwasilisha. Jaribu tena.',
  },
  phaseMasteredTitle: { en: 'Phase mastered', sw: 'Awamu imefikiwa' },
  phaseMissedTitle: { en: 'Not quite yet', sw: 'Bado kidogo' },
  phaseUnlockedNote: {
    en: 'The next phase is unlocked.',
    sw: 'Awamu inayofuata imefunguliwa.',
  },
  reviewTheseTitle: { en: 'Review these', sw: 'Pitia hizi' },
  retakeCheckpoint: { en: 'Retake checkpoint', sw: 'Rudia ukaguzi' },
  genericError: {
    en: 'Something went wrong. Please try again.',
    sw: 'Hitilafu imetokea. Tafadhali jaribu tena.',
  },
};

/** Templated UI strings that take named params (kept separate for clarity). */
function fillTemplate(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}

export interface TrainingTranslator {
  /** Resolve a flat UI key for the active locale. */
  readonly t: (key: keyof typeof UI) => string;
  /** Resolve a flat UI key with named params (e.g. {role}, {pct}). */
  readonly tp: (key: keyof typeof UI, params: Readonly<Record<string, string | number>>) => string;
  /** Localised scenario-kind label. */
  readonly kindLabel: (kind: string) => string;
  /** Localised role-mode label. */
  readonly roleLabel: (mode: string) => string;
  /** Localised difficulty label. */
  readonly difficultyLabel: (difficulty: string) => string;
}

/** Build a locale-bound translator for the training surfaces. */
export function trainingT(locale: ScenarioLanguage): TrainingTranslator {
  const pick = (pair: SwEn | undefined): string =>
    pair ? (locale === 'sw' ? pair.sw : pair.en) : '';
  return {
    t: (key) => pick(UI[key]),
    tp: (key, params) => fillTemplate(pick(UI[key]), params),
    kindLabel: (kind) => pick(KIND_LABELS[kind as ScenarioKind]) || kind,
    roleLabel: (mode) => pick(ROLE_LABELS[mode as RoleModeValue]) || mode,
    difficultyLabel: (difficulty) => pick(DIFFICULTY_LABELS[difficulty]) || difficulty,
  };
}
