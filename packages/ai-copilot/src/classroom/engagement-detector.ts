/**
 * Engagement detector (Wave 11).
 *
 * Watches a stream of participant signals and emits an engagement verdict.
 * Inputs are intentionally minimal so the module stays deterministic and
 * testable — no heuristics based on audio or CV.
 *
 * Signals:
 *   - lastAnswerLatencyMs  — time from last prompt to answer
 *   - silentForMs          — time since the learner last interacted
 *   - offTopicFlags        — count of off-topic utterances in the window
 *   - accuracyWindow       — fraction correct over the last N answers
 */

export interface EngagementSignal {
  readonly userId: string;
  readonly lastAnswerLatencyMs?: number;
  readonly silentForMs?: number;
  readonly offTopicFlags?: number;
  readonly accuracyWindow?: number; // 0-1
}

export type EngagementLevel = 'engaged' | 'distracted' | 'disengaged';

export interface EngagementVerdict {
  readonly userId: string;
  readonly level: EngagementLevel;
  readonly reasons: readonly string[];
  readonly score: number; // 0-1 (1 = engaged)
}

export interface EngagementThresholds {
  readonly slowAnswerMs: number;
  readonly silentMs: number;
  readonly maxOffTopic: number;
  readonly lowAccuracy: number;
}

export const DEFAULT_THRESHOLDS: EngagementThresholds = {
  slowAnswerMs: 15_000,
  silentMs: 60_000,
  maxOffTopic: 2,
  lowAccuracy: 0.3,
};

export function detectEngagement(
  signal: EngagementSignal,
  thresholds: EngagementThresholds = DEFAULT_THRESHOLDS
): EngagementVerdict {
  const reasons: string[] = [];
  let score = 1.0;

  if (
    signal.lastAnswerLatencyMs !== undefined &&
    signal.lastAnswerLatencyMs > thresholds.slowAnswerMs
  ) {
    reasons.push('slow_answers');
    score -= 0.2;
  }
  if (
    signal.silentForMs !== undefined &&
    signal.silentForMs > thresholds.silentMs
  ) {
    reasons.push('prolonged_silence');
    score -= 0.35;
  }
  if (
    signal.offTopicFlags !== undefined &&
    signal.offTopicFlags >= thresholds.maxOffTopic
  ) {
    reasons.push('off_topic');
    score -= 0.15;
  }
  if (
    signal.accuracyWindow !== undefined &&
    signal.accuracyWindow < thresholds.lowAccuracy
  ) {
    reasons.push('low_accuracy');
    score -= 0.25;
  }

  score = Math.max(0, Math.min(1, score));

  let level: EngagementLevel;
  if (score >= 0.7) level = 'engaged';
  else if (score >= 0.4) level = 'distracted';
  else level = 'disengaged';

  return {
    userId: signal.userId,
    level,
    reasons,
    score,
  };
}

export function aggregateEngagement(
  verdicts: readonly EngagementVerdict[]
): {
  avgScore: number;
  disengagedCount: number;
  distractedCount: number;
  engagedCount: number;
} {
  if (verdicts.length === 0) {
    return { avgScore: 1, disengagedCount: 0, distractedCount: 0, engagedCount: 0 };
  }
  const sum = verdicts.reduce((a, v) => a + v.score, 0);
  return {
    avgScore: sum / verdicts.length,
    disengagedCount: verdicts.filter((v) => v.level === 'disengaged').length,
    distractedCount: verdicts.filter((v) => v.level === 'distracted').length,
    engagedCount: verdicts.filter((v) => v.level === 'engaged').length,
  };
}
