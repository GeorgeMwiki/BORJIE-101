/**
 * Bayesian Knowledge Tracing (Wave 11).
 *
 * Individual + group BKT. Ported from LitFin's classroom substrate.
 *
 * Parameters per concept (and learner):
 *   - pKnow    — probability the learner currently knows the concept
 *   - pLearn   — probability of moving from unknown → known per opportunity
 *   - pSlip    — probability of answering wrong even when known
 *   - pGuess   — probability of answering right even when unknown
 *
 * After each quiz answer, pKnow is updated via the classic Corbett-Anderson
 * equations. Group mastery = weighted average pKnow across learners for a
 * concept. The pacer (session-pacer.ts) consumes the aggregates.
 *
 * This module is pure — all functions are side-effect-free.
 */

export interface BKTState {
  readonly pKnow: number;
  readonly pLearn: number;
  readonly pSlip: number;
  readonly pGuess: number;
  readonly observations: number;
}

export const DEFAULT_BKT: BKTState = {
  pKnow: 0.1, // assume near-zero prior knowledge
  pLearn: 0.2,
  pSlip: 0.1,
  pGuess: 0.2,
  observations: 0,
};

export function initBKT(overrides?: Partial<BKTState>): BKTState {
  return { ...DEFAULT_BKT, ...(overrides ?? {}) };
}

/**
 * Core BKT update. Pure — returns a new state.
 */
export function updateBKT(state: BKTState, isCorrect: boolean): BKTState {
  const { pKnow, pLearn, pSlip, pGuess } = state;

  // P(correct | known)   = 1 - pSlip
  // P(correct | unknown) = pGuess

  // Evidence update (posterior P(known | observed))
  const num = isCorrect
    ? pKnow * (1 - pSlip)
    : pKnow * pSlip;
  const denom = isCorrect
    ? pKnow * (1 - pSlip) + (1 - pKnow) * pGuess
    : pKnow * pSlip + (1 - pKnow) * (1 - pGuess);

  const posterior = denom === 0 ? pKnow : num / denom;

  // Transition — learner may transition from unknown → known this step.
  const nextPKnow = posterior + (1 - posterior) * pLearn;

  return {
    ...state,
    pKnow: clamp(nextPKnow),
    observations: state.observations + 1,
  };
}

export function isMastered(state: BKTState, threshold = 0.95): boolean {
  return state.pKnow >= threshold;
}

export function describeMastery(pKnow: number): {
  label: string;
  labelSw: string;
} {
  if (pKnow >= 0.95) return { label: 'Mastered', labelSw: 'Mameelewa' };
  if (pKnow >= 0.7) return { label: 'Proficient', labelSw: 'Mzuri' };
  if (pKnow >= 0.4) return { label: 'Developing', labelSw: 'Anaendelea' };
  if (pKnow >= 0.15) return { label: 'Novice', labelSw: 'Mwanzo' };
  return { label: 'Not started', labelSw: 'Hajaanza' };
}

// --- Group aggregation

export interface LearnerBKT {
  readonly userId: string;
  readonly concepts: Readonly<Record<string, BKTState>>;
}

export interface GroupConceptMastery {
  readonly conceptId: string;
  readonly groupPKnow: number;
  readonly minPKnow: number;
  readonly maxPKnow: number;
  readonly spread: number;
  readonly learnerCount: number;
  readonly masteredCount: number;
  readonly peerLearningOpportunity: boolean;
}

export function calculateGroupConceptMastery(
  learners: readonly LearnerBKT[],
  conceptId: string
): GroupConceptMastery {
  const present = learners.filter((l) => l.concepts[conceptId]);
  if (present.length === 0) {
    return {
      conceptId,
      groupPKnow: 0,
      minPKnow: 0,
      maxPKnow: 0,
      spread: 0,
      learnerCount: 0,
      masteredCount: 0,
      peerLearningOpportunity: false,
    };
  }
  const pks = present.map((l) => l.concepts[conceptId].pKnow);
  const obs = present.map((l) =>
    Math.max(1, l.concepts[conceptId].observations)
  );
  const totalWeight = obs.reduce((a, b) => a + b, 0);
  const weightedSum = present.reduce(
    (sum, l, i) => sum + l.concepts[conceptId].pKnow * obs[i],
    0
  );
  const groupPKnow = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const minP = Math.min(...pks);
  const maxP = Math.max(...pks);
  const spread = maxP - minP;
  const mastered = pks.filter((p) => p >= 0.95).length;
  return {
    conceptId,
    groupPKnow,
    minPKnow: minP,
    maxPKnow: maxP,
    spread,
    learnerCount: present.length,
    masteredCount: mastered,
    peerLearningOpportunity: spread > 0.3 && maxP > 0.7,
  };
}

export function calculateOverallGroupMastery(
  learners: readonly LearnerBKT[],
  conceptIds: readonly string[]
): number {
  if (conceptIds.length === 0) return 0;
  const sum = conceptIds
    .map((cid) => calculateGroupConceptMastery(learners, cid).groupPKnow)
    .reduce((a, b) => a + b, 0);
  return sum / conceptIds.length;
}

/** Apply a peer-learning boost — capped so it never overwhelms the prior. */
export function applyPeerLearningBoost(
  state: BKTState,
  multiplier: number
): BKTState {
  if (multiplier <= 1.0) return state;
  return { ...state, pLearn: Math.min(0.6, state.pLearn * multiplier) };
}

function clamp(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
