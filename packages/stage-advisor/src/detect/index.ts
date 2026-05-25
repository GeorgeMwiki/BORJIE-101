/**
 * Stage detection — classify an org into one of seven stages using
 * `unitsManaged` as the primary signal plus a handful of secondaries
 * that act as tie-breakers and confidence boosters.
 *
 * Hysteresis to prevent flapping: once we've classified an org into a
 * stage, we require it to spend `DEFAULT_SMOOTHING_DAYS` (default 30)
 * sustained inside the candidate stage's band before we re-classify.
 * This stops a portfolio that briefly drops below a threshold from
 * being downgraded then re-upgraded the next week.
 */

import { STAGE_CARDS, STAGE_ORDER } from '../stages/definitions.js';
import type {
  DetectStageResult,
  OrgMetrics,
  OrgStage,
  PersistedStageState,
} from '../types.js';

export const DEFAULT_SMOOTHING_DAYS = 30;

export interface DetectStageInput {
  readonly metrics: OrgMetrics;
  /** Last known state — provides the hysteresis anchor. */
  readonly previousState?: PersistedStageState | null;
  /** Override the smoothing window (test-only typically). */
  readonly smoothingDays?: number;
  /** Override "now" — defaults to `metrics.observedAt`. */
  readonly nowIso?: string;
}

/**
 * Returns the stage `units` lands in by walking the stage cards in
 * lifecycle order. The `ecosystem` card has `max === null` so any unit
 * count above its `min` lands there.
 */
export function stageFromUnits(units: number): OrgStage {
  const u = Math.max(0, Math.floor(units));
  for (const stage of STAGE_ORDER) {
    const card = STAGE_CARDS[stage];
    const min = card.range.min;
    const max = card.range.max;
    if (max === null) {
      if (u >= min) return stage;
    } else if (u >= min && u <= max) {
      return stage;
    }
  }
  // Should be unreachable — every unit count fits somewhere.
  return 'pre-launch';
}

/**
 * Confidence scoring — units count is worth 0.7 base, secondaries
 * (active users, age, regions, revenue, churn) each contribute up to
 * 0.06. Caps at 1.0.
 */
function scoreConfidence(
  rawStage: OrgStage,
  m: OrgMetrics,
  rationale: string[],
): number {
  let score = 0.7;
  rationale.push(`Primary signal: ${m.unitsManaged} units → ${rawStage}.`);
  // Active users — bigger orgs typically have more users.
  if (m.activeUsers >= 25) {
    score += 0.06;
    rationale.push(`Secondary: ${m.activeUsers} active users (≥25 boosts confidence).`);
  } else if (m.activeUsers >= 5) {
    score += 0.03;
    rationale.push(`Secondary: ${m.activeUsers} active users (≥5 mild boost).`);
  }
  // Age — older orgs have more inertia in their stage.
  if (m.ageMonths >= 36) {
    score += 0.06;
    rationale.push(`Secondary: ${m.ageMonths}-month age (>=36 stable).`);
  } else if (m.ageMonths >= 12) {
    score += 0.03;
    rationale.push(`Secondary: ${m.ageMonths}-month age (>=12 mild).`);
  }
  // Region count — multi-region implies forest+.
  if (m.regionCount >= 2) {
    score += 0.06;
    rationale.push(`Secondary: ${m.regionCount} regions configured.`);
  }
  // Revenue — non-zero implies operations are running.
  if (m.monthlyRevenue > 0) {
    score += 0.06;
    rationale.push(
      `Secondary: monthly revenue ${m.monthlyRevenue} ${m.currency} > 0.`,
    );
  }
  // Low churn is healthy.
  if (m.tenantChurnRate >= 0 && m.tenantChurnRate <= 0.05) {
    score += 0.06;
    rationale.push(
      `Secondary: tenant churn ${(m.tenantChurnRate * 100).toFixed(1)}% (≤5%) healthy.`,
    );
  }
  return Math.min(1, score);
}

function daysBetween(a: string, b: string): number {
  const aMs = Date.parse(a);
  const bMs = Date.parse(b);
  if (Number.isNaN(aMs) || Number.isNaN(bMs)) return 0;
  return Math.abs(bMs - aMs) / (1000 * 60 * 60 * 24);
}

