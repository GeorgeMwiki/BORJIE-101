/**
 * Adaptive-learning shape (mining-skill mastery curve).
 *
 * Ported from LITFIN's adaptive-learning shape (which tracked borrower
 * financial-literacy progression). For Borjie the skill universe is
 * mining-domain: pit safety, geology read, blasting basics, mineral
 * identification, royalty arithmetic, regulator filing, equipment
 * maintenance.
 *
 * Mastery is modelled as a discrete level + a confidence factor in
 * [0, 1]. Progression is driven by signals (exercise outcomes, field
 * observations, peer reviews); each signal contributes a delta whose
 * sign and magnitude reflect a Bayesian update.
 *
 * Pure functions, side-effect-free. Caller persists state to whatever
 * store (Postgres, Drizzle, in-memory cache). The brain layer
 * (@borjie/central-intelligence + @borjie/ai-copilot) consumes the
 * snapshot to choose the next nudge / micro-learning tile.
 */

export type MasteryLevel =
  | "novice"
  | "apprentice"
  | "competent"
  | "proficient"
  | "expert";

export interface SkillSnapshot {
  readonly skillCode: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly level: MasteryLevel;
  /** Confidence the learner is at the recorded level. 0..1. */
  readonly confidence: number;
  /** Count of distinct signal observations folded in. */
  readonly observationCount: number;
  readonly lastObservedAt?: string;
}

export interface LearningSignal {
  readonly kind:
    | "exercise_pass"
    | "exercise_fail"
    | "field_observation_correct"
    | "field_observation_wrong"
    | "peer_endorsement"
    | "peer_correction"
    | "regulator_finding";
  /** Optional explicit weight; defaults to 1.0. */
  readonly weight?: number;
  readonly observedAt: string;
}

const LEVEL_ORDER: ReadonlyArray<MasteryLevel> = [
  "novice",
  "apprentice",
  "competent",
  "proficient",
  "expert",
];

function levelIndex(level: MasteryLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

const SIGNAL_DELTA: Record<LearningSignal["kind"], number> = {
  exercise_pass: 0.08,
  exercise_fail: -0.12,
  field_observation_correct: 0.12,
  field_observation_wrong: -0.18,
  peer_endorsement: 0.05,
  peer_correction: -0.05,
  regulator_finding: -0.25,
};

/**
 * Fold a signal into a skill snapshot. Returns a NEW snapshot; never
 * mutates the input.
 *
 * - Confidence moves by the signal's weighted delta.
 * - When confidence crosses 0.9 the level steps up (capped at expert).
 * - When confidence drops below 0.2 the level steps down (floored at
 *   novice) and confidence resets to 0.5 at the new level.
 */
export function applySignal(
  snapshot: SkillSnapshot,
  signal: LearningSignal,
): SkillSnapshot {
  const delta = SIGNAL_DELTA[signal.kind] * (signal.weight ?? 1.0);
  const nextConfidence = clamp(snapshot.confidence + delta, 0, 1);
  let nextLevel = snapshot.level;
  let finalConfidence = nextConfidence;
  if (nextConfidence >= 0.9 && levelIndex(snapshot.level) < LEVEL_ORDER.length - 1) {
    nextLevel = LEVEL_ORDER[levelIndex(snapshot.level) + 1];
    finalConfidence = 0.6;
  } else if (nextConfidence <= 0.2 && levelIndex(snapshot.level) > 0) {
    nextLevel = LEVEL_ORDER[levelIndex(snapshot.level) - 1];
    finalConfidence = 0.5;
  }
  return Object.freeze({
    skillCode: snapshot.skillCode,
    tenantId: snapshot.tenantId,
    personId: snapshot.personId,
    level: nextLevel,
    confidence: finalConfidence,
    observationCount: snapshot.observationCount + 1,
    lastObservedAt: signal.observedAt,
  });
}

/**
 * Initial snapshot for a learner who has never been observed on a skill.
 */
export function emptySnapshot(args: {
  readonly skillCode: string;
  readonly tenantId: string;
  readonly personId: string;
}): SkillSnapshot {
  return Object.freeze({
    skillCode: args.skillCode,
    tenantId: args.tenantId,
    personId: args.personId,
    level: "novice",
    confidence: 0.5,
    observationCount: 0,
  });
}

/**
 * Determine the next-best learning intervention for a learner on a
 * given skill. Returns null when the learner is at the top level
 * with high confidence — they are ready to teach, not learn.
 */
export interface InterventionSuggestion {
  readonly kind: "drill" | "field-practice" | "peer-pairing" | "mentor-review";
  readonly skillCode: string;
  readonly rationale: string;
}

export function suggestIntervention(
  snapshot: SkillSnapshot,
): InterventionSuggestion | null {
  if (snapshot.level === "expert" && snapshot.confidence > 0.8) return null;
  if (snapshot.confidence < 0.4) {
    return {
      kind: "drill",
      skillCode: snapshot.skillCode,
      rationale: `confidence ${snapshot.confidence.toFixed(2)} below 0.4 at ${snapshot.level}`,
    };
  }
  if (snapshot.level === "apprentice" || snapshot.level === "competent") {
    return {
      kind: "field-practice",
      skillCode: snapshot.skillCode,
      rationale: `${snapshot.level} level benefits most from supervised field practice`,
    };
  }
  if (snapshot.level === "proficient") {
    return {
      kind: "peer-pairing",
      skillCode: snapshot.skillCode,
      rationale: "proficient learners benefit from cross-pollination with peers",
    };
  }
  return {
    kind: "mentor-review",
    skillCode: snapshot.skillCode,
    rationale: "default intervention",
  };
}
