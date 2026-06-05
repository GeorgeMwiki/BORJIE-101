/**
 * Deterministic synthetic decision-record + PDPA fixtures for the
 * regulator-readiness release gate (LP-16 consumer).
 *
 * `@borjie/regulator-sim` ships pure functions but no data source — the gate
 * needs a reproducible corpus of mining licence / royalty / payout decisions
 * to replay. This module is that source: a seeded generator that emits
 * fully-compliant `DecisionRecord`s spread across a date range, plus a handful
 * of synthetic PDPA artefacts. It mirrors the author's own test fixtures
 * (bilingual notes, registered model, fresh model card, allowed reason codes,
 * four-eye on cross-org actions, fairness within tolerance) so a GREEN gate
 * means the invariants genuinely hold, and a regression in the package flips
 * it red reproducibly.
 *
 * No I/O, no clock — `now` and `seed` are injected so CI runs are stable.
 *
 * @module regulator-pack/synthetic
 */

import { createSeededRandom } from '../eval-ops-lib/seeded-random.js';
import {
  DEFAULT_ALLOWED_REASON_CODES,
  type DecisionDomain,
  type DecisionOutcome,
  type DecisionRecord,
  type SubjectArtefact,
} from '../../packages/regulator-sim/src/index.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Models the gate registers — every synthetic record draws from these. */
export const REGISTERED_MODEL_IDS: ReadonlyArray<string> = [
  'mwikila-licence-v3',
  'mwikila-royalty-v3',
  'mwikila-payout-v2',
];

const DOMAIN_MODEL: Readonly<Record<DecisionDomain, string>> = {
  licence: 'mwikila-licence-v3',
  royalty: 'mwikila-royalty-v3',
  payout: 'mwikila-payout-v2',
};

const DOMAINS: ReadonlyArray<DecisionDomain> = ['licence', 'royalty', 'payout'];
const OUTCOMES: ReadonlyArray<DecisionOutcome> = [
  'approve',
  'approve_with_conditions',
  'decline',
  'defer',
];

/** Bilingual reason-note pairs (English + Swahili) keyed by domain. */
const NOTES: Readonly<
  Record<DecisionDomain, { readonly en: string; readonly sw: string }>
> = {
  licence: {
    en: 'Licence valid and assay verified against the registered claim.',
    sw: 'Leseni ni halali na uchunguzi wa madini umethibitishwa dhidi ya eneo lililosajiliwa.',
  },
  royalty: {
    en: 'Royalty reconciled against assay and treasury limits.',
    sw: 'Mrabaha umelinganishwa na uchunguzi wa madini na mipaka ya hazina.',
  },
  payout: {
    en: 'Payout within treasury limit; beneficial owner verified.',
    sw: 'Malipo yako ndani ya kikomo cha hazina; mmiliki halisi amethibitishwa.',
  },
};

const REASON_CODES: Readonly<Record<DecisionDomain, ReadonlyArray<string>>> = {
  licence: ['LICENCE_VALID', 'ASSAY_VERIFIED'],
  royalty: ['ROYALTY_RECONCILED', 'ASSAY_VERIFIED'],
  payout: ['PAYOUT_WITHIN_TREASURY_LIMIT', 'BENEFICIAL_OWNER_VERIFIED'],
};

export interface SyntheticAuditInput {
  readonly fromIso: string;
  readonly toIso: string;
  readonly seed: number;
  readonly count: number;
  /** Injected clock for the model-card freshness window. */
  readonly nowIso: string;
}

/**
 * Build `count` fully-compliant decision records whose `decidedAt` is spread
 * uniformly (and deterministically) across `[fromIso, toIso]`. Cross-org
 * actions always carry two distinct approvers; fairness deltas stay inside a
 * tight band; model cards are reviewed within the last ~30 days of `nowIso`.
 */