/**
 * Detect the stage of the org with smoothing/hysteresis.
 *
 * Sequence:
 *   1. Compute raw stage from `unitsManaged`.
 *   2. Score confidence using secondary signals.
 *   3. If no previous state, return raw immediately.
 *   4. If raw === previous.currentStage, return previous (no change).
 *   5. Else compare to `previousState.candidateStage`:
 *        - same candidate, ≥smoothingDays sustained → graduate to raw
 *        - different candidate, reset clock → return previous stage
 */
export function detectStage(input: DetectStageInput): DetectStageResult {
  const smoothingDays = input.smoothingDays ?? DEFAULT_SMOOTHING_DAYS;
  const m = input.metrics;
  const now = input.nowIso ?? m.observedAt;

  const rawStage = stageFromUnits(m.unitsManaged);
  const evidence: string[] = [];
  const confidence = scoreConfidence(rawStage, m, evidence);

  const prev = input.previousState ?? null;

  // First-ever classification — no hysteresis to apply.
  if (!prev) {
    return {
      stage: rawStage,
      confidence,
      evidence,
      smoothingActive: false,
      rawStage,
    };
  }

  // Already in the right stage — return as-is.
  if (prev.currentStage === rawStage) {
    evidence.push(
      `Already classified as ${rawStage} since ${prev.currentStageSince}; no change.`,
    );
    return {
      stage: rawStage,
      confidence,
      evidence,
      smoothingActive: false,
      rawStage,
    };
  }

  // Different stage — hysteresis kicks in.
  if (
    prev.candidateStage === rawStage &&
    prev.candidateStageSince !== null
  ) {
    const sustainedFor = daysBetween(prev.candidateStageSince, now);
    if (sustainedFor >= smoothingDays) {
      evidence.push(
        `Sustained as candidate ${rawStage} for ${sustainedFor.toFixed(
          1,
        )}d (≥${smoothingDays}d threshold) — graduating.`,
      );
      return {
        stage: rawStage,
        confidence,
        evidence,
        smoothingActive: false,
        rawStage,
      };
    }
    evidence.push(
      `Candidate ${rawStage} sustained ${sustainedFor.toFixed(1)}d (<${smoothingDays}d) — holding at ${prev.currentStage}.`,
    );
    return {
      stage: prev.currentStage,
      confidence,
      evidence,
      smoothingActive: true,
      rawStage,
    };
  }

  // Brand-new candidate — clock starts now, hold at previous stage.
  evidence.push(
    `New candidate stage ${rawStage} observed at ${now}; smoothing clock starts. Holding at ${prev.currentStage}.`,
  );
  return {
    stage: prev.currentStage,
    confidence,
    evidence,
    smoothingActive: true,
    rawStage,
  };
}

/**
 * Update the persisted state after a detection. Returns a NEW state
 * object — never mutates the input.
 */
export function updateStageState(
  previous: PersistedStageState | null,
  detection: DetectStageResult,
  now: string,
  tenantId: string,
): PersistedStageState {
  // Stable case — no transition.
  if (previous && previous.currentStage === detection.stage) {
    // If raw is also the same, clear any lingering candidate.
    if (detection.rawStage === detection.stage) {
      return {
        tenantId,
        currentStage: previous.currentStage,
        currentStageSince: previous.currentStageSince,
        candidateStage: null,
        candidateStageSince: null,
      };
    }
    // Raw differs from current — track or refresh the candidate.
    if (previous.candidateStage === detection.rawStage) {
      // Same candidate — keep its existing since timestamp.
      return {
        tenantId,
        currentStage: previous.currentStage,
        currentStageSince: previous.currentStageSince,
        candidateStage: previous.candidateStage,
        candidateStageSince: previous.candidateStageSince,
      };
    }
    // New candidate — reset clock.
    return {
      tenantId,
      currentStage: previous.currentStage,
      currentStageSince: previous.currentStageSince,
      candidateStage: detection.rawStage,
      candidateStageSince: now,
    };
  }
  // Transition just happened — flip currentStage.
  return {
    tenantId,
    currentStage: detection.stage,
    currentStageSince: now,
    candidateStage: null,
    candidateStageSince: null,
  };
}