export function buildSyntheticDecisions(
  input: SyntheticAuditInput,
): ReadonlyArray<DecisionRecord> {
  const fromMs = Date.parse(input.fromIso);
  const toMs = Date.parse(input.toIso);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
    throw new Error(
      `buildSyntheticDecisions: invalid window ${input.fromIso}..${input.toIso}`,
    );
  }
  const nowMs = Date.parse(input.nowIso);
  if (Number.isNaN(nowMs)) {
    throw new Error(`buildSyntheticDecisions: invalid nowIso ${input.nowIso}`);
  }
  const rng = createSeededRandom(input.seed);
  const span = toMs - fromMs;

  return Array.from({ length: input.count }, (_unused, i) => {
    const domain = DOMAINS[i % DOMAINS.length] as DecisionDomain;
    const decidedAtMs = fromMs + Math.floor(rng.next() * span);
    const crossOrg = rng.bool(0.3);
    // Model card reviewed 1..30 days before "now" → always fresh under a
    // 90-day window, never in the future relative to the decision.
    const cardAgeDays = rng.int(1, 30);
    const notes = NOTES[domain];
    return {
      decisionId: `dec-${domain}-${String(i).padStart(4, '0')}`,
      domain,
      decidedAt: new Date(decidedAtMs).toISOString(),
      outcome: rng.pick(OUTCOMES),
      cotTrace: `cot-${domain}-${String(i).padStart(4, '0')}`,
      reasonCodes: REASON_CODES[domain] as ReadonlyArray<string>,
      reasonNotesEn: notes.en,
      reasonNotesSw: notes.sw,
      modelId: DOMAIN_MODEL[domain],
      modelCardVersion: '3.1',
      modelCardCurrentAt: new Date(nowMs - cardAgeDays * MS_PER_DAY).toISOString(),
      fairnessTpDelta: Number((rng.next() * 0.04).toFixed(4)),
      fairnessFpDelta: Number((rng.next() * 0.04).toFixed(4)),
      crossOrgAction: crossOrg,
      approverIds: crossOrg ? ['officer-a', 'officer-b'] : ['officer-a'],
    } satisfies DecisionRecord;
  });
}

/**
 * Build `count` compliant decoy records dated strictly BEFORE `beforeIso`, so
 * they fall outside any replay window starting at/after it. Feeding these to
 * `replayAudit` alongside the in-window corpus makes the window-filter
 * assertion non-vacuous: a regression that stopped filtering by date would
 * replay the decoys too and trip the "exact in-window count" criterion.
 */
export function buildOutOfWindowDecoys(
  beforeIso: string,
  seed: number,
  count: number,
  nowIso: string,
): ReadonlyArray<DecisionRecord> {
  const beforeMs = Date.parse(beforeIso);
  if (Number.isNaN(beforeMs)) {
    throw new Error(`buildOutOfWindowDecoys: invalid beforeIso ${beforeIso}`);
  }
  // A one-year band that ends a day before the window opens.
  const decoyFrom = new Date(beforeMs - 366 * MS_PER_DAY).toISOString();
  const decoyTo = new Date(beforeMs - MS_PER_DAY).toISOString();
  return buildSyntheticDecisions({
    fromIso: decoyFrom,
    toIso: decoyTo,
    seed,
    count,
    nowIso,
  }).map((r, i) => ({ ...r, decisionId: `decoy-${String(i).padStart(4, '0')}` }));
}

/** Allowed reason codes for the gate (the package default set). */
export const ALLOWED_REASON_CODES: ReadonlyArray<string> = [
  ...DEFAULT_ALLOWED_REASON_CODES,
];

/**
 * A small synthetic PDPA estate for one owner: a redactable third-party-PII
 * artefact, a legal-held decision, and an unrelated subject's record. Mirrors
 * the package test fixture so the access + erasure drill exercises both the
 * redaction path and the legal-hold retention path.
 */
export function buildSyntheticPdpaArtefacts(
  subjectId: string,
): ReadonlyArray<SubjectArtefact> {
  return [
    {
      subjectId,
      kind: 'licence_application',
      id: `${subjectId}-a1`,
      contents: `Applicant ${subjectId}, partner Asha Komba listed on the claim.`,
      thirdPartyPiiFields: ['Asha Komba'],
    },
    {
      subjectId,
      kind: 'decision',
      id: `${subjectId}-a2`,
      contents: 'Royalty approved for the period.',
      legalHoldUntilIso: '2027-01-01T00:00:00.000Z',
    },
    {
      subjectId: 'unrelated-owner',
      kind: 'document',
      id: 'unrelated-a3',
      contents: 'A record belonging to a different subject.',
    },
  ];
}
